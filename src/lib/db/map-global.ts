/**
 * Pure mappers from validated global rows (src/data/schemas-global.ts) to the calculator's types
 * (src/lib/calc/global-types.ts, export-policy.ts, incentives.ts). Reshape only: no values are added or defaulted.
 * Row -> domain mappers for raw PostgREST rows live next to the loaders in repo-global.ts.
 */
import type { GlobalAssumptionsRecord, ExportPolicyRecord, GlobalCosts, IncentiveRecord, Market } from '../../data/schemas-global.ts';
import type { ExportPolicy } from '../calc/export-policy.ts';
import type { GlobalAssumptions, GlobalCostLine, MarketInfo } from '../calc/global-types.ts';
import type { Incentive } from '../calc/incentives.ts';

export const marketInfo = (m: Market): MarketInfo => ({
  code: m.code,
  currency: m.currency,
  locale: m.locale,
  pricesIncludeTax: m.prices_include_tax,
  vatRate: m.vat_rate,
  displayRound: m.display_round,
});

export const calcExportPolicy = (p: ExportPolicyRecord): ExportPolicy => ({
  id: p.id,
  kind: p.kind,
  trueUp: p.true_up,
  rates: p.rates.map((r) => ({
    validFrom: r.valid_from,
    validTo: r.valid_to,
    yearsFrom: r.years_from,
    yearsTo: r.years_to,
    low: r.rate_low,
    likely: r.rate_likely,
    high: r.rate_high,
    dailyCapKwh: r.daily_cap_kwh,
    fioBPerKwh: r.fio_b_per_kwh,
    fioBNonOffsetShare: r.fio_b_non_offset_share,
  })),
});

export const calcIncentive = (i: IncentiveRecord): Incentive => ({
  id: i.id,
  name: i.name,
  appliesTo: i.applies_to,
  amountType: i.amount_type,
  amountLow: i.amount_low,
  amountLikely: i.amount_likely,
  amountHigh: i.amount_high,
  capAmount: i.cap_amount,
  capPercentOfCost: i.cap_percent_of_cost,
  maxKw: i.max_kw,
  maxKwh: i.max_kwh,
  taxable: i.taxable,
  excludesExportKind: i.excludes_export_kind,
  status: i.status,
  effectiveFrom: i.effective_from,
  effectiveTo: i.effective_to,
});

export const calcCostLine = (c: GlobalCosts['installed_cost_per_watt']): GlobalCostLine => ({ line: c.line, includesTax: c.includes_tax });

export function calcAssumptions(a: GlobalAssumptionsRecord): GlobalAssumptions {
  return {
    target_offset: { low: a.target_offset.low, high: a.target_offset.high },
    system_size_cap_kw: { value: a.system_size_cap_kw.value },
    min_system_size_kw: { value: a.min_system_size_kw.value },
    max_monthly_bill: { value: a.max_monthly_bill.value },
    panel_degradation_per_year: { value: a.panel_degradation_per_year.value },
    analysis_years: { value: a.analysis_years.value },
    missing_range_spread: { value: a.missing_range_spread.value },
    annual_rate_escalation: { low: a.annual_rate_escalation.low, likely: a.annual_rate_escalation.likely, high: a.annual_rate_escalation.high },
    self_consumption_share: {
      solar_only: a.self_consumption_share.solar_only,
      solar_plus_1_battery: a.self_consumption_share.solar_plus_1_battery,
      solar_plus_2_batteries: a.self_consumption_share.solar_plus_2_batteries,
    },
    system_loss_pct: { none: a.pvwatts_system_loss_pct.none, some: a.pvwatts_system_loss_pct.some, heavy: a.pvwatts_system_loss_pct.heavy },
  };
}

/**
 * model_assumptions rows for one market as the validation shape: a region row overrides the country-wide row
 * (region null) for the same key. Rows of other countries/regions are ignored.
 */
export function globalAssumptionsFromRows(
  rows: readonly { key: string; country: string; state: string | null; value: Record<string, unknown>; rationale: string }[],
  country: string,
  region?: string,
): Record<string, Record<string, unknown>> {
  const chosen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (r.country === country && r.state === null) chosen.set(r.key, r);
  if (region) for (const r of rows) if (r.country === country && r.state === region) chosen.set(r.key, r);
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, r] of chosen) out[key] = { kind: 'assumption', rationale: r.rationale, ...r.value };
  return out;
}

export const batteryUsableKwh = (a: GlobalAssumptionsRecord): number | null => a.battery_usable_kwh?.value ?? null;
