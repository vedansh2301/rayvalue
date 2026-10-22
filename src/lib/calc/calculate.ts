import type { Assumptions, SourcedRange, Utility } from '../../data/schemas';
import { lookupZip } from '../geo';
import { costRange, fillSourcedRange, type FilledRange } from './cost';
import { lossesForShading, monthlyShares, validateProduction } from './production';
import { netSavings, paybackYears, projectSavings } from './payback';
import { resolveRates, type RateModel, type TieredRates } from './rates';
import { roundKw, roundKwh, roundPayback, roundRange, roundUsd } from './round';
import { caSavingsYear, flSavingsYear } from './savings';
import { sizeSystem, type Sizing } from './sizing';
import { cents, dollars, monthSpan, num, pct, perKwh, perWatt } from './text';
import type { CalcContext, CalcFailure, CalcInput, CalcResult, ProductionInput, Range } from './types';
import { estimateAnnualKwh, zeroUsageMonthlyBill } from './usage';

const fail = (reason: CalcFailure['reason'], missing?: string[]): CalcFailure => (missing ? { ok: false, reason, missing } : { ok: false, reason });

const SHARE_KEY = { 0: 'solar_only', 1: 'solar_plus_1_battery', 2: 'solar_plus_2_batteries' } as const;

/** One end of the outcome range. */
interface Scenario {
  sizeKw: number;
  /** CA self-consumption share (unused in FL). */
  share: number;
  escalation: number;
  cost: number;
}

/**
 * Solar payback calculator. Pure: everything it needs is passed in.
 *
 * Steps: validate → resolve data (or list every null it needs) → annual usage from the
 * bill → size range → cost range → year-by-year savings for three scenarios → payback
 * and net savings → round.
 *
 * Display ranges (independent, "what system you might get"):
 *   size:         offset low / likely / high
 *   cost:         size.low × $/W.low … size.high × $/W.high (+ batteries low … high)
 *   year1Savings: savings of size.low with CA share.low … size.high with share.high
 * Outcome scenarios (payback, net savings) all use ONE system size, size.likely, so
 * cost and savings always describe the same system:
 *   worst  = size.likely at $/W.high (+ battery high), CA share.low,  escalation.low
 *   likely = likely everything
 *   best   = size.likely at $/W.low  (+ battery low),  CA share.high, escalation.high
 * netSavings25: low = worst, high = best. paybackYears: low = best (shortest), high = worst.
 * So the worst-case payback cost is size.likely × $/W.high, not the displayed cost.high.
 *
 * Throws (caller bugs, not user errors) on malformed production, battery or shading.
 */
