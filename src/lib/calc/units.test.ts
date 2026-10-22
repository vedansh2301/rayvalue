/**
 * Unit tests for the engine's building blocks, on SYNTHETIC fixtures (test-fixtures.ts).
 * Every expected value is worked by hand in the comment next to it.
 */
import { describe, expect, it } from 'vitest';
import { costRange, fillSourcedRange } from './cost';
import { lossesForShading, monthlyShares, validateProduction } from './production';
import { netSavings, paybackYears, projectSavings } from './payback';
import { resolveRates, type AvgRates, type TieredRates } from './rates';
import { roundKw, roundKwh, roundPayback, roundUsd, roundYears } from './round';
import { caSavingsYear, flSavingsYear } from './savings';
import { sizeSystem } from './sizing';
import { monthSpan, pct } from './text';
import { annualBillCost, estimateAnnualKwh, invertTieredBill, tierEnergyCost } from './usage';
import { caFixture, clone, fixtureAssumptions as A, fixtureCosts, flSeasonal, flTwoTier } from './test-fixtures';

const tiered = (u: typeof flTwoTier): TieredRates => {
  const r = resolveRates(u);
  if (!r.ok || r.value.kind !== 'tiered') throw new Error('fixture should resolve to tiered');
  return r.value;
};
const avg = (u: typeof caFixture): AvgRates => {
  const r = resolveRates(u);
  if (!r.ok || r.value.kind !== 'avg') throw new Error('fixture should resolve to avg');
  return r.value;
};

const TWO = tiered(flTwoTier);
const SEAS = tiered(flSeasonal);
const CA = avg(caFixture);

describe('resolveRates', () => {
  it('expands tier sets to 12 calendar months', () => {
    expect(TWO.monthTiers).toHaveLength(12);
    expect(SEAS.monthTiers[0]![1]!.rate).toBe(0.16); // Jan = winter
    expect(SEAS.monthTiers[2]![1]!.rate).toBe(0.2); // Mar = summer
    expect(SEAS.monthTiers[11]![0]!.rate).toBe(0.12); // Dec = winter
  });

  it('lists every null it needs, using TODO-VERIFY path spelling', () => {
    const u = clone(flSeasonal);
    u.tier_sets![1]!.tiers[1]!.rate_per_kwh = null;
    u.fixed_monthly_charge = null;
    expect(resolveRates(u)).toEqual({
      ok: false,
      missing: ['utilities.json[duke-fl].tier_sets[winter].tiers[1].rate_per_kwh', 'utilities.json[duke-fl].fixed_monthly_charge'],
    });
    const c = clone(caFixture);
    c.avg_export_credit_per_kwh = null;
    c.avg_rate_per_kwh!.likely = null;
    expect(resolveRates(c)).toEqual({
      ok: false,
      missing: ['utilities.json[pge].avg_rate_per_kwh.likely', 'utilities.json[pge].avg_export_credit_per_kwh'],
    });
  });

  it('does not need CA avg rate low/high', () => {
    // caFixture has avg_rate_per_kwh.low/high = null and still resolves.
    expect(resolveRates(caFixture).ok).toBe(true);
  });
});

