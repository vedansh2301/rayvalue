/**
 * SYNTHETIC test fixtures. These numbers are invented for hand-checkable arithmetic and
 * are never shipped or shown to users; they only feed src/lib/calc/*.test.ts.
 * Each fixture is validated against the real Zod schemas so it is a realistic shape.
 *
 * Shared fixture assumptions: offset 90% / 95% (midpoint) / 100%, cap 15 kW, min 2 kW,
 * degradation 0 (so year-n savings only move with escalation), 25 years, spread 15%,
 * max bill $5,000.
 */
import { AssumptionsSchema, CostsSchema, UtilitiesSchema, type Assumptions, type Costs, type Utility } from '../../data/schemas';

const prov = { source_url: 'https://example.com/synthetic-fixture', verified_on: '2026-01-01', verification: 'agent_sourced' as const };

const base = {
  baseline_credit_per_kwh: null,
  rate_note: null,
  tou_note: null,
  fixed_charge_note: null,
  minimum_bill_note: null,
  source_caveat: null,
  export_credit_source_url: null,
  export_credit_verified_on: null,
  export_credit_note: null,
  export_credit_verification: 'unverified' as const,
  ...prov,
};

const ALL_YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * FL two-tier, one all-year set: $10 fixed; first 1,000 kWh @ $0.10, rest @ $0.15.
 * Uses id "fpl" only so the type checks; every number is synthetic.
 */
export const flTwoTier: Utility = {
  ...base,
  id: 'fpl',
  name: 'Fixture FL Two-Tier (synthetic)',
  state: 'FL',
  metering_type: 'retail_net_metering',
  rate_schedule: 'FX-1',
  rate_type: 'tiered',
  tier_sets: [{ season: 'all_year', months: ALL_YEAR, tiers: [{ up_to_kwh: 1000, rate_per_kwh: 0.1, base_rate_per_kwh: null }, { up_to_kwh: null, rate_per_kwh: 0.15, base_rate_per_kwh: null }] }],
  tou_rates: null,
  avg_rate_per_kwh: null,
  fixed_monthly_charge: 10,
  minimum_monthly_bill: null,
  minimum_bill_basis: 'none',
  avg_export_credit_per_kwh: null,
};

/**
 * FL two-tier WITH a minimum bill on base charges (FPL-style): same all-in rates as
 * flTwoTier ($10 fixed; 1,000 kWh @ $0.10, rest @ $0.15), of which base energy is
 * $0.06 / $0.08 (clauses $0.04 / $0.07). Minimum $30 on base charges:
 *   bill(x) = max(30, 10 + base(x)) + clause(x)
 * base(x) reaches $20 (10 + 20 = 30) at x = 333.3 kWh. Uses id "teco" only for typing.
 */
export const flMinimum: Utility = {
  ...flTwoTier,
  id: 'teco',
  name: 'Fixture FL Minimum Bill (synthetic)',
  tier_sets: [
    {
      season: 'all_year',
      months: ALL_YEAR,
      tiers: [
        { up_to_kwh: 1000, rate_per_kwh: 0.1, base_rate_per_kwh: 0.06 },
        { up_to_kwh: null, rate_per_kwh: 0.15, base_rate_per_kwh: 0.08 },
      ],
    },
  ],
  minimum_monthly_bill: 30,
  minimum_bill_basis: 'base_charges',
};

/**
 * FL seasonal, two sets (Duke-like): $12 fixed.
 * summer (Mar–Nov, 9 months): first 1,000 kWh @ $0.10, rest @ $0.20
 * winter (Dec–Feb, 3 months): first 1,000 kWh @ $0.12, rest @ $0.16
 */
export const flSeasonal: Utility = {
  ...base,
  id: 'duke-fl',
  name: 'Fixture FL Seasonal (synthetic)',
  state: 'FL',
  metering_type: 'retail_net_metering',
  rate_schedule: 'FX-2',
  rate_type: 'tiered',
  tier_sets: [
    { season: 'summer', months: [3, 4, 5, 6, 7, 8, 9, 10, 11], tiers: [{ up_to_kwh: 1000, rate_per_kwh: 0.1, base_rate_per_kwh: null }, { up_to_kwh: null, rate_per_kwh: 0.2, base_rate_per_kwh: null }] },
    { season: 'winter', months: [12, 1, 2], tiers: [{ up_to_kwh: 1000, rate_per_kwh: 0.12, base_rate_per_kwh: null }, { up_to_kwh: null, rate_per_kwh: 0.16, base_rate_per_kwh: null }] },
  ],
  tou_rates: null,
  avg_rate_per_kwh: null,
  fixed_monthly_charge: 12,
  minimum_monthly_bill: null,
  minimum_bill_basis: 'none',
  avg_export_credit_per_kwh: null,
};

