import type { AvgRates, RateModel, Resolved, TieredRates } from './rates';
import { caSavingsYear, flSavingsYearDetailed } from './savings';
import type { Range } from './types';

/**
 * Export-policy model: how a market pays for solar energy sent to the grid. Pure functions; the data
 * (policy + date-effective rate windows) comes from export_policies / export_policy_rates (migration 0027).
 *
 * kinds (all money in the market currency, no FX):
 *   net_metering    tiered or flat retail rates; exports bank kWh at retail. true_up decides year-end leftovers.
 *   net_billing     self-consumed kWh at retail + exported kWh at the export rate.
 *   feed_in         net_billing + optional daily export cap and a year-stepped rate.
 *   gross_metering  ALL production sold at the buy-back rate; all use bought at retail (so the bill is unchanged).
 *   none            exports are worth 0 (self-consumption only).
 *   br_fio_b        kWh netting where a calendar-year share of the Fio B component is NOT offset.
 */
export type ExportKind = 'net_metering' | 'net_billing' | 'feed_in' | 'gross_metering' | 'none' | 'br_fio_b';
export type TrueUp = 'forfeit' | 'pay_at_rate' | 'carry';

/** One date-effective rate row. ISO dates (YYYY-MM-DD); null = open end / unknown start. */
export interface RateWindow {
  validFrom: string | null;
  validTo: string | null;
  /** Year-of-system window (feed-in step schedules). */
  yearsFrom: number;
  yearsTo: number | null;
  low: number | null;
  likely: number | null;
  high: number | null;
  dailyCapKwh: number | null;
  fioBPerKwh: number | null;
  fioBNonOffsetShare: number | null;
}

export interface ExportPolicy {
  id: string;
  kind: ExportKind;
  trueUp: TrueUp | null;
  rates: readonly RateWindow[];
}

/** What applies in one system year (index 0 = year 1). */
export interface YearTerms {
  /** Export / buy-back rate per kWh (low = worst outcome, high = best). Null where the kind has no rate. */
  rate: Range | null;
  dailyCapKwh: number | null;
  /** br_fio_b only. */
  fioBPerKwh: number | null;
  fioBShare: number | null;
}

export interface ResolvedExport {
  kind: ExportKind;
  trueUp: TrueUp;
  /** length = analysis years. */
  terms: readonly YearTerms[];
  /** True when rate.low / rate.high were filled from the missing-range spread (not sourced). */
  estimatedBounds: boolean;
}

const NO_TERMS: YearTerms = { rate: null, dailyCapKwh: null, fioBPerKwh: null, fioBShare: null };

/** Legacy policy for today's US data: tiered = FL retail net metering, flat = CA net billing at one export credit. */
export function legacyExport(model: RateModel, years: number): ResolvedExport {
  if (model.kind === 'tiered') return { kind: 'net_metering', trueUp: 'forfeit', terms: Array.from({ length: years }, () => NO_TERMS), estimatedBounds: false };
  const rate: Range = { low: model.exportCredit, likely: model.exportCredit, high: model.exportCredit };
  return { kind: 'net_billing', trueUp: 'forfeit', terms: Array.from({ length: years }, () => ({ ...NO_TERMS, rate })), estimatedBounds: false };
}

/** Shift an ISO date by whole years (Feb 29 -> Feb 28 when the target year is not a leap year). */
export function shiftYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const ty = y + years;
  const leap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(ty).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ISO date strings compare correctly as text. A null bound is open. */
export function inWindow(date: string, from: string | null, to: string | null): boolean {
  return (from === null || from <= date) && (to === null || date <= to);
}

/**
 * Resolve a policy for an install date into per-year terms, or list every value that is missing.
 * - br_fio_b: the window is chosen per CALENDAR year (install year + n - 1); a year without a window (or with a
 *   null share / Fio B value) is missing data, so a schedule that ends in 2028 does not silently extend.
 * - other kinds: windows are chosen by the INSTALL date (valid_from..valid_to) and then by year of system
 *   (years_from..years_to). When several windows match the install date the latest valid_from wins.
 * A null low / high bound is filled as likely x (1 -/+ spread), like cost lines; a null likely is missing.
 */
