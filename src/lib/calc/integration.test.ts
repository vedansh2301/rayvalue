/**
 * LIVE-DATABASE integration test: calculate() over every REAL utility loaded from Supabase
 * through the site's repo (publishable key). Runs only when SUPABASE_URL and
 * SUPABASE_PUBLISHABLE_KEY are set (`npm run test:db` loads .env.local); skipped offline.
 * Each utility must either compute, or return missing_data listing exactly the null values
 * it needs (computed independently here). Production is an illustrative stand-in, not data.
 */
import { describe, expect, it } from 'vitest';
import type { Costs, Utility } from '../../data/schemas';
import { loadCalcConfig, type CalcConfig } from '../db/repo';
import { calculate } from './calculate';
import type { BatteryCount, CalcSuccess, Range } from './types';

const LIVE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
const ZIP = { FL: '33101', CA: '94102' } as const;
const PRODUCTION = { annualKwhPerKw: 1450 }; // illustrative only

async function load(state: 'FL' | 'CA'): Promise<CalcConfig> {
  const r = await loadCalcConfig(state);
  if (!r.ok) throw new Error(`loadCalcConfig(${state}): ${JSON.stringify(r.error)}`);
  return r.value;
}
const configs = LIVE ? await Promise.all([load('FL'), load('CA')]) : [];
const utilities = configs.flatMap((c) => c.utilities);
const costs = configs[0]?.costs as Costs;
const assumptions = configs[0]?.assumptions;
const assumptionsFor = (u: Utility) => configs.find((c) => c.state === u.state)!.assumptions;

/** Independent list of the null values a calculation for `u` needs. */
function expectedMissing(u: Utility, battery: BatteryCount): string[] {
  const p = `utilities[${u.id}]`;
  const out: string[] = [];
  if (u.rate_type === 'tiered') {
    const onBase = u.minimum_bill_basis === 'base_charges';
    for (const set of u.tier_sets!) {
      set.tiers.forEach((t, i) => {
        if (t.rate_per_kwh === null) out.push(`${p}.tier_sets[${set.season}].tiers[${i}].rate_per_kwh`);
        if (onBase && t.base_rate_per_kwh === null) out.push(`${p}.tier_sets[${set.season}].tiers[${i}].base_rate_per_kwh`);
      });
    }
    if (u.fixed_monthly_charge === null) out.push(`${p}.fixed_monthly_charge`);
    if (u.minimum_bill_basis === null || (u.minimum_bill_basis !== 'none' && u.minimum_monthly_bill === null)) out.push(`${p}.minimum_monthly_bill`);
  } else {
    if (u.fixed_monthly_charge === null) out.push(`${p}.fixed_monthly_charge`);
    if (u.avg_rate_per_kwh?.likely == null) out.push(`${p}.avg_rate_per_kwh.likely`);
    if (u.avg_export_credit_per_kwh === null) out.push(`${p}.avg_export_credit_per_kwh`);
  }
  const c = costs[u.state];
  if (c.installed_cost_per_watt.likely === null) out.push(`cost_ranges[${u.state}/installed_cost_per_watt].likely`);
  if (battery > 0 && c.battery_installed_cost.likely === null) out.push(`cost_ranges[${u.state}/battery_installed_cost].likely`);
  return out;
}

describe.skipIf(!LIVE)('live database', () => {
  it('loads at least one utility per state', () => {
    expect(configs.map((c) => c.utilities.length).every((n) => n > 0)).toBe(true);
    expect(assumptions).toBeDefined();
  });
});

const ordered = (r: Range) => r.low <= r.likely && r.likely <= r.high;

describe.skipIf(!LIVE).each(utilities.map((u) => [u.id, u] as const))('real utility %s', (_id, u) => {
  for (const battery of [0, 1, 2] as const) {
    for (const bill of [60, 150, 250, 600]) {
      it(`battery ${battery}, $${bill} bill`, () => {
        const r = calculate(
          { zip: ZIP[u.state], utilityId: u.id, avgMonthlyBill: bill, battery, shading: 'none' },
          { utilities, costs, assumptions: assumptionsFor(u), production: PRODUCTION },
        );
        const missing = expectedMissing(u, battery);
        if (missing.length) {
          expect(r).toEqual({ ok: false, reason: 'missing_data', missing });
          return;
        }
        expect(r.ok).toBe(true);
        const s = r as CalcSuccess;
        for (const range of [s.size, s.cost, s.year1Savings, s.netSavings25]) {
          expect(ordered(range), JSON.stringify(range)).toBe(true);
          expect(Object.values(range).every(Number.isFinite)).toBe(true);
        }
        // payback: low = best (shortest); null = longer than the projection, so nulls only at the top
        const { low, likely, high } = s.paybackYears;
        if (low === null) expect(likely).toBeNull();
        if (likely === null) expect(high).toBeNull();
        if (low !== null && likely !== null) expect(low).toBeLessThanOrEqual(likely);
        if (likely !== null && high !== null) expect(likely).toBeLessThanOrEqual(high);
        expect(s.year1Savings.low).toBeGreaterThan(0);
        expect(s.assumptions.some((a) => a.includes('expenditures after Dec 31, 2025'))).toBe(true);
        // When a real cost bound is null, the ±spread line must be present.
        if (costs[u.state].installed_cost_per_watt.low === null) {
          expect(s.assumptions.some((a) => a.includes('installed cost per watt range'))).toBe(true);
        }
      });
    }
  }
});
