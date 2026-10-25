/**
 * calculate() end to end on SYNTHETIC fixtures (test-fixtures.ts), with every expected
 * value worked by hand. Outputs are rounded: kW 0.1, $ nearest 100, years 0.5, kWh 100.
 *
 * Fixture assumptions: offset 0.90 / 0.95 / 1.00, cap 15 kW, min 2 kW, degradation 0,
 * 25 years, escalation FL 0 / 2% / 4%, CA 0 / 3% / 5% (export credit held flat).
 * Ranges: worst = high cost + low savings + low escalation; best = the reverse.
 * paybackYears.low is the best case; netSavings25.low is the worst case.
 */
import { describe, expect, it } from 'vitest';
import { calculate } from './calculate';
import type { CalcContext, CalcInput, CalcResult, CalcSuccess } from './types';
import { lookupZip } from '../geo';
import { CA_ZIP, FL_ZIP, caFixture, clone, fixtureAssumptions, fixtureCosts, fixtureUtilities, flMinimum, flSeasonal, flTwoTier } from './test-fixtures';

const ctx = (production = { annualKwhPerKw: 1500 } as CalcContext['production'], over: Partial<CalcContext> = {}): CalcContext => ({
  lookupZip,
  utilities: fixtureUtilities,
  costs: fixtureCosts,
  assumptions: fixtureAssumptions,
  production,
  ...over,
});

const fl = (bill: number, extra: Partial<CalcInput> = {}): CalcInput => ({ zip: FL_ZIP, utilityId: flTwoTier.id, avgMonthlyBill: bill, battery: 0, shading: 'none', ...extra });
const ca = (bill: number, extra: Partial<CalcInput> = {}): CalcInput => ({ zip: CA_ZIP, utilityId: caFixture.id, avgMonthlyBill: bill, battery: 0, shading: 'none', ...extra });