export function calculate(input: CalcInput, ctx: CalcContext): CalcResult {
  const { assumptions: a, costs, production } = ctx;
  validateProduction(production);
  if (![0, 1, 2].includes(input.battery)) throw new RangeError(`battery must be 0, 1 or 2, got ${input.battery}`);
  if (!['none', 'some', 'heavy'].includes(input.shading)) throw new RangeError(`unknown shading ${input.shading}`);

  const loc = lookupZip(input.zip);
  if (!loc) return fail('invalid_zip');
  const utility = ctx.utilities.find((u) => u.id === input.utilityId);
  if (!utility) return fail('unknown_utility');
  if (utility.state !== loc.state) return fail('state_mismatch');
  const bill = input.avgMonthlyBill;
  if (typeof bill !== 'number' || !Number.isFinite(bill) || bill <= 0 || bill > a.max_monthly_bill.value) return fail('invalid_bill');

  // ---- data (collect every missing value before giving up)
  const state = utility.state;
  const spread = a.missing_range_spread.value;
  const missing: string[] = [];
  const rates = resolveRates(utility);
  if (!rates.ok) missing.push(...rates.missing);
  const ppw = fillSourcedRange(costs[state].installed_cost_per_watt, `costs.json.${state}.installed_cost_per_watt`, spread);
  if (!ppw.ok) missing.push(...ppw.missing);
  const bat = input.battery > 0 ? fillSourcedRange(costs[state].battery_installed_cost, `costs.json.${state}.battery_installed_cost`, spread) : null;
  if (bat && !bat.ok) missing.push(...bat.missing);
  if (!rates.ok || !ppw.ok || (bat && !bat.ok)) return fail('missing_data', missing);
  const model = rates.value;
  const perWattRange = ppw.value.range;
  const batteryRange: Range = bat?.ok ? bat.value.range : { low: 0, likely: 0, high: 0 };

  // ---- usage, size, cost
  const annualKwh = estimateAnnualKwh(bill, model);
  const kwhPerKw = production.annualKwhPerKw;
  const sizing = sizeSystem(annualKwh, kwhPerKw, a);
  const size = sizing.size;
  const cost = costRange(size, perWattRange, input.battery, batteryRange);

  // ---- savings
  const esc = a.annual_rate_escalation[state];
  const share = a.ca_self_consumption_share[SHARE_KEY[input.battery]];
  const degradation = a.panel_degradation_per_year.value;
  const years = a.analysis_years.value;
  const shares = monthlyShares(production);

  /** Savings in year n (1-based) for a scenario: production degrades, retail rates escalate. */
  const savingsInYear = (s: Scenario, n: number): number => {
    const annualProduction = s.sizeKw * kwhPerKw * (1 - degradation) ** (n - 1);
    const rateGrowth = (1 + s.escalation) ** (n - 1);
    if (model.kind === 'tiered') {
      const monthlyProduction = shares.map((sh) => sh * annualProduction);
      return flSavingsYear(model, annualKwh / 12, monthlyProduction) * rateGrowth;
    }
    const r = caSavingsYear(model, annualKwh, annualProduction, s.share);
    return r.retailValue * rateGrowth + r.exportValue; // export credit held flat
  };

  // One system size for every outcome scenario (see the doc comment).
  const kw = size.likely;
  const scenarioCost = (end: keyof Range) => kw * 1000 * perWattRange[end] + input.battery * batteryRange[end];
  const worst: Scenario = { sizeKw: kw, share: share.low, escalation: esc.low, cost: scenarioCost('high') };
  const likely: Scenario = { sizeKw: kw, share: share.likely, escalation: esc.likely, cost: cost.likely };
  const best: Scenario = { sizeKw: kw, share: share.high, escalation: esc.high, cost: scenarioCost('low') };
  const flows = (s: Scenario) => projectSavings(years, (n) => savingsInYear(s, n));
  const fw = flows(worst);
  const fl = flows(likely);
  const fb = flows(best);

  // Year-1 display range follows the size range (year 1 has no escalation or degradation).
  const year1Savings: Range = {
    low: savingsInYear({ sizeKw: size.low, share: share.low, escalation: 0, cost: 0 }, 1),
    likely: fl[0] ?? 0,
    high: savingsInYear({ sizeKw: size.high, share: share.high, escalation: 0, cost: 0 }, 1),
  };
  const payback = { low: paybackYears(best.cost, fb), likely: paybackYears(likely.cost, fl), high: paybackYears(worst.cost, fw) };
  const net: Range = { low: netSavings(worst.cost, fw), likely: netSavings(likely.cost, fl), high: netSavings(best.cost, fb) };

  return {
    ok: true,
    state,
    utilityId: utility.id,
    annualUsageKwh: roundKwh(annualKwh),
    size: roundRange(size, roundKw),
    cost: roundRange(cost, roundUsd),
    year1Savings: roundRange(year1Savings, roundUsd),
    paybackYears: roundPayback(payback),
    netSavings25: roundRange(net, roundUsd),
    analysisYears: years,
    assumptions: buildAssumptions({ input, utility, model, a, sizing, annualKwh, production, ppw: ppw.value, bat: bat?.ok ? bat.value : null, costs: costs[state], spread, share }),
    warnings: buildWarnings({ input, model, a, sizing, annualKwh }),
  };
}

// ------------------------------------------------------------------ text

interface TextArgs {
  input: CalcInput;
  utility: Utility;
  model: RateModel;
  a: Assumptions;
  sizing: Sizing;
  annualKwh: number;
  production: ProductionInput;
  ppw: FilledRange;
  bat: FilledRange | null;
  costs: { installed_cost_per_watt: SourcedRange; battery_installed_cost: SourcedRange };
  spread: number;
  share: Range;
}

const source = (url: string | null, date: string | null) => (url ? `source: ${url}${date ? `, checked ${date}` : ''}` : 'no source');