/** CA net billing: $20 fixed, published average retail $0.30/kWh, export credit $0.04/kWh. */
export const caFixture: Utility = {
  ...base,
  id: 'pge',
  name: 'Fixture CA (synthetic)',
  state: 'CA',
  metering_type: 'nem3_net_billing',
  rate_schedule: 'FX-TOU',
  rate_type: 'tou_summary',
  tier_sets: null,
  tou_rates: [{ season: 'summer', period: 'peak', day_type: 'all', months: null, hours: null, rate_per_kwh: 0.5 }],
  avg_rate_per_kwh: { low: null, likely: 0.3, high: null, unit: 'USD per kWh', note: null, ...prov },
  fixed_monthly_charge: 20,
  minimum_monthly_bill: null,
  minimum_bill_basis: 'not_applicable',
  avg_export_credit_per_kwh: 0.04,
  export_credit_source_url: 'https://example.com/synthetic-export-credit',
  export_credit_verified_on: '2026-01-02',
  export_credit_note: 'synthetic export credit note',
  export_credit_verification: 'agent_sourced',
};

export const fixtureUtilities: readonly Utility[] = UtilitiesSchema.parse([flTwoTier, flSeasonal, flMinimum, caFixture]);

const line = (low: number | null, likely: number | null, high: number | null, unit: string) => ({ low, likely, high, unit, note: null, ...prov });

/** FL $/W 2.5 / 3.0 / 3.6; CA $/W 2.4 / 3.2 / 3.6; battery (both) $10k / $12k / $14k. */
export const fixtureCosts: Costs = CostsSchema.parse({
  FL: { installed_cost_per_watt: line(2.5, 3.0, 3.6, 'USD per watt (synthetic)'), battery_installed_cost: line(10000, 12000, 14000, 'USD per battery (synthetic)') },
  CA: { installed_cost_per_watt: line(2.4, 3.2, 3.6, 'USD per watt (synthetic)'), battery_installed_cost: line(10000, 12000, 14000, 'USD per battery (synthetic)') },
});

const why = 'synthetic test fixture value';

/** Escalation FL 0% / 2% / 4%, CA 0% / 3% / 5%. Degradation 0. */
export const fixtureAssumptions: Assumptions = AssumptionsSchema.parse({
  pvwatts_system_loss_pct: { kind: 'assumption', rationale: why, none: 14, some: 20, heavy: 30 },
  target_offset: { kind: 'assumption', rationale: why, low: 0.9, high: 1.0 },
  system_size_cap_kw: { kind: 'assumption', rationale: why, value: 15 },
  min_system_size_kw: { kind: 'assumption', rationale: why, value: 2 },
  panel_degradation_per_year: { kind: 'assumption', rationale: why, value: 0 },
  analysis_years: { kind: 'assumption', rationale: why, value: 25 },
  annual_rate_escalation: { kind: 'assumption', rationale: why, FL: { low: 0, likely: 0.02, high: 0.04 }, CA: { low: 0, likely: 0.03, high: 0.05 } },
  ca_self_consumption_share: {
    kind: 'assumption',
    rationale: why,
    solar_only: { low: 0.3, likely: 0.4, high: 0.5 },
    solar_plus_1_battery: { low: 0.55, likely: 0.7, high: 0.8 },
    solar_plus_2_batteries: { low: 0.7, likely: 0.85, high: 0.95 },
  },
  missing_range_spread: { kind: 'assumption', rationale: why, value: 0.15 },
  max_monthly_bill: { kind: 'assumption', rationale: why, value: 5000 },
  pvwatts_array: { kind: 'assumption', rationale: why, tilt: 20, azimuth: 180, module_type: 0, array_type: 1, dataset: 'nsrdb' },
});

/**
 * Note: fixture values are chosen so no expected output lands exactly on a rounding
 * boundary (x.5 of the rounding unit), where float noise could flip the result.
 */

/** Real ZIPs (from the Census-derived maps) used only to pass state validation. */
export const FL_ZIP = '33101';
export const CA_ZIP = '94102';

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
