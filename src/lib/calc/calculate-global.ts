import { fillSourcedRange } from './cost';
import { runEngine } from './engine';
import { resolveExport, type ResolvedExport } from './export-policy';
import type { GlobalCalcContext, GlobalCalcInput, GlobalCalcResult } from './global-types';
import { prepareIncentives, type PreparedIncentives, type SkipReason } from './incentives';
import { monthlyShares, validateProduction } from './production';
import { resolveRates, type RateModel } from './rates';
import { moneyRounder, roundKw, roundKwh } from './round';
import { sizeSystem } from './sizing';
import { moneyFormatter, num, pct } from './text';
import { toConsumerPrice } from './tax';
import type { CalcFailure, Range } from './types';
import { estimateAnnualKwh, zeroUsageMonthlyBill } from './usage';

const fail = (reason: CalcFailure['reason'], missing?: string[]): CalcFailure => (missing ? { ok: false, reason, missing } : { ok: false, reason });
const SHARE_KEY = { 0: 'solar_only', 1: 'solar_plus_1_battery', 2: 'solar_plus_2_batteries' } as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Multi-country payback calculator. Same structure and range rules as calculate() (see calculate.ts), plus:
 *  - an export policy (net metering, net billing, feed-in, gross, none, Brazilian Fio B) chosen from data,
 *  - date-effective incentives (only sourced, date-valid, non-excluded rows are applied; the net cost feeds payback),
 *  - VAT/GST: ex-tax cost lines are converted to consumer prices with markets.vat_rate (missing rate = missing data),
 *  - the market's own currency and rounding unit. No FX anywhere.
 *
 * Failures never guess: a null the model needs is listed in `missing` (same path spelling as todo_verify).
 * Throws only on caller bugs (malformed production, battery, shading or install date).
 */
