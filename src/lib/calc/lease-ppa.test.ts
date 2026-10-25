/** Lease/PPA comparison on hand-worked SYNTHETIC numbers (never shipped; the real terms are database assumptions). */
import { describe, expect, it } from 'vitest';
import { compareFinancing, type FinancingInput, type NullableRange } from './lease-ppa';

const base: FinancingInput = { sizeKw: 10, year1ProductionKwh: 15000, degradationPerYear: 0, yearlySavings: [2000, 2000, 2000] };
const r = (low: number, likely: number, high: number): NullableRange => ({ low, likely, high });
const empty: NullableRange = { low: null, likely: null, high: null };

describe('compareFinancing', () => {
  it('is unavailable (with the missing names) when the terms are absent or null', () => {
    expect(compareFinancing(base, undefined)).toEqual({
      lease: { available: false, missing: ['lease_monthly_per_kw', 'lease_annual_escalator'] },
      ppa: { available: false, missing: ['ppa_rate_per_kwh', 'ppa_annual_escalator'] },
    });
    const nulls = compareFinancing(base, { lease_monthly_per_kw: empty, lease_annual_escalator: empty, ppa_rate_per_kwh: empty, ppa_annual_escalator: empty });
    expect(nulls.lease.available).toBe(false);
    expect(nulls.ppa.available).toBe(false);
  });

  it('needs the escalator too (it is never defaulted to 0)', () => {
    const c = compareFinancing(base, { lease_monthly_per_kw: r(10, 12, 14) });
    expect(c.lease).toEqual({ available: false, missing: ['lease_annual_escalator'] });
  });

  it('lease: $/kW/month × kW × 12, flat escalator 0', () => {
    // payments per year: low 10×10×12=1,200 | likely 1,440 | high 1,680. Savings 6,000 over 3 years.
    const c = compareFinancing(base, { lease_monthly_per_kw: r(10, 12, 14), lease_annual_escalator: r(0, 0, 0) });
    expect(c.lease).toEqual({
      available: true,
      year1Payment: { low: 1200, likely: 1400, high: 1700 },
      // net: high payments 6,000 − 5,040 = 960 → 1,000 | likely 6,000 − 4,320 = 1,680 → 1,700 | low payments 6,000 − 3,600 = 2,400
      netSavings: { low: 1000, likely: 1700, high: 2400 },
    });
  });

  it('lease: escalator grows payments year over year', () => {
    // 12 × 10 × 12 = 1,440; ×1.1 = 1,584; ×1.21 = 1,742.4 → 4,766.4. 6,000 − 4,766.4 = 1,233.6 → 1,200
    const c = compareFinancing(base, { lease_monthly_per_kw: r(12, 12, 12), lease_annual_escalator: r(0.1, 0.1, 0.1) });
    expect(c.lease.available && c.lease.netSavings).toEqual({ low: 1200, likely: 1200, high: 1200 });
  });

  it('ppa: $/kWh × production, production degrades', () => {
    // kWh 15,000 / 13,500 / 12,150 = 40,650. Payments: low 0.08 → 3,252 | likely 0.10 → 4,065 | high 0.12 → 4,878
    const c = compareFinancing({ ...base, degradationPerYear: 0.1 }, { ppa_rate_per_kwh: r(0.08, 0.1, 0.12), ppa_annual_escalator: r(0, 0, 0) });
    expect(c.ppa).toEqual({
      available: true,
      year1Payment: { low: 1200, likely: 1500, high: 1800 },
      netSavings: { low: 1100, likely: 1900, high: 2700 },
    });
  });

  it('can show a negative net result and is unavailable without savings or size', () => {
    const c = compareFinancing(base, { lease_monthly_per_kw: r(30, 30, 30), lease_annual_escalator: r(0, 0, 0) });
    // 30×10×12 = 3,600/yr × 3 = 10,800; 6,000 − 10,800 = −4,800
    expect(c.lease.available && c.lease.netSavings.likely).toBe(-4800);
    expect(compareFinancing({ ...base, yearlySavings: [] }, { lease_monthly_per_kw: r(1, 1, 1), lease_annual_escalator: r(0, 0, 0) }).lease.available).toBe(false);
  });
});