function ok(r: CalcResult): CalcSuccess {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason} ${JSON.stringify(r.missing ?? [])}`);
  return r;
}

describe('FL two-tier fixture: $185 bill, 1,500 kWh/kW-yr, even months', () => {
  // Usage: 185 − 10 fixed = 175 energy = 1,000 @ 0.10 + 500 @ 0.15 → 1,500 kWh/mo → 18,000 kWh/yr
  // Size:  18,000 × {0.90, 0.95, 1.00} / 1,500 = 10.8 / 11.4 / 12.0 kW
  // Displayed cost (size range): 10.8 × 2,500 = 27,000 | 11.4 × 3,000 = 34,200 | 12 × 3,600 = 43,200
  // Production per month (kW × 1,500 ÷ 12): 1,350 / 1,425 / 1,500 kWh, usage 1,500
  // Year-1 savings (size range): bill(1,500) − bill(billed); energy(1,500) = $175/mo
  //   low    billed 150 → $15 → 160 × 12 = 1,920
  //   likely billed  75 → $7.50 → 167.50 × 12 = 2,010
  //   high   billed   0 → 175 × 12 = 2,100
  // Outcome scenarios all use the likely 11.4 kW system, saving 2,010 in year 1:
  //   best   cost 11.4 × 2,500 = 28,500; 2,010 × 1.04^(n−1): cum11 = 50,250 × (1.04^11 − 1) = 27,107.57;
  //          yr12 = 2,010 × 1.04^11 = 3,094.30; 11 + 1,392.43 / 3,094.30 = 11.450 → 11.5
  //   likely cost 34,200; 2,010 × 1.02^(n−1): cum14 = 100,500 × (1.02^14 − 1) = 32,107.62;
  //          yr15 = 2,652.15; 14 + 2,092.38 / 2,652.15 = 14.789 → 15.0
  //   worst  cost 11.4 × 3,600 = 41,040; 2,010 flat: 20 + (41,040 − 40,200) / 2,010 = 20.418 → 20.5
  // Net 25 yr:
  //   worst  2,010 × 25 − 41,040 = 50,250 − 41,040 = 9,210 → 9,200
  //   likely 100,500 × (1.02^25 − 1) − 34,200 = 100,500 × 0.6406060 − 34,200 = 30,180.9 → 30,200
  //   best   50,250 × (1.04^25 − 1) − 28,500 = 50,250 × 1.6658363 − 28,500 = 55,208.3 → 55,200
  const r = ok(calculate(fl(185), ctx()));

  it('usage, size, cost', () => {
    expect(r.state).toBe('FL');
    expect(r.annualUsageKwh).toBe(18000);
    expect(r.size).toEqual({ low: 10.8, likely: 11.4, high: 12 });
    expect(r.cost).toEqual({ low: 27000, likely: 34200, high: 43200 });
  });

  it('year-1 savings', () => {
    expect(r.year1Savings).toEqual({ low: 1900, likely: 2000, high: 2100 });
  });

  it('payback (low = best case) and 25-year net, all for the likely size', () => {
    expect(r.paybackYears).toEqual({ low: 11.5, likely: 15, high: 20.5 });
    expect(r.netSavings25).toEqual({ low: 9200, likely: 30200, high: 55200 });
    expect(r.analysisYears).toBe(25);
  });

  it('states no federal credit (no percentage) and the FL model', () => {
    const fed = r.assumptions.find((s) => s.includes('25D'))!;
    expect(fed).toContain('expenditures after Dec 31, 2025');
    expect(fed).not.toMatch(/\d+\s*%/);
    expect(r.assumptions.some((s) => s.includes('annual estimate ÷ 12'))).toBe(true);
    expect(r.assumptions.some((s) => s.includes('counted as $0'))).toBe(true);
    expect(r.assumptions.some((s) => s.includes('$10.00 monthly fixed charge is never offset'))).toBe(true);
    expect(r.assumptions.some((s) => s.includes('$0.10/kWh for the first 1,000 kWh a month, then $0.15/kWh'))).toBe(true);
    expect(r.assumptions.some((s) => s.includes('Payback and net savings are for the likely size'))).toBe(true);
    expect(r.assumptions.some((s) => s.includes('minimum monthly bill'))).toBe(false); // basis "none"
    expect(r.assumptions.some((s) => s.includes('±'))).toBe(false); // fixture bounds are all sourced
    expect(r.warnings).toEqual([]);
  });

  it('monthly profile: kWh bank + year-end forfeit (shape only, normalized)', () => {
    // monthlyKwhPerKw ∝ [2000, 1200, 1000, 1500×8, 1800]/12, sums to 1,500 = annual.
    // high (12 kW) gets exactly [2000, 1200, 1000, 1500×8, 1800] → 2,070 (see units.test.ts)
    // low (10.8 kW) gets × 0.9 = [1800, 1080, 900, 1350×8, 1620]:
    //   Jan bank 300, saves 175 | Feb 1,380 avail → billed 120 ($12) saves 163 | Mar billed 600 ($60) saves 115
    //   Apr–Nov billed 150 ($15) saves 160 × 8 = 1,280 | Dec billed 0, 120 kWh forfeited, saves 175
    //   total 1,908 → 1,900
    const shape = [2000, 1200, 1000, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1800];
    const a = ok(calculate(fl(185), ctx({ annualKwhPerKw: 1500, monthlyKwhPerKw: shape.map((v) => v / 12) })));
    expect(a.year1Savings.high).toBe(2100); // 2,070 → 2,100
    expect(a.year1Savings.low).toBe(1900); // 1,908 → 1,900
    // Same shape at double scale: only the shape matters.
    const b = ok(calculate(fl(185), ctx({ annualKwhPerKw: 1500, monthlyKwhPerKw: shape.map((v) => v / 6) })));
    expect(b).toEqual(a);
    expect(a.assumptions.some((s) => s.includes('monthly production profile'))).toBe(true);
  });

  it('batteries add cost but no savings in FL', () => {
    // displayed cost + n × {10,000, 12,000, 14,000}
    const one = ok(calculate(fl(185, { battery: 1 }), ctx()));
    expect(one.cost).toEqual({ low: 37000, likely: 46200, high: 57200 });
    expect(one.year1Savings).toEqual(r.year1Savings);
    expect(one.assumptions.some((s) => s.includes('backup power only'))).toBe(true);
    // best: 28,500 + 10,000 = 38,500 at 2,010 × 1.04^(n−1): cum14 = 50,250 × (1.04^14 − 1) = 36,766.74;
    //   yr15 = 2,010 × 1.04^14 = 3,480.67; 14 + 1,733.26 / 3,480.67 = 14.498 → 14.5
    // worst: 41,040 + 14,000 = 55,040; 55,040 / 2,010 = 27.4 > 25 → null; net 50,250 − 55,040 = −4,790 → −4,800
    expect(one.paybackYears.low).toBe(14.5);
    expect(one.paybackYears.high).toBeNull();
    expect(one.netSavings25.low).toBe(-4800);
    const two = ok(calculate(fl(185, { battery: 2 }), ctx()));
    expect(two.cost).toEqual({ low: 47000, likely: 58200, high: 71200 });
    expect(two.year1Savings).toEqual(r.year1Savings);
    // worst: 41,040 + 28,000 = 69,040; net 50,250 − 69,040 = −18,790 → −18,800
    expect(two.paybackYears.high).toBeNull();
    expect(two.netSavings25.low).toBe(-18800);
  });
});

describe('FL seasonal fixture: $212 bill, two tier sets', () => {
  // Usage: annual bill(x) = 1,404 + 2.28 (x − 1,000) = 212 × 12 = 2,544 → x = 1,500 kWh/mo → 18,000/yr
  // Size and displayed cost as the two-tier fixture: 10.8/11.4/12.0 kW; 27,000/34,200/43,200
  // Year-1 savings (usage 1,500; summer bill energy 100 + 500 × 0.20 = 200; winter 120 + 500 × 0.16 = 200):
  //   low    billed 150: summer 200 − 15 = 185 × 9 = 1,665; winter 200 − 18 = 182 × 3 = 546 → 2,211 → 2,200
  //   likely billed  75: summer 200 − 7.5 = 192.5 × 9 = 1,732.5; winter 200 − 9 = 191 × 3 = 573 → 2,305.5 → 2,300
  //   high   billed   0: 200 × 12 = 2,400
  // Outcome scenarios at 11.4 kW (2,305.5/yr):
  //   worst  41,040 flat: 17 + (41,040 − 39,193.5) / 2,305.5 = 17.801 → 18.0; net 57,637.5 − 41,040 = 16,597.5 → 16,600
  //   likely 34,200 at 2%: cum13 = 115,275 × (1.02^13 − 1) = 33,845.50; yr14 = 2,305.5 × 1.02^13 = 2,982.41;
  //          13 + 354.50 / 2,982.41 = 13.119 → 13.0; net 115,275 × 0.6406060 − 34,200 = 39,645.9 → 39,600
  //   best   28,500 at 4%: cum10 = 57,637.5 × (1.04^10 − 1) = 27,680.08; yr11 = 2,305.5 × 1.04^10 = 3,412.70;
  //          10 + 819.92 / 3,412.70 = 10.240 → 10.0; net 57,637.5 × 1.6658363 − 28,500 = 67,514.6 → 67,500
  const r = ok(calculate(fl(212, { utilityId: flSeasonal.id }), ctx()));

  it('inverts the seasonal bill and prices each season', () => {
    expect(r.annualUsageKwh).toBe(18000);
    expect(r.size).toEqual({ low: 10.8, likely: 11.4, high: 12 });
    expect(r.cost).toEqual({ low: 27000, likely: 34200, high: 43200 });
    expect(r.year1Savings).toEqual({ low: 2200, likely: 2300, high: 2400 });
    expect(r.paybackYears).toEqual({ low: 10, likely: 13, high: 18 });
    expect(r.netSavings25).toEqual({ low: 16600, likely: 39600, high: 67500 });
  });

  it('describes both seasons', () => {
    const usage = r.assumptions.find((s) => s.startsWith('Annual usage'))!;
    expect(usage).toContain('summer (Mar–Nov): $0.10/kWh for the first 1,000 kWh a month, then $0.20/kWh');
    expect(usage).toContain('winter (Dec–Feb): $0.12/kWh for the first 1,000 kWh a month, then $0.16/kWh');
  });
});

describe('FL minimum-bill fixture: $30 minimum on base charges, solar drives the bill to the minimum', () => {
  // Same all-in rates as two-tier, base energy $0.06 / $0.08, clauses $0.04 / $0.07.
  // bill(x) = max(30, 10 + base(x)) + clause(x)
  // Usage $185: at x ≥ 1,000 base = 70 + 0.08(x − 1,000) > 30, so bill = 10 + all-in energy → 1,500 kWh (as two-tier)
  // bill(1,500) = 185. Year-1 savings (size range, even months):
  //   low    billed 150: base 10 + 9 = 19 → 30; clause 6 → bill 36 (no minimum: 25); saves 149 × 12 = 1,788 → 1,800
  //   likely billed  75: base 14.5 → 30; clause 3 → bill 33; saves 152 × 12 = 1,824 → 1,800
  //   high   billed   0: base 10 → 30; clause 0 → bill 30; saves 155 × 12 = 1,860 → 1,900
  //   (no minimum: 1,920 / 2,010 / 2,100, so the minimum costs $132–$240 a year)
  // Outcome scenarios at 11.4 kW (1,824/yr):
  //   worst  41,040 flat: 22 + (41,040 − 40,128) / 1,824 = 22.5; net 45,600 − 41,040 = 4,560 → 4,600
  //   likely 34,200 at 2%: cum16 = 91,200 × (1.02^16 − 1) = 33,998.06; yr17 = 1,824 × 1.02^16 = 2,503.96;
  //          16 + 201.94 / 2,503.96 = 16.081 → 16.0; net 91,200 × 0.6406060 − 34,200 = 24,223.3 → 24,200
  //   best   28,500 at 4%: cum12 = 45,600 × (1.04^12 − 1) = 27,407.07; yr13 = 1,824 × 1.04^12 = 2,920.28;
  //          12 + 1,092.93 / 2,920.28 = 12.374 → 12.5; net 45,600 × 1.6658363 − 28,500 = 47,462.1 → 47,500
  const r = ok(calculate(fl(185, { utilityId: flMinimum.id }), ctx()));

  it('usage unchanged above the minimum; savings floored by it', () => {
    expect(r.annualUsageKwh).toBe(18000);
    expect(r.year1Savings).toEqual({ low: 1800, likely: 1800, high: 1900 });
    expect(r.paybackYears).toEqual({ low: 12.5, likely: 16, high: 22.5 });
    expect(r.netSavings25).toEqual({ low: 4600, likely: 24200, high: 47500 });
    expect(r.assumptions.some((s) => s.includes('A $30.00 minimum monthly bill applies to base charges'))).toBe(true);
  });

  it('inverts bills inside the minimum region', () => {
    // $40: x ≤ 333.3 → bill = 30 + 0.04x = 40 → x = 250 kWh/mo → 3,000/yr
    expect(ok(calculate(fl(40, { utilityId: flMinimum.id }), ctx())).annualUsageKwh).toBe(3000);
    // $60: 333.3 < x ≤ 1,000 → bill = 10 + 0.10x = 60 → 500 kWh/mo → 6,000/yr
    expect(ok(calculate(fl(60, { utilityId: flMinimum.id }), ctx())).annualUsageKwh).toBe(6000);
    // $30 = the zero-usage bill → 0 usage, warning names the minimum
    const z = ok(calculate(fl(30, { utilityId: flMinimum.id }), ctx()));
    expect(z.annualUsageKwh).toBe(0);
    expect(z.warnings[0]).toContain('at or below the $30.00 minimum monthly bill');
  });
});

describe('CA fixture: $170 bill, 1,500 kWh/kW-yr, export credit $0.04', () => {
  // Usage: (170 − 20) / 0.30 = 500 kWh/mo → 6,000 kWh/yr
  // Size:  6,000 × {0.90, 0.95, 1.00} / 1,500 = 3.6 / 3.8 / 4.0 kW
  // Production: 5,400 / 5,700 / 6,000 kWh
  // Cost:  3.6 × 2,400 = 8,640 → 8,600 | 3.8 × 3,200 = 12,160 → 12,200 | 4.0 × 3,600 = 14,400
  // Year-1 savings (solar only, share 0.3 / 0.4 / 0.5):
  //   low    self 5,400 × 0.3 = 1,620 × 0.30 = 486;  export 3,780 × 0.04 = 151.2 → 637.2 → 600
  //   likely self 5,700 × 0.4 = 2,280 × 0.30 = 684;  export 3,420 × 0.04 = 136.8 → 820.8 → 800
  //   high   self 6,000 × 0.5 = 3,000 × 0.30 = 900;  export 3,000 × 0.04 = 120   → 1,020 → 1,000
  // Year n savings = retail × (1 + esc)^(n−1) + export (export held flat).
  // Outcome scenarios all use the likely 3.8 kW system (5,700 kWh):
  //   worst  share 0.3: 1,710 × 0.30 = 513 + 3,990 × 0.04 = 159.6 → 672.6/yr flat; cost 3.8 × 3,600 = 13,680
  //          20 + (13,680 − 13,452) / 672.6 = 20.339 → 20.5; net 16,815 − 13,680 = 3,135 → 3,100
  //   likely share 0.4: 684 × 1.03^(n−1) + 136.8; cost 12,160: cum12 = 22,800 × (1.03^12 − 1) + 12 × 136.8
  //          = 9,707.35 + 1,641.6 = 11,348.95; yr13 = 684 × 1.03^12 + 136.8 = 1,112.02; 12 + 811.05 / 1,112.02 = 12.729 → 12.5
  //          net 22,800 × (1.03^25 − 1) + 136.8 × 25 − 12,160 = 24,938.14 + 3,420 − 12,160 = 16,198.1 → 16,200
  //   best   share 0.5: 2,850 × 0.30 = 855 × 1.05^(n−1) + 2,850 × 0.04 = 114; cost 3.8 × 2,400 = 9,120
  //          cum8 = 17,100 × (1.05^8 − 1) + 8 × 114 = 8,164.49 + 912 = 9,076.49; yr9 = 855 × 1.05^8 + 114 = 1,377.22;
  //          8 + 43.51 / 1,377.22 = 8.032 → 8.0; net 17,100 × 2.3863549 + 2,850 − 9,120 = 34,536.7 → 34,500
  const r = ok(calculate(ca(170), ctx()));

  it('usage, size, cost', () => {
    expect(r.state).toBe('CA');
    expect(r.annualUsageKwh).toBe(6000);
    expect(r.size).toEqual({ low: 3.6, likely: 3.8, high: 4 });
    expect(r.cost).toEqual({ low: 8600, likely: 12200, high: 14400 });
  });

  it('year-1 savings, payback, net', () => {
    expect(r.year1Savings).toEqual({ low: 600, likely: 800, high: 1000 });
    expect(r.paybackYears).toEqual({ low: 8, likely: 12.5, high: 20.5 });
    expect(r.netSavings25).toEqual({ low: 3100, likely: 16200, high: 34500 });
  });

  it('states the CA model', () => {
    expect(r.assumptions.some((s) => s.includes('also recovers fixed costs') && s.includes('understate your usage'))).toBe(true);
    expect(r.assumptions.some((s) => s.includes('30%–50% (likely 40%) of solar output is used at home (solar only)'))).toBe(true);
    expect(r.assumptions.some((s) => s.includes('exported at $0.04/kWh'))).toBe(true);
    // The export credit cites its OWN source (not the tariff's), with its note.
    const exp = r.assumptions.find((s) => s.includes('exported at $0.04/kWh'))!;
    expect(exp).toContain('source: https://example.com/synthetic-export-credit, checked 2026-01-02; synthetic export credit note');
    expect(exp).not.toContain('example.com/synthetic-fixture');
    expect(r.assumptions.some((s) => s.includes('PVWatts model for a fixed roof-mounted array of standard modules tilted 20° and facing 180° (south), with NSRDB weather data'))).toBe(true);
    expect(r.assumptions.some((s) => s.includes('export credit is held flat'))).toBe(true);
    expect(r.assumptions.some((s) => s.includes('(your $170.00 average monthly bill − the $20.00 monthly fixed charge) ÷ $0.30/kWh'))).toBe(true);
    expect(r.assumptions.some((s) => s.includes('annual estimate ÷ 12'))).toBe(false);
  });

  it('1 battery: higher self-consumption and battery cost', () => {
    // shares 0.55 / 0.70 / 0.80
    //   low    5,400 × 0.55 = 2,970 × 0.30 = 891   + 2,430 × 0.04 = 97.2 → 988.2  → 1,000
    //   likely 5,700 × 0.70 = 3,990 × 0.30 = 1,197 + 1,710 × 0.04 = 68.4 → 1,265.4 → 1,300
    //   high   6,000 × 0.80 = 4,800 × 0.30 = 1,440 + 1,200 × 0.04 = 48   → 1,488  → 1,500
    // cost: 8,640 + 10,000 = 18,640 → 18,600 | 12,160 + 12,000 = 24,160 → 24,200 | 14,400 + 14,000 = 28,400
    // worst scenario at 3.8 kW, share 0.55: 3,135 × 0.30 = 940.5 + 2,565 × 0.04 = 102.6 → 1,043.1/yr; cost 13,680 + 14,000 = 27,680
    //   27,680 / 1,043.1 = 26.5 yr > 25 → null; net 26,077.5 − 27,680 = −1,602.5 → −1,600 (half away from zero)
    const b = ok(calculate(ca(170, { battery: 1 }), ctx()));
    expect(b.year1Savings).toEqual({ low: 1000, likely: 1300, high: 1500 });
    expect(b.cost).toEqual({ low: 18600, likely: 24200, high: 28400 });
    expect(b.paybackYears.high).toBeNull();
    expect(b.netSavings25.low).toBe(-1600);
    expect(b.assumptions.some((s) => s.includes('55%–80% (likely 70%) of solar output is used at home (solar with 1 battery)'))).toBe(true);
  });

  it('2 batteries: higher still', () => {
    // low share 0.70: 5,400 × 0.7 = 3,780 × 0.30 = 1,134 + 1,620 × 0.04 = 64.8 → 1,198.8 → 1,200
    // high share 0.95: 6,000 × 0.95 = 5,700 × 0.30 = 1,710 + 300 × 0.04 = 12 → 1,722 → 1,700
    // cost high 14,400 + 2 × 14,000 = 42,400
    const b = ok(calculate(ca(170, { battery: 2 }), ctx()));
    expect(b.year1Savings.low).toBe(1200);
    expect(b.year1Savings.high).toBe(1700);
    expect(b.cost.high).toBe(42400);
  });

  it('degradation compounds yearly', () => {
    // degradation 1%/yr, escalation 0 in the worst case: year n = 672.6 × 0.99^(n−1), cost 13,680
    // cum22 = 67,260 × (1 − 0.99^22) = 13,342.33; yr23 = 672.6 × 0.99^22 = 539.18;
    // 22 + 337.67 / 539.18 = 22.626 → 22.5 (20.5 without degradation, above)
    // net = 67,260 × (1 − 0.99^25) − 13,680 = 67,260 × 0.2221786 − 13,680 = 1,263.7 → 1,300
    const a = clone(fixtureAssumptions);
    a.panel_degradation_per_year.value = 0.01;
    const d = ok(calculate(ca(170), ctx(undefined, { assumptions: a })));
    expect(d.paybackYears.high).toBe(22.5);
    expect(d.netSavings25.low).toBe(1300);
    expect(d.year1Savings).toEqual(r.year1Savings); // year 1 is not degraded
  });
});

describe('edge cases', () => {
  it('tiny bill at or below the fixed charge → zero usage, warning, no payback', () => {
    const r = ok(calculate(fl(10), ctx()));
    expect(r.annualUsageKwh).toBe(0);
    expect(r.size).toEqual({ low: 0, likely: 0, high: 0 });
    expect(r.cost).toEqual({ low: 0, likely: 0, high: 0 });
    expect(r.year1Savings).toEqual({ low: 0, likely: 0, high: 0 });
    expect(r.paybackYears).toEqual({ low: null, likely: null, high: null });
    expect(r.netSavings25).toEqual({ low: 0, likely: 0, high: 0 });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('at or below the $10.00 monthly fixed charge');
    const c = ok(calculate(ca(15), ctx()));
    expect(c.annualUsageKwh).toBe(0);
    expect(c.warnings[0]).toContain('$20.00 monthly fixed charge');
  });

  it('small bill → below-minimum warning', () => {
    // (15 − 10) / 0.10 = 50 kWh/mo → 600/yr; likely 600 × 0.95 / 1,500 = 0.38 kW < 2
    const r = ok(calculate(fl(15), ctx()));
    expect(r.annualUsageKwh).toBe(600);
    expect(r.size.likely).toBe(0.4);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('below 2 kW');
  });

  it('huge bill → every end capped at 15 kW with a warning', () => {
    // (2,000 − 10 − 100) / 0.15 + 1,000 = 13,600 kWh/mo → 163,200/yr; ≫ 15 kW
    // cost: 15 × 2,500 = 37,500 | 15 × 3,000 = 45,000 | 15 × 3,600 = 54,000
    const r = ok(calculate(fl(2000), ctx()));
    expect(r.annualUsageKwh).toBe(163200);
    expect(r.size).toEqual({ low: 15, likely: 15, high: 15 });
    expect(r.cost).toEqual({ low: 37500, likely: 45000, high: 54000 });
    expect(r.warnings.some((w) => w.includes('capped at 15 kW'))).toBe(true);
  });

  it('invalid ZIPs', () => {
    for (const zip of ['abcde', '3310', '331011', '', ' ', '10001', '00000', '3310a']) {
      expect(calculate(fl(185, { zip }), ctx()), zip).toEqual({ ok: false, reason: 'invalid_zip' });
    }
  });

  it('utility / state mismatch and unknown utility', () => {
    expect(calculate(fl(185, { utilityId: caFixture.id }), ctx())).toEqual({ ok: false, reason: 'state_mismatch' });
    expect(calculate(ca(170, { utilityId: flTwoTier.id }), ctx())).toEqual({ ok: false, reason: 'state_mismatch' });
    expect(calculate(fl(185, { utilityId: 'nope' }), ctx())).toEqual({ ok: false, reason: 'unknown_utility' });
  });

  it('invalid bills, including above assumptions.max_monthly_bill ($5,000)', () => {
    expect(calculate(fl(5000), ctx()).ok).toBe(true);
    for (const bill of [0, -5, NaN, Infinity, -Infinity, 5000.01, 2e9, 1e12, 1e21]) {
      expect(calculate(fl(bill), ctx()), String(bill)).toEqual({ ok: false, reason: 'invalid_bill' });
    }
  });

  it('missing data lists every needed null, and nothing else', () => {
    const u = clone(flTwoTier);
    u.tier_sets![0]!.tiers[0]!.rate_per_kwh = null;
    u.fixed_monthly_charge = null;
    const costs = clone(fixtureCosts);
    costs.FL.installed_cost_per_watt = { ...costs.FL.installed_cost_per_watt, likely: null, low: null, high: null, source_url: null, verified_on: null, verification: 'unverified' };
    costs.FL.battery_installed_cost.likely = null;
    const c = ctx(undefined, { utilities: [u], costs });
    expect(calculate(fl(185), c)).toEqual({
      ok: false,
      reason: 'missing_data',
      missing: [
        'utilities[fpl].tier_sets[all_year].tiers[0].rate_per_kwh',
        'utilities[fpl].fixed_monthly_charge',
        'cost_ranges[FL/installed_cost_per_watt].likely',
      ],
    });
    // battery cost only needed when batteries are chosen
    expect(calculate(fl(185, { battery: 1 }), c)).toMatchObject({ missing: expect.arrayContaining(['cost_ranges[FL/battery_installed_cost].likely']) });
  });

  it('CA without an export credit → missing_data (no default substituted)', () => {
    const u = clone(caFixture);
    u.avg_export_credit_per_kwh = null;
    expect(calculate(ca(170), ctx(undefined, { utilities: [u] }))).toEqual({
      ok: false,
      reason: 'missing_data',
      missing: ['utilities[pge].avg_export_credit_per_kwh'],
    });
  });

  it('missing cost bounds → ±spread around the median, with an explicit assumption line', () => {
    // $/W 3.0 → 2.55 / 3.45. cost low 10.8 × 2,550 = 27,540 → 27,500; high 12 × 3,450 = 41,400
    // payback worst at 11.4 kW: 11.4 × 3,450 = 39,330 / 2,010 flat = 19 + 1,140 / 2,010 = 19.567 → 19.5
    const costs = clone(fixtureCosts);
    costs.FL.installed_cost_per_watt.low = null;
    costs.FL.installed_cost_per_watt.high = null;
    const r = ok(calculate(fl(185), ctx(undefined, { costs })));
    expect(r.cost).toEqual({ low: 27500, likely: 34200, high: 41400 });
    expect(r.paybackYears.high).toBe(19.5);
    expect(r.assumptions).toContain(
      "The low and high ends of the installed cost per watt range ($2.55/W and $3.45/W) are estimated as ±15% around the sourced median of $3.00/W, because the source's low and high bounds are not verified yet.",
    );
    // battery: only the high end missing → 12,000 × 1.15 = 13,800
    costs.FL.battery_installed_cost.high = null;
    const b = ok(calculate(fl(185, { battery: 1 }), ctx(undefined, { costs })));
    // cost high = 41,400 + 13,800 = 55,200
    expect(b.cost.high).toBe(55200);
    expect(b.assumptions.some((s) => s.includes('high end of the battery cost range ($13,800) is estimated as 15% above'))).toBe(true);
  });

  it('shading: more shade → less production → bigger system and longer payback', () => {
    // The caller (Task 4) fetches production at lossesForShading(shading); here production
    // is scaled by (100 − losses) / 86 as a stand-in: 1,500 / 1,395.3 / 1,220.9 kWh/kW-yr.
    const results = (['none', 'some', 'heavy'] as const).map((shading) => {
      const kwh = (1500 * (100 - fixtureAssumptions.pvwatts_system_loss_pct[shading])) / 86;
      return ok(calculate(fl(185, { shading }), ctx({ annualKwhPerKw: kwh })));
    });
    const [none, some, heavy] = results as [CalcSuccess, CalcSuccess, CalcSuccess];
    expect(none.size.likely).toBeLessThan(some.size.likely);
    expect(some.size.likely).toBeLessThan(heavy.size.likely);
    expect(none.cost.likely).toBeLessThan(some.cost.likely);
    expect(some.cost.likely).toBeLessThan(heavy.cost.likely);
    expect(none.paybackYears.likely!).toBeLessThanOrEqual(some.paybackYears.likely!);
    expect(some.paybackYears.likely!).toBeLessThanOrEqual(heavy.paybackYears.likely!);
    expect(heavy.assumptions.some((s) => s.includes('heavy shading (30% system losses)'))).toBe(true);
    // Same system size with less production → lower savings.
    const a = clone(fixtureAssumptions);
    a.system_size_cap_kw.value = 4; // force every case to 4 kW
    // monthly production 4 × {1,500, 1,395.3, 1,220.9} / 12 = 500 / 465.1 / 407.0 kWh, all taken from tier 2 ($0.15):
    // 75 × 12 = 900 | 69.77 × 12 = 837.2 → 800 | 61.05 × 12 = 732.6 → 700
    const s = (['none', 'some', 'heavy'] as const).map((shading) => {
      const kwh = (1500 * (100 - a.pvwatts_system_loss_pct[shading])) / 86;
      return ok(calculate(fl(185, { shading }), ctx({ annualKwhPerKw: kwh }, { assumptions: a }))).year1Savings.likely;
    });
    expect(s).toEqual([900, 800, 700]);
  });

  it('throws on caller bugs (bad production / battery / shading)', () => {
    expect(() => calculate(fl(185), ctx({ annualKwhPerKw: -1 }))).toThrow(RangeError);
    expect(() => calculate(fl(185, { battery: 3 as 0 }), ctx())).toThrow(RangeError);
    expect(() => calculate(fl(185, { shading: 'cloudy' as 'none' }), ctx())).toThrow(RangeError);
  });
});

describe('injected ZIP lookup', () => {
  it('resolves the ZIP only through ctx.lookupZip', () => {
    expect(calculate(fl(185), ctx(undefined, { lookupZip: () => null }))).toEqual({ ok: false, reason: 'invalid_zip' });
    expect(calculate(fl(185), ctx(undefined, { lookupZip: () => ({ state: 'CA' }) }))).toEqual({ ok: false, reason: 'state_mismatch' });
    expect(calculate(fl(185, { zip: 'any' }), ctx(undefined, { lookupZip: () => ({ state: 'FL' }) })).ok).toBe(true);
  });
});

describe('lease/PPA basis fields', () => {
  it('exposes the likely system year-1 production and the yearly savings series', () => {
    // FL two-tier $185 bill: likely size 11.4 kW × 1,500 kWh/kW = 17,100 kWh; likely year-1 savings $2,010 (see above)
    const r = ok(calculate(fl(185), ctx()));
    expect(r.year1ProductionKwh).toBe(17100);
    expect(r.yearlySavings).toHaveLength(r.analysisYears);
    expect(r.yearlySavings[0]).toBe(2010);
    expect(r.yearlySavings[1]!).toBeGreaterThan(r.yearlySavings[0]!); // 2% escalation, no degradation in the fixture
  });
});