export function calculateGlobal(input: GlobalCalcInput, ctx: GlobalCalcContext): GlobalCalcResult {
  const a = ctx.assumptions;
  validateProduction(ctx.production);
  if (![0, 1, 2].includes(input.battery)) throw new RangeError(`battery must be 0, 1 or 2, got ${input.battery}`);
  if (!['none', 'some', 'heavy'].includes(input.shading)) throw new RangeError(`unknown shading ${input.shading}`);
  if (!ISO.test(input.installDate)) throw new RangeError(`installDate must be YYYY-MM-DD, got ${input.installDate}`);

  if (ctx.utility.id !== input.utilityId) return fail('unknown_utility');
  const bill = input.avgMonthlyBill;
  if (typeof bill !== 'number' || !Number.isFinite(bill) || bill <= 0 || bill > a.max_monthly_bill.value) return fail('invalid_bill');

  const { market } = ctx;
  const spread = a.missing_range_spread.value;
  const years = a.analysis_years.value;
  const missing: string[] = [];

  const rates = resolveRates(ctx.utility, { needExportCredit: false });
  if (!rates.ok) missing.push(...rates.missing);
  const exp = rates.ok ? resolveExport(ctx.exportPolicy, input.installDate, years, spread, rates.value) : null;
  if (exp && !exp.ok) missing.push(...exp.missing);

  const ppwPath = `cost_ranges[${market.code}/${ctx.regionCode}/installed_cost_per_watt]`;
  const batPath = `cost_ranges[${market.code}/${ctx.regionCode}/battery_installed_cost]`;
  const ppwFilled = fillSourcedRange(ctx.installedCostPerWatt.line, ppwPath, spread);
  if (!ppwFilled.ok) missing.push(...ppwFilled.missing);
  const batFilled = input.battery > 0 ? fillSourcedRange(ctx.batteryInstalledCost.line, batPath, spread) : null;
  if (batFilled && !batFilled.ok) missing.push(...batFilled.missing);

  let perWatt: Range | null = null;
  let battery: Range = { low: 0, likely: 0, high: 0 };
  if (ppwFilled.ok) {
    const t = toConsumerPrice(ppwFilled.value.range, { costsIncludeTax: ctx.installedCostPerWatt.includesTax, vatRate: market.vatRate }, market.code);
    if (t.ok) perWatt = t.value;
    else missing.push(...t.missing);
  }
  if (batFilled?.ok) {
    const t = toConsumerPrice(batFilled.value.range, { costsIncludeTax: ctx.batteryInstalledCost.includesTax, vatRate: market.vatRate }, market.code);
    if (t.ok) battery = t.value;
    else missing.push(...t.missing);
  }
  const ppwEstimated = ppwFilled.ok && (ppwFilled.value.estimatedLow || ppwFilled.value.estimatedHigh);
  if (missing.length || !rates.ok || !exp?.ok || !perWatt) return fail('missing_data', [...new Set(missing)]);

  const model: RateModel = rates.value;
  const resolved: ResolvedExport = exp.value;
  const round = moneyRounder(market.displayRound);

  const annualKwh = estimateAnnualKwh(bill, model);
  const kwhPerKw = ctx.production.annualKwhPerKw;
  const sizing = sizeSystem(annualKwh, kwhPerKw, a);
  const incentives = prepareIncentives(
    ctx.incentives,
    { sizeKw: sizing.size.likely, batteries: input.battery, batteryUsableKwh: ctx.batteryUsableKwh },
    input.installDate,
    resolved.kind,
  );

  const r = runEngine({
    model,
    export: resolved,
    annualKwh,
    kwhPerKw,
    shares: monthlyShares(ctx.production),
    sizing,
    perWattRange: perWatt,
    batteries: input.battery,
    batteryRange: battery,
    share: a.self_consumption_share[SHARE_KEY[input.battery]],
    escalation: a.annual_rate_escalation,
    degradation: a.panel_degradation_per_year.value,
    years,
    incentives,
    roundMoney: round,
  });

  return {
    ok: true,
    country: market.code,
    regionCode: ctx.regionCode,
    utilityId: ctx.utility.id,
    currency: market.currency,
    ...r,
    incentivesApplied: incentives.applied,
    incentivesSkipped: incentives.skipped,
    assumptions: buildText({ input, ctx, model, resolved, incentives, perWatt, battery, annualKwh, sizing, estimatedPerWatt: ppwEstimated }),
    warnings: buildWarnings(input, ctx, model, sizing, annualKwh),
  };
}

/**
 * Both paths side by side for markets where an incentive rules out an export policy (Ontario's rebate vs net
 * metering): `withPolicy` = the export policy as given (incentives that exclude it are dropped), `alternative` =
 * the same install with exports worth nothing (kind none), where those incentives apply. Null `alternative` when
 * no incentive excludes the policy's kind. Numbers come from calculateGlobal, never from the UI.
 */
export function calculateBothPaths(input: GlobalCalcInput, ctx: GlobalCalcContext) {
  const withPolicy = calculateGlobal(input, ctx);
  const excluding = ctx.incentives.some((i) => i.excludesExportKind === ctx.exportPolicy.kind);
  const alternative = excluding ? calculateGlobal(input, { ...ctx, exportPolicy: { id: `${ctx.exportPolicy.id}-none`, kind: 'none', trueUp: null, rates: [] } }) : null;
  return { withPolicy, alternative };
}

// ------------------------------------------------------------------ text

const SKIP_TEXT: Record<SkipReason, string> = {
  closed: 'is closed',
  status_unknown: 'has no verified status yet',
  not_in_effect: 'is not in effect on your install date',
  not_applicable: 'does not apply to this system',
  excluded_by_export_policy: 'cannot be combined with the export arrangement modelled here',
  amount_unknown: 'has no verified amount yet',
  battery_size_unknown: 'needs a battery size that is not verified yet',
};