describe('usage', () => {
  it('prices kWh through tiers', () => {
    expect(tierEnergyCost(TWO.monthTiers[0]!, 0)).toBe(0);
    expect(tierEnergyCost(TWO.monthTiers[0]!, 600)).toBeCloseTo(60, 9); // 600 × 0.10
    expect(tierEnergyCost(TWO.monthTiers[0]!, 1000)).toBeCloseTo(100, 9); // 1000 × 0.10
    expect(tierEnergyCost(TWO.monthTiers[0]!, 1500)).toBeCloseTo(175, 9); // 100 + 500 × 0.15
  });

  it('two-tier: $185 bill → 1,500 kWh/month → 18,000 kWh/yr', () => {
    // energy = 185 − 10 = 175 = 1000 × 0.10 (100) + 500 × 0.15 (75) → 1,500 kWh
    expect(invertTieredBill(TWO, 185)).toBeCloseTo(1500, 5);
    expect(estimateAnnualKwh(185, TWO)).toBeCloseTo(18000, 4);
    // inside tier 1: $70 → (70 − 10) / 0.10 = 600 kWh
    expect(invertTieredBill(TWO, 70)).toBeCloseTo(600, 5);
  });

  it('seasonal: annual bill sums each month through its own set', () => {
    // x ≥ 1000: 9 × (100 + 0.20(x − 1000)) + 3 × (120 + 0.16(x − 1000)) + 12 × 12
    //         = 1404 + 2.28 (x − 1000). x = 1500 → 1404 + 1140 = 2544
    expect(annualBillCost(SEAS, 1500)).toBeCloseTo(2544, 9);
    // x = 500: 9 × 50 + 3 × 60 + 144 = 774
    expect(annualBillCost(SEAS, 500)).toBeCloseTo(774, 9);
  });

  it('seasonal: inverts the annual bill (bill $212 → 1,500 kWh; $64.50 → 500 kWh)', () => {
    // 2544 / 12 = 212; 774 / 12 = 64.5
    expect(invertTieredBill(SEAS, 212)).toBeCloseTo(1500, 5);
    expect(invertTieredBill(SEAS, 64.5)).toBeCloseTo(500, 5);
  });

  it('bisection is tight: re-pricing the estimate reproduces the bill', () => {
    for (const bill of [13, 50, 99.99, 150, 212, 480.37, 2500]) {
      const kwh = invertTieredBill(SEAS, bill);
      expect(Math.abs(annualBillCost(SEAS, kwh) - bill * 12)).toBeLessThan(1e-5);
    }
  });

  it('bill at or below the fixed charge → 0 kWh', () => {
    expect(invertTieredBill(TWO, 10)).toBe(0);
    expect(invertTieredBill(TWO, 5)).toBe(0);
    expect(estimateAnnualKwh(20, CA)).toBe(0);
  });

  it('CA: (bill − fixed) ÷ average rate', () => {
    // (170 − 20) / 0.30 = 500 kWh/month → 6,000 kWh/yr
    expect(estimateAnnualKwh(170, CA)).toBeCloseTo(6000, 9);
  });
});

