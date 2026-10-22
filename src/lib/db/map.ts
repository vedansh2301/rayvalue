/**
 * Pure row <-> domain mappers for the calculator tables (supabase/migrations/0002_calculator_data.sql).
 *
 * rows -> domain: used by repo.ts on every load; the output is then validated with the Zod
 * schemas in src/data/schemas.ts (mappers never validate or invent values; they only reshape).
 * domain -> rows: used by admin scripts (one-off migration, tests) to write rows.
 *
 * Imports use explicit .ts extensions so admin scripts can run this file directly with Node.
 */
import type {
  Assumptions,
  CitiesFile,
  City,
  CityProduction,
  Costs,
  Offer,
  SourcedRange,
  State,
  TierSet,
  TouRate,
  Utility,
} from '../../data/schemas.ts';
import type { ProductionInput } from '../calc/types.ts';

// ----------------------------------------------------------------- row types

export type Verification = 'agent_sourced' | 'human_verified' | 'unverified';

export interface UtilityTierRow {
  position: number;
  up_to_kwh: number | null;
  rate_per_kwh: number | null;
  base_rate_per_kwh: number | null;
}

export interface UtilityTierSetRow {
  position: number;
  season: string;
  months: number[];
  utility_tiers?: UtilityTierRow[];
}

export interface UtilityTouRateRow {
  position: number;
  season: string;
  period: string;
  day_type: string;
  months: number[] | null;
  hours: string | null;
  rate_per_kwh: number | null;
}

export interface UtilityRow {
  id: string;
  display_order: number;
  name: string;
  state: string;
  metering_type: string;
  rate_schedule: string;
  rate_type: string;
  fixed_monthly_charge: number | null;
  fixed_charge_note: string | null;
  minimum_monthly_bill: number | null;
  minimum_bill_basis: string | null;
  minimum_bill_note: string | null;
  avg_export_credit_per_kwh: number | null;
  baseline_credit_per_kwh: number | null;
  rate_note: string | null;
  tou_note: string | null;
  source_url: string | null;
  verified_on: string | null;
  verification: string;
  source_caveat: string | null;
  avg_rate_low: number | null;
  avg_rate_likely: number | null;
  avg_rate_high: number | null;
  avg_rate_unit: string | null;
  avg_rate_note: string | null;
  avg_rate_source_url: string | null;
  avg_rate_verified_on: string | null;
  avg_rate_verification: string | null;
  /** PostgREST embeds (select=*,utility_tier_sets(*,utility_tiers(*)),utility_tou_rates(*)). */
  utility_tier_sets?: UtilityTierSetRow[];
  utility_tou_rates?: UtilityTouRateRow[];
}

export interface CostRangeRow {
  state: string;
  item: string;
  low: number | null;
  likely: number | null;
  high: number | null;
  unit: string;
  note: string | null;
  source_url: string | null;
  verified_on: string | null;
  verification: string;
}

export interface ModelAssumptionRow {
  key: string;
  state: string | null;
  value: Record<string, unknown>;
  unit: string | null;
  rationale: string;
}

export interface CityRow {
  state: string;
  slug: string;
  display_order: number;
  name: string;
  lat: number;
  lon: number;
  coords_zcta: string;
  coords_note: string;
  coords_source_url: string;
  coords_verified_on: string;
  default_utility_id: string;
  utility_confidence: string;
  utility_source_url: string;
  utility_source_note: string;
  published: boolean;
  local_notes: string[];
  intro_md: string | null;
}

export interface ProductionRow {
  state: string;
  slug: string;
  losses: number;
  annual_kwh_per_kw: number;
  monthly_kwh_per_kw: number[];
  fetched_on: string;
  source_url: string;
  endpoint: string;
  params: Record<string, unknown>;
  dataset_note: string;
  key_kind: string;
}

export interface OfferRow {
  state: string;
  partner_name: string;
  url: string | null;
  cta_text: string;
  active: boolean;
}

/**
 * Domain-shaped but NOT yet validated: string fields are not narrowed to their enums.
 * repo.ts runs the Zod schema over it to get the real domain type.
 */
type Unvalidated<T> = T extends readonly (infer E)[]
  ? Unvalidated<E>[]
  : T extends object
    ? { [K in keyof T]: Unvalidated<T[K]> }
    : T extends string
      ? string
      : T;

const byPosition = <T extends { position: number }>(rows: readonly T[] | undefined): T[] => [...(rows ?? [])].sort((a, b) => a.position - b.position);

// ------------------------------------------------------------- rows -> domain