interface TextArgs {
  input: GlobalCalcInput;
  ctx: GlobalCalcContext;
  model: RateModel;
  resolved: ResolvedExport;
  incentives: PreparedIncentives;
  perWatt: Range;
  battery: Range;
  annualKwh: number;
  sizing: ReturnType<typeof sizeSystem>;
  estimatedPerWatt: boolean;
}

function buildText(t: TextArgs): string[] {
  const { input, ctx, model, resolved, incentives, perWatt, battery, annualKwh, sizing } = t;
  const { market, assumptions: a } = ctx;
  const m = moneyFormatter(market.locale, market.currency);
  const out: string[] = [];
  const first = resolved.terms[0]!;

  // incentives
  if (market.code === 'US') {
    out.push('No federal tax credit is included: the federal residential clean energy credit (Section 25D) does not apply to expenditures after Dec 31, 2025.');
  }
  if (incentives.applied.length) {
    out.push(
      `Incentives deducted from the upfront cost (only programmes with a sourced rule valid on ${input.installDate}): ${incentives.applied
        .map((i) => `${i.name}${i.waitlist ? ' (waitlist: timing and funding are not guaranteed)' : ''}${i.taxable === true ? ' (may count as taxable income)' : i.taxable === null ? ' (tax treatment not verified)' : ''}`)
        .join('; ')}.`,
    );
  } else {
    out.push(`No incentive is included: none has a sourced rule valid on ${input.installDate} for this system.`);
  }
  for (const s of incentives.skipped) out.push(`Not included: ${s.name} ${SKIP_TEXT[s.reason]}.`);

  // usage
  if (model.kind === 'tiered') {
    out.push(`Annual usage of about ${num(roundKwh(annualKwh))} kWh is estimated by working backwards from your ${m.cents(input.avgMonthlyBill)} average monthly bill through ${ctx.utility.name} ${ctx.utility.rate_schedule} tiered rates, with a ${m.cents(model.fixedMonthly)} monthly fixed charge.`);
  } else {
    out.push(`Annual usage of about ${num(roundKwh(annualKwh))} kWh is estimated as (your ${m.cents(input.avgMonthlyBill)} average monthly bill - the ${m.cents(model.fixedMonthly)} monthly fixed charge) / ${m.perKwh(model.retailRate)}, ${ctx.utility.name}'s average retail rate.`);
  }

  out.push(`Solar production of ${num(ctx.production.annualKwhPerKw)} kWh per installed kW per year with ${input.shading === 'none' ? 'no' : input.shading} shading (${a.system_loss_pct[input.shading]}% system losses).`);
  out.push(`The system is sized to cover ${pct(sizing.offset.low)}-${pct(sizing.offset.high)} of estimated annual usage (likely ${pct(sizing.offset.likely)}), capped at ${a.system_size_cap_kw.value} kW.`);

  // cost
  const taxNote = market.pricesIncludeTax ? ' Prices include VAT/GST.' : market.pricesIncludeTax === false ? ' Prices shown before any sales tax.' : '';
  out.push(`Installed solar cost of ${m.perWatt(perWatt.low)}-${m.perWatt(perWatt.high)} (likely ${m.perWatt(perWatt.likely)}), in consumer prices.${taxNote}`);
  if (t.estimatedPerWatt) out.push(`Some bounds of the cost range are estimated as +/-${pct(a.missing_range_spread.value)} around the sourced likely value because the source gives no verified bound.`);
  if (input.battery > 0) out.push(`${input.battery} battery ${input.battery === 1 ? 'system' : 'systems'} at ${m.money(battery.low)}-${m.money(battery.high)} each (likely ${m.money(battery.likely)}).`);

  // export policy
  switch (resolved.kind) {
    case 'net_metering':
      out.push(
        model.kind === 'tiered'
          ? `Net metering: solar output offsets kWh you would have bought, month by month through the tariff tiers; surplus is banked and used later at the retail rate. ${resolved.trueUp === 'pay_at_rate' ? 'kWh still banked at year end are paid at the policy rate.' : 'kWh still banked at year end are counted as zero (conservative).'}`
          : `Net metering with a flat average rate: each solar kWh offsets one you would have bought, up to your annual usage; surplus ${resolved.trueUp === 'pay_at_rate' ? 'is paid at the policy rate' : 'is counted as zero (conservative)'}.`,
      );
      break;
    case 'net_billing':
    case 'feed_in':
      out.push(
        `${resolved.kind === 'feed_in' ? 'Feed-in' : 'Net billing'}: ${pct(a.self_consumption_share[SHARE_KEY[input.battery]].low)}-${pct(a.self_consumption_share[SHARE_KEY[input.battery]].high)} of solar output is used at home, valued at ${m.perKwh(model.kind === 'avg' ? model.retailRate : 0)}; the rest is exported at ${first.rate ? `${m.perKwh(first.rate.low)}-${m.perKwh(first.rate.high)} (likely ${m.perKwh(first.rate.likely)})` : 'the policy rate'}, held flat over time.${first.dailyCapKwh !== null ? ` Exports are capped at ${first.dailyCapKwh} kWh a day.` : ''}`,
      );
      if (resolved.estimatedBounds) out.push('Some bounds of the export rate are estimated around the sourced likely value because the source gives no verified bound.');
      break;
    case 'gross_metering':
      out.push('Gross metering: all solar output is sold at the buy-back rate and all your use is bought at retail, so your own bill does not fall; the saving is the buy-back income.');
      break;
    case 'none':
      out.push('No export payment: only the solar you use at home saves money; exported energy is worth nothing here.');
      break;
    case 'br_fio_b':
      out.push('Brazil (Lei 14.300): energy credits offset kWh, but a share of the Fio B grid-use component, set by calendar year, is not offset on exported energy.');
      break;
  }

  out.push(`Electricity rates rise ${pct(a.annual_rate_escalation.low)}-${pct(a.annual_rate_escalation.high)} a year (likely ${pct(a.annual_rate_escalation.likely)}).`);
  out.push(`Panel output falls ${pct(a.panel_degradation_per_year.value)} a year.`);
  out.push(`Payback and net savings use a ${a.analysis_years.value}-year projection with no discounting; payback beyond ${a.analysis_years.value} years is shown as more than ${a.analysis_years.value} years. All amounts are in ${market.currency}; nothing is converted from another currency.`);
  out.push('Ranges: size spans the offset targets; payback and net savings are for the likely size, the low end pairing the highest cost (and lowest incentive) with the lowest savings assumptions. For payback, the shortest (best case) is listed first.');
  out.push('Not included: financing costs, maintenance, inverter or battery replacement, and tax effects.');
  return out;
}

function buildWarnings(input: GlobalCalcInput, ctx: GlobalCalcContext, model: RateModel, sizing: ReturnType<typeof sizeSystem>, annualKwh: number): string[] {
  const { market, assumptions: a } = ctx;
  const m = moneyFormatter(market.locale, market.currency);
  const out: string[] = [];
  const cap = a.system_size_cap_kw.value;
  if (annualKwh === 0) {
    const floor = zeroUsageMonthlyBill(model);
    const what = floor > model.fixedMonthly ? `${m.cents(floor)} minimum monthly bill` : `${m.cents(model.fixedMonthly)} monthly fixed charge`;
    out.push(`Your ${m.cents(input.avgMonthlyBill)} bill is at or below the ${what}, so no energy usage can be estimated from it. Solar cannot reduce the fixed charge.`);
  } else if (sizing.belowMinimum) {
    out.push(`Your estimated usage needs only about a ${roundKw(sizing.size.likely)} kW system, below ${a.min_system_size_kw.value} kW. At this bill size solar may not make financial sense.`);
  }
  if (sizing.capped) out.push(`Your estimated usage would need more than ${cap} kW. The recommended size is capped at ${cap} kW, so solar would cover less of your bill.`);
  return out;
}