export function resolveExport(policy: ExportPolicy, installDate: string, years: number, spread: number, model: RateModel): Resolved<ResolvedExport> {
  const p = `export_policies[${policy.id}]`;
  const missing: string[] = [];
  const kind = policy.kind;

  if (model.kind === 'tiered' && kind !== 'net_metering') {
    return { ok: false, missing: [`${p}.kind (${kind} needs a flat average retail rate; tiered tariffs support net_metering only)`] };
  }
  if (kind === 'net_metering' && policy.trueUp === 'carry') {
    return { ok: false, missing: [`${p}.true_up (carry is not modelled yet)`] };
  }
  const trueUp: TrueUp = policy.trueUp ?? 'forfeit';
  const terms: YearTerms[] = [];
  let estimated = false;

  const pick = (n: number): RateWindow | undefined => {
    const date = kind === 'br_fio_b' ? shiftYears(installDate, n - 1) : installDate;
    return policy.rates
      .filter((r) => inWindow(date, r.validFrom, r.validTo) && (kind === 'br_fio_b' || (n >= r.yearsFrom && (r.yearsTo === null || n <= r.yearsTo))))
      .sort((a, b) => (b.validFrom ?? '').localeCompare(a.validFrom ?? ''))[0];
  };
  const fill = (w: RateWindow): Range | null => {
    if (w.likely === null) return null;
    if (w.low === null || w.high === null) estimated = true;
    return { low: w.low ?? w.likely * (1 - spread), likely: w.likely, high: w.high ?? w.likely * (1 + spread) };
  };

  const needsRate = kind === 'net_billing' || kind === 'feed_in' || kind === 'gross_metering' || (kind === 'net_metering' && trueUp === 'pay_at_rate');
  for (let n = 1; n <= years; n++) {
    if (kind === 'none' || (kind === 'net_metering' && !needsRate)) {
      terms.push(NO_TERMS);
      continue;
    }
    const w = pick(n);
    if (!w) {
      const where = kind === 'br_fio_b' ? shiftYears(installDate, n - 1).slice(0, 4) : `year ${n}`;
      missing.push(`${p}.rates[${where}]`);
      terms.push(NO_TERMS);
      continue;
    }
    if (kind === 'br_fio_b') {
      const yr = shiftYears(installDate, n - 1).slice(0, 4);
      if (w.fioBPerKwh === null) missing.push(`${p}.rates[${yr}].fio_b_per_kwh`);
      if (w.fioBNonOffsetShare === null) missing.push(`${p}.rates[${yr}].fio_b_non_offset_share`);
      terms.push({ rate: null, dailyCapKwh: null, fioBPerKwh: w.fioBPerKwh, fioBShare: w.fioBNonOffsetShare });
      continue;
    }
    const rate = fill(w);
    if (!rate) {
      missing.push(`${p}.rates[year ${n}].rate_likely`);
      terms.push(NO_TERMS);
      continue;
    }
    terms.push({ rate, dailyCapKwh: kind === 'feed_in' ? w.dailyCapKwh : null, fioBPerKwh: null, fioBShare: null });
  }
  if (missing.length) return { ok: false, missing: collapseYears(missing) };
  return { ok: true, value: { kind, trueUp, terms, estimatedBounds: estimated } };
}

/** One path per cause: `...rates[year 1].x`, `...rates[year 2].x` ... collapse to the first year plus "(+N more years)". */
function collapseYears(paths: string[]): string[] {
  const out: string[] = [];
  const groups = new Map<string, { first: string; extra: number }>();
  for (const path of new Set(paths)) {
    const m = /^(.*\.rates\[year )\d+(\].*)$/.exec(path);
    if (!m) {
      out.push(path);
      continue;
    }
    const key = `${m[1]}|${m[2]}`;
    const g = groups.get(key);
    if (g) g.extra++;
    else {
      const entry = { first: path, extra: 0 };
      groups.set(key, entry);
      out.push(path);
    }
  }
  return out.map((p) => {
    for (const g of groups.values()) if (g.first === p && g.extra > 0) return `${p} (+${g.extra} more years)`;
    return p;
  });
}