describe('production', () => {
  it('maps shading to PVWatts losses, monotone', () => {
    expect([lossesForShading('none', A), lossesForShading('some', A), lossesForShading('heavy', A)]).toEqual([14, 20, 30]);
  });

  it('splits evenly without a monthly profile, normalizes one if given', () => {
    expect(monthlyShares({ annualKwhPerKw: 1500 })).toEqual(Array(12).fill(1 / 12));
    const shares = monthlyShares({ annualKwhPerKw: 1500, monthlyKwhPerKw: [2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
    expect(shares[0]).toBeCloseTo(2 / 14, 12); // 2 / (2 + 2 + 10 × 1)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('rejects malformed production (caller bug)', () => {
    expect(() => validateProduction({ annualKwhPerKw: 0 })).toThrow(RangeError);
    expect(() => validateProduction({ annualKwhPerKw: NaN })).toThrow(RangeError);
    expect(() => validateProduction({ annualKwhPerKw: 1500, monthlyKwhPerKw: [1, 2, 3] })).toThrow(RangeError);
    expect(() => validateProduction({ annualKwhPerKw: 1500, monthlyKwhPerKw: Array(12).fill(0) })).toThrow(RangeError);
    expect(() => validateProduction({ annualKwhPerKw: 1500, monthlyKwhPerKw: [-1, ...Array(11).fill(1)] })).toThrow(RangeError);
  });
});

describe('sizing', () => {
  it('kW = annual kWh × offset ÷ kWh/kW-yr', () => {
    // 18,000 × 0.90 / 1,500 = 10.8; × 0.95 → 11.4; × 1.00 → 12.0
    const s = sizeSystem(18000, 1500, A);
    expect(s.offset).toEqual({ low: 0.9, likely: 0.95, high: 1.0 });
    expect(s.size.low).toBeCloseTo(10.8, 9);
    expect(s.size.likely).toBeCloseTo(11.4, 9);
    expect(s.size.high).toBeCloseTo(12, 9);
    expect(s.capped).toBe(false);
    expect(s.belowMinimum).toBe(false);
  });

  it('caps each end and flags it', () => {
    // 21,000 × 0.90 / 1,500 = 12.6 (kept); × 0.95 = 13.3 (kept); × 1.00 = 14 → cap 15 not hit
    expect(sizeSystem(21000, 1500, A).capped).toBe(false);
    // 24,000 × 0.90 / 1,500 = 14.4 (kept); × 0.95 = 15.2 → 15; × 1.00 = 16 → 15
    const s = sizeSystem(24000, 1500, A);
    expect(s.size.low).toBeCloseTo(14.4, 9);
    expect(s.size.likely).toBe(15);
    expect(s.size.high).toBe(15);
    expect(s.capped).toBe(true);
  });

  it('flags a likely size below the minimum without resizing', () => {
    // 2,400 × 0.95 / 1,500 = 1.52 kW < 2 kW
    const s = sizeSystem(2400, 1500, A);
    expect(s.size.likely).toBeCloseTo(1.52, 9);
    expect(s.belowMinimum).toBe(true);
  });
});

describe('cost', () => {
  it('fills missing ends with the spread, never collapses to a point', () => {
    const line = { ...fixtureCosts.FL.installed_cost_per_watt, low: null, high: null };
    const r = fillSourcedRange(line, 'costs.json.FL.installed_cost_per_watt', 0.15);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 3.0 × 0.85 = 2.55; 3.0 × 1.15 = 3.45
    expect(r.value.range.low).toBeCloseTo(2.55, 12);
    expect(r.value.range.likely).toBe(3);
    expect(r.value.range.high).toBeCloseTo(3.45, 12);
    expect([r.value.estimatedLow, r.value.estimatedHigh]).toEqual([true, true]);

    const onlyHigh = fillSourcedRange({ ...fixtureCosts.FL.battery_installed_cost, high: null }, 'x', 0.15);
    // low stays sourced 10,000; high = 12,000 × 1.15 = 13,800
    expect(onlyHigh.ok && onlyHigh.value.range).toEqual({ low: 10000, likely: 12000, high: 12000 * 1.15 });
    expect(onlyHigh.ok && [onlyHigh.value.estimatedLow, onlyHigh.value.estimatedHigh]).toEqual([false, true]);
  });

  it('a null likely is missing data', () => {
    const line = { ...fixtureCosts.FL.installed_cost_per_watt, likely: null };
    expect(fillSourcedRange(line, 'costs.json.FL.installed_cost_per_watt', 0.15)).toEqual({
      ok: false,
      missing: ['costs.json.FL.installed_cost_per_watt.likely'],
    });
  });

  it('cost = kW × 1000 × $/W + batteries × battery cost, end by end', () => {
    // low 10.8 × 1000 × 2.5 + 2 × 10,000 = 47,000; likely 11.4 × 3000 + 24,000 = 58,200; high 12 × 3500 + 28,000 = 70,000
    const c = costRange({ low: 10.8, likely: 11.4, high: 12 }, { low: 2.5, likely: 3, high: 3.5 }, 2, { low: 10000, likely: 12000, high: 14000 });
    expect(c.low).toBeCloseTo(47000, 6);
    expect(c.likely).toBeCloseTo(58200, 6);
    expect(c.high).toBeCloseTo(70000, 6);
  });
});

describe('FL savings (month by month, kWh bank)', () => {
  it('even production below usage: re-prices the remaining kWh through the tiers', () => {
    // usage 1,500/mo costs $175 energy. Production 1,350 → billed 150 kWh → $15. Saving 160 × 12 = 1,920
    expect(flSavingsYear(TWO, 1500, Array(12).fill(1350))).toBeCloseTo(1920, 9);
    // production 1,500 = usage → billed 0 → 175 × 12 = 2,100
    expect(flSavingsYear(TWO, 1500, Array(12).fill(1500))).toBeCloseTo(2100, 9);
  });

  it('carries excess forward and values the year-end leftover at $0', () => {
    // usage 1,500 every month.
    // Jan prod 2,000: billed 0, bank 500, saving 175
    // Feb prod 1,200: avail 1,700 → billed 0, bank 200, saving 175
    // Mar prod 1,000: avail 1,200 → billed 300 ($30), bank 0, saving 145
    // Apr–Nov prod 1,500: billed 0, saving 175 × 8 = 1,400
    // Dec prod 1,800: billed 0, 300 kWh left in the bank → $0
    // total = 175 + 175 + 145 + 1,400 + 175 = 2,070
    const prod = [2000, 1200, 1000, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1800];
    expect(flSavingsYear(TWO, 1500, prod)).toBeCloseTo(2070, 9);
    // Without the bank Feb would bill 300 ($30) and Mar 500 ($50): 175×10 + 145 + 125 = 2,020; the bank adds $50.
  });

  it('seasonal sets price each month with its own tiers', () => {
    // usage 1,500; production 1,350 → billed 150 kWh each month
    // summer: 200 − 15 = 185 × 9 = 1,665; winter: 200 − 18 = 182 × 3 = 546; total 2,211
    expect(flSavingsYear(SEAS, 1500, Array(12).fill(1350))).toBeCloseTo(2211, 9);
  });

  it('never saves more than the energy part of the bill', () => {
    expect(flSavingsYear(TWO, 1500, Array(12).fill(99999))).toBeCloseTo(2100, 9);
  });
});

describe('CA savings', () => {
  it('self-consumed × retail + exported × export credit', () => {
    // usage 6,000; production 5,700; share 0.4 → self 2,280 × 0.30 = 684; export 3,420 × 0.04 = 136.8; total 820.8
    const r = caSavingsYear(CA, 6000, 5700, 0.4);
    expect(r.selfConsumedKwh).toBeCloseTo(2280, 9);
    expect(r.exportedKwh).toBeCloseTo(3420, 9);
    expect(r.retailValue).toBeCloseTo(684, 9);
    expect(r.exportValue).toBeCloseTo(136.8, 9);
    expect(r.total).toBeCloseTo(820.8, 9);
  });

  it('caps self-consumption at usage', () => {
    // usage 1,000; production 3,000 × 0.5 = 1,500 → capped at 1,000 × 0.30 = 300; export 2,000 × 0.04 = 80
    const r = caSavingsYear(CA, 1000, 3000, 0.5);
    expect(r.selfConsumedKwh).toBe(1000);
    expect(r.total).toBeCloseTo(380, 9);
  });
});

describe('payback', () => {
  it('interpolates inside the crossing year', () => {
    // 42,000 / 1,920 per year: after 21 years 40,320; (42,000 − 40,320) / 1,920 = 0.875 → 21.875
    expect(paybackYears(42000, projectSavings(25, () => 1920))).toBeCloseTo(21.875, 12);
    // exactly on a year boundary: 13,500 / 675 = 20
    expect(paybackYears(13500, projectSavings(25, () => 675))).toBeCloseTo(20, 12);
  });

  it('with escalation: geometric cumulative savings', () => {
    // s = 2,010 × 1.02^(n−1). cum after 14 = 100,500 × (1.02^14 − 1) = 32,107.62;
    // year 15 = 2,010 × 1.02^14 = 2,652.15; (34,200 − 32,107.62) / 2,652.15 = 0.789 → 14.789
    expect(paybackYears(34200, projectSavings(25, (n) => 2010 * 1.02 ** (n - 1)))).toBeCloseTo(14.7889, 3);
  });

  it('null when not reached within the period or no savings; 0 when nothing to pay back', () => {
    // 27,500 / 1,012.5 = 27.2 years > 25
    expect(paybackYears(27500, projectSavings(25, () => 1012.5))).toBeNull();
    expect(paybackYears(1000, projectSavings(25, () => 0))).toBeNull();
    expect(paybackYears(0, projectSavings(25, () => 0))).toBeNull();
    expect(paybackYears(0, projectSavings(25, () => 100))).toBe(0);
  });

  it('net savings = Σ savings − cost', () => {
    // 1,920 × 25 − 42,000 = 6,000
    expect(netSavings(42000, projectSavings(25, () => 1920))).toBeCloseTo(6000, 9);
  });
});

describe('round + text', () => {
  it('rounds to display precision without -0', () => {
    expect(roundKw(11.44)).toBe(11.4);
    expect(roundUsd(3375)).toBe(3400);
    expect(roundUsd(-40)).toBe(0);
    expect(Object.is(roundUsd(-40), 0)).toBe(true);
    expect(roundYears(14.789)).toBe(15);
    expect(roundYears(10.575)).toBe(10.5);
    expect(roundYears(11.74)).toBe(11.5);
    expect(roundYears(11.76)).toBe(12);
    expect(roundKwh(17_649)).toBe(17_600);
    expect(roundPayback({ low: 7.76, likely: null, high: null })).toEqual({ low: 8, likely: null, high: null });
  });

  it('formats month spans and percents', () => {
    expect(monthSpan([3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe('Mar–Nov');
    expect(monthSpan([12, 1, 2])).toBe('Dec–Feb');
    expect(monthSpan([1, 3])).toBe('Jan, Mar');
    expect(monthSpan([5])).toBe('May');
    expect(pct(0.045)).toBe('4.5%');
    expect(pct(0.005)).toBe('0.5%');
    expect(pct(1)).toBe('100%');
  });
});