/** One utility row with its embedded tier sets / tiers / TOU rates. Empty child lists map to null (the schema then decides). */
export function utilityFromRow(u: UtilityRow): Unvalidated<Utility> {
  const sets = byPosition(u.utility_tier_sets);
  const tou = byPosition(u.utility_tou_rates);
  return {
    id: u.id,
    name: u.name,
    state: u.state,
    metering_type: u.metering_type,
    rate_schedule: u.rate_schedule,
    rate_type: u.rate_type,
    tier_sets: sets.length
      ? sets.map(
          (s): Unvalidated<TierSet> => ({
            season: s.season,
            months: s.months,
            tiers: byPosition(s.utility_tiers).map((t) => ({ up_to_kwh: t.up_to_kwh, rate_per_kwh: t.rate_per_kwh, base_rate_per_kwh: t.base_rate_per_kwh })),
          }),
        )
      : null,
    tou_rates: tou.length
      ? tou.map(
          (t): Unvalidated<TouRate> => ({
            season: t.season,
            period: t.period,
            day_type: t.day_type,
            months: t.months,
            hours: t.hours,
            rate_per_kwh: t.rate_per_kwh,
          }),
        )
      : null,
    avg_rate_per_kwh:
      u.avg_rate_unit === null
        ? null
        : {
            low: u.avg_rate_low,
            likely: u.avg_rate_likely,
            high: u.avg_rate_high,
            unit: u.avg_rate_unit,
            note: u.avg_rate_note,
            source_url: u.avg_rate_source_url,
            verified_on: u.avg_rate_verified_on,
            // A record without a verification is invalid; pass the null through so Zod reports it.
            verification: u.avg_rate_verification as string,
          },
    tou_note: u.tou_note,
    baseline_credit_per_kwh: u.baseline_credit_per_kwh,
    rate_note: u.rate_note,
    fixed_monthly_charge: u.fixed_monthly_charge,
    fixed_charge_note: u.fixed_charge_note,
    minimum_monthly_bill: u.minimum_monthly_bill,
    minimum_bill_basis: u.minimum_bill_basis,
    minimum_bill_note: u.minimum_bill_note,
    avg_export_credit_per_kwh: u.avg_export_credit_per_kwh,
    source_caveat: u.source_caveat,
    source_url: u.source_url,
    verified_on: u.verified_on,
    verification: u.verification,
  };
}

/** Rows in display order (display_order, then id). */
export function utilitiesFromRows(rows: readonly UtilityRow[]): Unvalidated<Utility>[] {
  return [...rows].sort((a, b) => a.display_order - b.display_order || a.id.localeCompare(b.id)).map(utilityFromRow);
}

function costLineFromRow(r: CostRangeRow): Unvalidated<SourcedRange> {
  return { low: r.low, likely: r.likely, high: r.high, unit: r.unit, note: r.note, source_url: r.source_url, verified_on: r.verified_on, verification: r.verification };
}

/** { FL: { installed_cost_per_watt, battery_installed_cost }, CA: {...} }. Missing rows are simply absent (Zod reports them). */
export function costsFromRows(rows: readonly CostRangeRow[]): Record<string, Record<string, Unvalidated<SourcedRange>>> {
  const out: Record<string, Record<string, Unvalidated<SourcedRange>>> = {};
  for (const r of rows) (out[r.state] ??= {})[r.item] = costLineFromRow(r);
  return out;
}

/**
 * Model assumptions as the domain object. A row with state = `state` overrides the
 * all-states row (state null) for the same key; with no `state`, only all-states rows are used.
 */
export function assumptionsFromRows(rows: readonly ModelAssumptionRow[], state?: State): Record<string, Record<string, unknown>> {
  const chosen = new Map<string, ModelAssumptionRow>();
  for (const r of rows) if (r.state === null) chosen.set(r.key, r);
  if (state) for (const r of rows) if (r.state === state) chosen.set(r.key, r);
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, r] of chosen) out[key] = { kind: 'assumption', rationale: r.rationale, ...r.value };
  return out;
}

export function cityFromRow(r: CityRow): Unvalidated<City> {
  return {
    slug: r.slug,
    name: r.name,
    state: r.state,
    lat: r.lat,
    lon: r.lon,
    coords_zcta: r.coords_zcta,
    default_utility_id: r.default_utility_id,
    utility_source_url: r.utility_source_url,
    utility_source_note: r.utility_source_note,
    utility_confidence: r.utility_confidence,
    published: r.published,
    local_notes: r.local_notes,
    intro_md: r.intro_md,
  };
}

const sortCities = (rows: readonly CityRow[]) => [...rows].sort((a, b) => a.display_order - b.display_order || a.state.localeCompare(b.state) || a.slug.localeCompare(b.slug));

export function citiesFromRows(rows: readonly CityRow[]): Unvalidated<City>[] {
  return sortCities(rows).map(cityFromRow);
}

/** The cities plus their (shared) coordinates source; null when there are no rows. */
export function citiesFileFromRows(rows: readonly CityRow[]): Unvalidated<CitiesFile> | null {
  const sorted = sortCities(rows);
  const first = sorted[0];
  if (!first) return null;
  return {
    coordinates_source: { description: first.coords_note, source_url: first.coords_source_url, verified_on: first.coords_verified_on },
    cities: sorted.map(cityFromRow),
  };
}