function tierText(tiers: TieredRates['monthTiers'][number]): string {
  const parts = tiers.map((t, i) => {
    if (t.upTo === null) return i === 0 ? `${perKwh(t.rate)} for all usage` : `then ${perKwh(t.rate)}`;
    return i === 0 ? `${perKwh(t.rate)} for the first ${num(t.upTo)} kWh a month` : `${perKwh(t.rate)} up to ${num(t.upTo)} kWh`;
  });
  return parts.join(', ');
}

function estimatedText(what: string, f: FilledRange, spread: number, fmt: (n: number) => string): string | null {
  const s = pct(spread);
  const median = fmt(f.range.likely);
  if (f.estimatedLow && f.estimatedHigh) {
    return `The low and high ends of the ${what} range (${fmt(f.range.low)} and ${fmt(f.range.high)}) are estimated as ±${s} around the sourced median of ${median}, because the source's low and high bounds are not verified yet.`;
  }
  if (f.estimatedHigh) return `The high end of the ${what} range (${fmt(f.range.high)}) is estimated as ${s} above the sourced likely value of ${median}, because the source gives no verified upper bound yet.`;
  if (f.estimatedLow) return `The low end of the ${what} range (${fmt(f.range.low)}) is estimated as ${s} below the sourced likely value of ${median}, because the source gives no verified lower bound yet.`;
  return null;
}

