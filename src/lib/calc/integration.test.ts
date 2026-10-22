/**
 * calculate() over every REAL utility in src/data/utilities.json. Each one must either
 * compute, or return missing_data listing exactly the null values it needs (computed
 * independently here from the data), each of which must also be listed in
 * docs/TODO-VERIFY.md. Production is an illustrative stand-in, not data.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assumptions, costs, utilities, type Utility } from '../../data/index';
import { calculate } from './calculate';
import type { BatteryCount, CalcSuccess, Range } from './types';

const ZIP = { FL: '33101', CA: '94102' } as const;
const PRODUCTION = { annualKwhPerKw: 1450 }; // illustrative only
const todo = readFileSync(fileURLToPath(new URL('../../../docs/TODO-VERIFY.md', import.meta.url)), 'utf8');

/** Independent list of the null values a calculation for `u` needs. */
function expectedMissing(u: Utility, battery: BatteryCount): string[] {
  const p = `utilities.json[${u.id}]`;
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
    // Unknown minimum-bill basis, or a stated minimum without an amount.
    if (u.minimum_bill_basis === null || (u.minimum_bill_basis !== 'none' && u.minimum_monthly_bill === null)) out.push(`${p}.minimum_monthly_bill`);
  } else {
    if (u.fixed_monthly_charge === null) out.push(`${p}.fixed_monthly_charge`);
    if (u.avg_rate_per_kwh?.likely == null) out.push(`${p}.avg_rate_per_kwh.likely`);
    if (u.avg_export_credit_per_kwh === null) out.push(`${p}.avg_export_credit_per_kwh`);
  }
  const c = costs[u.state];
  if (c.installed_cost_per_watt.likely === null) out.push(`costs.json.${u.state}.installed_cost_per_watt.likely`);
  if (battery > 0 && c.battery_installed_cost.likely === null) out.push(`costs.json.${u.state}.battery_installed_cost.likely`);
  return out;
}

const ordered = (r: Range) => r.low <= r.likely && r.likely <= r.high;

describe.each(utilities.map((u) => [u.id, u] as const))('real utility %s', (_id, u) => {
  for (const battery of [0, 1, 2] as const) {
    for (const bill of [60, 150, 250, 600]) {
      it(`battery ${battery}, $${bill} bill`, () => {
        const r = calculate(
          { zip: ZIP[u.state], utilityId: u.id, avgMonthlyBill: bill, battery, shading: 'none' },
          { utilities, costs, assumptions, production: PRODUCTION },
        );
        const missing = expectedMissing(u, battery);
        if (missing.length) {
          expect(r).toEqual({ ok: false, reason: 'missing_data', missing });
          for (const m of missing) expect(todo, m).toContain(`\`${m}\``);
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
        // Real cost bounds are null today, so the ±spread line must be present when they are.
        if (costs[u.state].installed_cost_per_watt.low === null) {
          expect(s.assumptions.some((a) => a.includes('installed cost per watt range') && a.includes('±15%'))).toBe(true);
        }
      });
    }
  }
});

it('FPL and Duke apply their sourced $30 minimum on base charges', () => {
  for (const id of ['fpl', 'duke-fl'] as const) {
    const u = utilities.find((x) => x.id === id)!;
    expect([u.minimum_monthly_bill, u.minimum_bill_basis]).toEqual([30, 'base_charges']);
    const r = calculate({ zip: ZIP.FL, utilityId: id, avgMonthlyBill: 200, battery: 0, shading: 'none' }, { utilities, costs, assumptions, production: PRODUCTION });
    expect(r.ok && r.assumptions.some((a) => a.includes('$30.00 minimum monthly bill applies to base charges'))).toBe(true);
  }
});

it('real data today: FPL and Duke compute; TECO and every CA utility are blocked on named nulls', () => {
  const run = (id: string, state: 'FL' | 'CA') =>
    calculate({ zip: ZIP[state], utilityId: id, avgMonthlyBill: 200, battery: 0, shading: 'none' }, { utilities, costs, assumptions, production: PRODUCTION });
  expect(run('fpl', 'FL').ok).toBe(true);
  expect(run('duke-fl', 'FL').ok).toBe(true);
  // These expectations document the data as of this commit; update them when the owner fills the values.
  expect(run('teco', 'FL')).toEqual({
    ok: false,
    reason: 'missing_data',
    missing: ['utilities.json[teco].fixed_monthly_charge', 'utilities.json[teco].minimum_monthly_bill'],
  });
  for (const id of ['pge', 'sce', 'sdge']) {
    expect(run(id, 'CA')).toEqual({ ok: false, reason: 'missing_data', missing: [`utilities.json[${id}].avg_export_credit_per_kwh`] });
  }
});