export function productionFromRow(r: ProductionRow): Unvalidated<CityProduction> {
  return {
    state: r.state,
    slug: r.slug,
    losses: r.losses,
    annual_kwh_per_kw: r.annual_kwh_per_kw,
    monthly_kwh_per_kw: r.monthly_kwh_per_kw,
    fetched_on: r.fetched_on,
    source_url: r.source_url,
    endpoint: r.endpoint,
    params: r.params as Record<string, string | number>,
    dataset_note: r.dataset_note,
    key_kind: r.key_kind,
  };
}

export function offerFromRow(r: OfferRow): Unvalidated<Offer> {
  return { state: r.state, partner_name: r.partner_name, url: r.url, cta_text: r.cta_text, active: r.active };
}

/** The calc engine's production input from a validated production record. */
export function toProductionInput(p: CityProduction): ProductionInput {
  return { annualKwhPerKw: p.annual_kwh_per_kw, monthlyKwhPerKw: p.monthly_kwh_per_kw };
}

// ------------------------------------------------------------- domain -> rows

/** Rows for one utility. Child rows reference their parent by utility_id / tier set index (ids are DB-generated). */
export function utilityToRows(u: Utility, displayOrder: number) {
  const a = u.avg_rate_per_kwh;
  const utility: Omit<UtilityRow, 'utility_tier_sets' | 'utility_tou_rates'> = {
    id: u.id,
    display_order: displayOrder,
    name: u.name,
    state: u.state,
    metering_type: u.metering_type,
    rate_schedule: u.rate_schedule,
    rate_type: u.rate_type,
    fixed_monthly_charge: u.fixed_monthly_charge,
    fixed_charge_note: u.fixed_charge_note,
    minimum_monthly_bill: u.minimum_monthly_bill,
    minimum_bill_basis: u.minimum_bill_basis,
    minimum_bill_note: u.minimum_bill_note,
    avg_export_credit_per_kwh: u.avg_export_credit_per_kwh,
    baseline_credit_per_kwh: u.baseline_credit_per_kwh,
    rate_note: u.rate_note,
    tou_note: u.tou_note,
    source_url: u.source_url,
    verified_on: u.verified_on,
    verification: u.verification,
    source_caveat: u.source_caveat,
    avg_rate_low: a?.low ?? null,
    avg_rate_likely: a?.likely ?? null,
    avg_rate_high: a?.high ?? null,
    avg_rate_unit: a?.unit ?? null,
    avg_rate_note: a?.note ?? null,
    avg_rate_source_url: a?.source_url ?? null,
    avg_rate_verified_on: a?.verified_on ?? null,
    avg_rate_verification: a?.verification ?? null,
  };
  const tierSets = (u.tier_sets ?? []).map((s, position) => ({
    row: { utility_id: u.id, position, season: s.season, months: [...s.months] },
    tiers: s.tiers.map((t, tp) => ({ position: tp, up_to_kwh: t.up_to_kwh, rate_per_kwh: t.rate_per_kwh, base_rate_per_kwh: t.base_rate_per_kwh })),
  }));
  const touRates = (u.tou_rates ?? []).map((t, position) => ({
    utility_id: u.id,
    position,
    season: t.season,
    period: t.period,
    day_type: t.day_type,
    months: t.months ? [...t.months] : null,
    hours: t.hours,
    rate_per_kwh: t.rate_per_kwh,
  }));
  return { utility, tierSets, touRates };
}

export function costsToRows(costs: Costs): CostRangeRow[] {
  return (['FL', 'CA'] as const).flatMap((state) =>
    (['installed_cost_per_watt', 'battery_installed_cost'] as const).map((item) => {
      const c = costs[state][item];
      return { state, item, low: c.low, likely: c.likely, high: c.high, unit: c.unit, note: c.note, source_url: c.source_url, verified_on: c.verified_on, verification: c.verification };
    }),
  );
}

/** All-states rows (state null). `units` optionally labels each key's value. */
export function assumptionsToRows(a: Assumptions, units: Partial<Record<keyof Assumptions, string>> = {}): ModelAssumptionRow[] {
  return (Object.keys(a) as (keyof Assumptions)[]).map((key) => {
    const { kind: _kind, rationale, ...value } = a[key] as { kind: 'assumption'; rationale: string } & Record<string, unknown>;
    return { key, state: null, value, unit: units[key] ?? null, rationale };
  });
}

export function citiesFileToRows(file: CitiesFile): CityRow[] {
  const src = file.coordinates_source;
  return file.cities.map((c, i) => ({
    state: c.state,
    slug: c.slug,
    display_order: i,
    name: c.name,
    lat: c.lat,
    lon: c.lon,
    coords_zcta: c.coords_zcta,
    coords_note: src.description,
    coords_source_url: src.source_url,
    coords_verified_on: src.verified_on,
    default_utility_id: c.default_utility_id,
    utility_confidence: c.utility_confidence,
    utility_source_url: c.utility_source_url,
    utility_source_note: c.utility_source_note,
    published: c.published,
    local_notes: [...c.local_notes],
    intro_md: c.intro_md,
  }));
}

export function productionToRow(p: CityProduction): ProductionRow {
  return { ...p, monthly_kwh_per_kw: [...p.monthly_kwh_per_kw], params: { ...p.params } };
}