function buildAssumptions(t: TextArgs): string[] {
  const { input, utility, model, a, sizing, annualKwh, production, ppw, bat, costs, spread, share } = t;
  const out: string[] = [];
  const years = a.analysis_years.value;
  const esc = a.annual_rate_escalation[utility.state];

  out.push('No federal tax credit is included: the federal residential clean energy credit (Section 25D) does not apply to expenditures after Dec 31, 2025.');

  // usage
  if (model.kind === 'tiered') {
    const seasons = (utility.tier_sets ?? []).map((set) => {
      const tiers = model.monthTiers[set.months[0]! - 1]!;
      return set.season === 'all_year' ? tierText(tiers) : `${set.season} (${monthSpan(set.months)}): ${tierText(tiers)}`;
    });
    out.push(
      `Annual usage of about ${num(roundKwh(annualKwh))} kWh is estimated by working backwards from your ${cents(input.avgMonthlyBill)} average monthly bill through ${utility.name} ${utility.rate_schedule} rates: a ${cents(model.fixedMonthly)} monthly fixed charge plus ${seasons.join('; ')} (${source(utility.source_url, utility.verified_on)}). Your bill likely includes taxes and fees these rates leave out, so usage may be slightly overstated.`,
    );
    out.push('Usage is assumed to be the same every month (annual estimate ÷ 12).');
    const min = model.minimum;
    if (min) {
      out.push(
        min.basis === 'base_charges'
          ? `A ${cents(min.amount)} minimum monthly bill applies to base charges (the ${cents(model.fixedMonthly)} fixed charge plus base energy charges); fuel and other clause charges are added on top. With solar, a month's bill never drops below this minimum, which limits savings in months solar covers most of your usage.`
          : `A ${cents(min.amount)} minimum monthly bill applies. With solar, a month's bill never drops below this minimum, which limits savings in months solar covers most of your usage.`,
      );
    }
  } else {
    const avg = utility.avg_rate_per_kwh;
    out.push(
      `Annual usage of about ${num(roundKwh(annualKwh))} kWh is estimated as (your ${cents(input.avgMonthlyBill)} average monthly bill − the ${cents(model.fixedMonthly)} monthly fixed charge) ÷ ${perKwh(model.retailRate)}, ${utility.name}'s published residential average rate. That is a class average across all residential plans, not your specific plan (${source(avg?.source_url ?? null, avg?.verified_on ?? null)}).`,
    );
    out.push(
      'That average rate also recovers fixed costs, so dividing your bill after the fixed charge by it may understate your usage, and with it the recommended size and savings (conservative).',
    );
  }

  // production + sizing
  const shape = input.shading === 'none' ? 'no' : input.shading;
  out.push(
    `Solar production of ${num(production.annualKwhPerKw)} kWh per installed kW per year with ${shape} shading (${lossesForShading(input.shading, a)}% system losses)${model.kind === 'tiered' ? (production.monthlyKwhPerKw ? ', spread across the year using the monthly production profile' : ', split evenly across the 12 months') : ''}.`,
  );
  out.push(
    `The system is sized to cover ${pct(sizing.offset.low)}–${pct(sizing.offset.high)} of estimated annual usage (likely ${pct(sizing.offset.likely)}, the midpoint), capped at ${a.system_size_cap_kw.value} kW.`,
  );

  // cost
  const c = costs.installed_cost_per_watt;
  out.push(
    `Installed solar cost of ${perWatt(ppw.range.low)}–${perWatt(ppw.range.high)} (likely ${perWatt(ppw.range.likely)}), in ${c.unit} (${source(c.source_url, c.verified_on)}).`,
  );
  const ppwNote = estimatedText('installed cost per watt', ppw, spread, perWatt);
  if (ppwNote) out.push(ppwNote);
  if (bat) {
    const b = costs.battery_installed_cost;
    const n = input.battery;
    out.push(
      `${n} battery ${n === 1 ? 'system' : 'systems'} at ${dollars(bat.range.low)}–${dollars(bat.range.high)} each (likely ${dollars(bat.range.likely)}); unit: ${b.unit} (${source(b.source_url, b.verified_on)}).`,
    );
    const batNote = estimatedText('battery cost', bat, spread, dollars);
    if (batNote) out.push(batNote);
  }

  // savings model
  if (model.kind === 'tiered') {
    out.push(
      `Florida retail net metering: each solar kWh offsets a kWh you would have bought, re-priced through the utility's tiers month by month. Solar beyond a month's usage is banked and used in later months at the retail rate; anything still banked at the end of the year is counted as $0 (conservative). The ${cents(model.fixedMonthly)} monthly fixed charge is never offset.`,
    );
    if (input.battery > 0) out.push('Under Florida retail net metering a battery adds cost but no bill savings in this estimate; its value here is backup power only.');
  } else {
    const label = input.battery === 0 ? 'solar only' : input.battery === 1 ? 'solar with 1 battery' : 'solar with 2 batteries';
    out.push(
      `California net billing (NEM 3.0): ${pct(share.low)}–${pct(share.high)} (likely ${pct(share.likely)}) of solar output is used at home (${label}), valued at ${perKwh(model.retailRate)} and capped at your usage; the rest is exported at ${perKwh(model.exportCredit)}, the utility's average export credit (${source(utility.source_url, utility.verified_on)}).`,
    );
    out.push('The export credit is held flat over time; only the retail rate is escalated.');
  }

  out.push(`Electricity rates rise ${pct(esc.low)}–${pct(esc.high)} a year (likely ${pct(esc.likely)}).`);
  out.push(`Panel output falls ${pct(a.panel_degradation_per_year.value)} a year.`);
  out.push(
    `Payback and net savings use a ${years}-year projection with no discounting for the time value of money; payback beyond ${years} years is shown as more than ${years} years.`,
  );
  out.push(
    `Ranges: system size spans the ${pct(sizing.offset.low)}–${pct(sizing.offset.high)} usage targets, and cost and first-year savings follow that size range. Payback and net savings are for the likely size: the low end pairs its highest installed cost with the lowest savings assumptions and slowest rate growth, the high end its lowest cost with the highest savings assumptions and fastest rate growth. For payback, the shortest (best case) is listed first.`,
  );
  out.push('Not included: financing costs, maintenance, inverter or battery replacement, and tax effects.');
  return out;
}

function buildWarnings(t: { input: CalcInput; model: RateModel; a: Assumptions; sizing: Sizing; annualKwh: number }): string[] {
  const { input, model, a, sizing, annualKwh } = t;
  const out: string[] = [];
  const cap = a.system_size_cap_kw.value;
  if (annualKwh === 0) {
    const floor = zeroUsageMonthlyBill(model);
    const what = floor > model.fixedMonthly ? `${cents(floor)} minimum monthly bill` : `${cents(model.fixedMonthly)} monthly fixed charge`;
    out.push(
      `Your ${cents(input.avgMonthlyBill)} bill is at or below the ${what}, so no energy usage can be estimated from it. Solar cannot reduce the fixed charge.`,
    );
  } else if (sizing.belowMinimum) {
    out.push(
      `Your estimated usage needs only about a ${roundKw(sizing.size.likely)} kW system, below ${a.min_system_size_kw.value} kW. At this bill size solar may not make financial sense.`,
    );
  }
  if (sizing.capped) {
    out.push(`Your estimated usage would need more than ${cap} kW. The recommended size is capped at ${cap} kW, so solar would cover less of your bill.`);
  }
  return out;
}