/** Which end of the outcome range a calculation runs at. low = worst outcome, high = best. */
export type End = keyof Range;

export interface YearSavingsArgs {
  model: RateModel;
  terms: YearTerms;
  resolved: Pick<ResolvedExport, 'kind' | 'trueUp'>;
  end: End;
  annualUsageKwh: number;
  /** This year's production after degradation. */
  annualProductionKwh: number;
  monthlyProductionKwh: readonly number[];
  /** Share of production consumed at home (battery-dependent); unused by net_metering on tiered rates. */
  selfConsumptionShare: number;
  /** (1 + escalation)^(n-1). */
  rateGrowth: number;
}

/**
 * Bill savings of ONE system year under an export policy.
 *
 * Tiered rates (net_metering only): the monthly kWh bank, re-priced through each month's tiers, times rateGrowth;
 *   leftover kWh after December are $0 (forfeit) or paid at the policy rate (pay_at_rate, not escalated).
 * Flat average retail rate (all kinds):
 *   net_metering   min(production, usage) x retail x growth (+ leftover x rate when pay_at_rate)
 *   net_billing    self x retail x growth + exported x rate        (rate flat over time, like CA today)
 *   feed_in        as net_billing; exported kWh capped at dailyCap x 365 when a cap is set
 *   gross_metering production x rate (the bill itself is unchanged)
 *   none           self x retail x growth
 *   br_fio_b       self x retail x growth + exported x max(0, retail x growth - share x FioB)
 */
export function policySavingsYear(a: YearSavingsArgs): number {
  const { model, terms, end } = a;
  const kind = a.resolved.kind;

  if (model.kind === 'tiered') {
    const r = flSavingsYearDetailed(model as TieredRates, a.annualUsageKwh / 12, a.monthlyProductionKwh);
    let total = r.savings * a.rateGrowth;
    if (a.resolved.trueUp === 'pay_at_rate' && terms.rate) total += r.leftoverKwh * terms.rate[end];
    return total;
  }

  const m = model as AvgRates;
  const retail = m.retailRate;
  const rate = terms.rate ? terms.rate[end] : 0;

  switch (kind) {
    case 'net_metering': {
      const offset = Math.min(a.annualProductionKwh, a.annualUsageKwh);
      const leftover = a.annualProductionKwh - offset;
      return offset * retail * a.rateGrowth + (a.resolved.trueUp === 'pay_at_rate' ? leftover * rate : 0);
    }
    case 'net_billing': {
      const r = caSavingsYear({ ...m, exportCredit: rate }, a.annualUsageKwh, a.annualProductionKwh, a.selfConsumptionShare);
      return r.retailValue * a.rateGrowth + r.exportValue; // export rate held flat
    }
    case 'feed_in': {
      const r = caSavingsYear({ ...m, exportCredit: rate }, a.annualUsageKwh, a.annualProductionKwh, a.selfConsumptionShare);
      const cap = terms.dailyCapKwh === null ? Infinity : terms.dailyCapKwh * 365;
      return r.retailValue * a.rateGrowth + Math.min(r.exportedKwh, cap) * rate;
    }
    case 'gross_metering':
      return a.annualProductionKwh * rate;
    case 'none': {
      const self = Math.min(a.annualUsageKwh, a.annualProductionKwh * a.selfConsumptionShare);
      return self * retail * a.rateGrowth;
    }
    case 'br_fio_b': {
      const r = caSavingsYear({ ...m, exportCredit: 0 }, a.annualUsageKwh, a.annualProductionKwh, a.selfConsumptionShare);
      const perExported = Math.max(0, retail * a.rateGrowth - (terms.fioBShare ?? 0) * (terms.fioBPerKwh ?? 0));
      return r.retailValue * a.rateGrowth + r.exportedKwh * perExported;
    }
  }
}
