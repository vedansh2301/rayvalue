/**
 * calculateGlobal() on SYNTHETIC data. Two kinds of test:
 *  1. Parity: the US fixtures run through the global entry point (with the legacy-equivalent export policy)
 *     give EXACTLY calculate()'s numbers, so FL and CA cannot drift apart from the global engine.
 *  2. Global features (export policies, incentives, VAT, currency rounding), hand-worked.
 *
 * Hand case (flat rate): bill 200, fixed 20, retail 0.30 -> usage 600 kWh/mo = 7,200/yr; production 1,500 kWh/kW.
 * Size 7,200 x {0.90, 0.95, 1.00} / 1,500 = 4.32 / 4.56 / 4.80 kW.
 */
import { describe, expect, it } from 'vitest';
import { lookupZip } from '../geo';
import { calculate } from './calculate';
import { calculateBothPaths, calculateGlobal } from './calculate-global';
import type { ExportPolicy } from './export-policy';
import type { GlobalAssumptions, GlobalCalcContext, GlobalCalcInput, GlobalCalcSuccess } from './global-types';
import type { Incentive } from './incentives';
import { CA_ZIP, FL_ZIP, caFixture, fixtureAssumptions, fixtureCosts, fixtureUtilities, flMinimum, flSeasonal, flTwoTier } from './test-fixtures';
import type { CalcResult } from './types';

const prov = { source_url: 'https://example.com/synthetic', verified_on: '2026-01-01', verification: 'agent_sourced' as const };
const line = (low: number | null, likely: number | null, high: number | null) => ({ low, likely, high, unit: 'per watt (synthetic)', note: null, ...prov });

const a = fixtureAssumptions;
const globalAssumptions = (state: 'FL' | 'CA'): GlobalAssumptions => ({
  target_offset: { low: a.target_offset.low, high: a.target_offset.high },
  system_size_cap_kw: { value: a.system_size_cap_kw.value },
  min_system_size_kw: { value: a.min_system_size_kw.value },
  max_monthly_bill: { value: a.max_monthly_bill.value },
  panel_degradation_per_year: { value: a.panel_degradation_per_year.value },
  analysis_years: { value: a.analysis_years.value },
  missing_range_spread: { value: a.missing_range_spread.value },
  annual_rate_escalation: a.annual_rate_escalation[state],
  self_consumption_share: {
    solar_only: a.ca_self_consumption_share.solar_only,
    solar_plus_1_battery: a.ca_self_consumption_share.solar_plus_1_battery,
    solar_plus_2_batteries: a.ca_self_consumption_share.solar_plus_2_batteries,
  },
  system_loss_pct: { none: a.pvwatts_system_loss_pct.none, some: a.pvwatts_system_loss_pct.some, heavy: a.pvwatts_system_loss_pct.heavy },
});

const US = { code: 'US', currency: 'USD', locale: 'en-US', pricesIncludeTax: false, vatRate: null, displayRound: null };
const AU = { code: 'AU', currency: 'AUD', locale: 'en-AU', pricesIncludeTax: true, vatRate: 0.1, displayRound: null };
const NET_BILLING: ExportPolicy = { id: 'nb', kind: 'net_billing', trueUp: null, rates: [{ validFrom: null, validTo: null, yearsFrom: 1, yearsTo: null, low: 0.04, likely: 0.06, high: 0.08, dailyCapKwh: null, fioBPerKwh: null, fioBNonOffsetShare: null }] };

/** Global context for a synthetic flat-rate utility in country `market`. */
function flatCtx(over: Partial<GlobalCalcContext> = {}): GlobalCalcContext {
  return {
    market: AU,
    regionCode: 'NSW',
    utility: { ...caFixture, id: 'au-test', name: 'Fixture AU (synthetic)', rate_schedule: 'FX', avg_rate_per_kwh: { low: null, likely: 0.3, high: null, unit: 'AUD per kWh', note: null, ...prov } },
    exportPolicy: NET_BILLING,
    incentives: [],
    installedCostPerWatt: { line: line(1.5, 2.0, 2.5), includesTax: true },
    batteryInstalledCost: { line: line(8000, 10000, 12000), includesTax: true },
    batteryUsableKwh: null,
    assumptions: globalAssumptions('CA'),
    production: { annualKwhPerKw: 1500 },
    ...over,
  };
}
const input = (o: Partial<GlobalCalcInput> = {}): GlobalCalcInput => ({ utilityId: 'au-test', avgMonthlyBill: 200, battery: 0, shading: 'none', installDate: '2026-08-01', ...o });
function ok(r: ReturnType<typeof calculateGlobal>): GlobalCalcSuccess {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason} ${JSON.stringify(r.missing ?? [])}`);
  return r;
}
const sum = (v: number[]) => v.reduce((x, y) => x + y, 0);

describe('parity with calculate() for the US fixtures', () => {
  const prod = { annualKwhPerKw: 1500, monthlyKwhPerKw: [90, 100, 120, 135, 150, 155, 150, 145, 125, 110, 90, 80].map((v) => (v * 1500) / 1450) };
  const legacy = (u: (typeof fixtureUtilities)[number], bill: number, battery: 0 | 1 | 2) =>
    calculate({ zip: u.state === 'FL' ? FL_ZIP : CA_ZIP, utilityId: u.id, avgMonthlyBill: bill, battery, shading: 'some' }, { lookupZip, utilities: fixtureUtilities, costs: fixtureCosts, assumptions: a, production: prod }) as CalcResult;

  const sameNumbers = (g: GlobalCalcSuccess, l: Extract<CalcResult, { ok: true }>) => {
    expect(g.annualUsageKwh).toBe(l.annualUsageKwh);
    expect(g.size).toEqual(l.size);
    expect(g.cost).toEqual(l.cost);
    expect(g.year1Savings).toEqual(l.year1Savings);
    expect(g.paybackYears).toEqual(l.paybackYears);
    expect(g.netSavings25).toEqual(l.netSavings25);
    expect(g.yearlySavings).toEqual(l.yearlySavings);
    expect(g.yearlySavingsLow).toEqual(l.yearlySavingsLow);
    expect(g.yearlySavingsHigh).toEqual(l.yearlySavingsHigh);
    expect(g.upfrontIncentive).toEqual({ low: 0, likely: 0, high: 0 });
  };

  for (const u of [flTwoTier, flSeasonal, flMinimum]) {
    for (const battery of [0, 2] as const) {
      it(`FL ${u.id} battery ${battery}: net_metering (tiered, forfeit) equals the US engine`, () => {
        const l = legacy(u, 185, battery);
        if (!l.ok) throw new Error('fixture should compute');
        const g = calculateGlobal(
          input({ utilityId: u.id, avgMonthlyBill: 185, battery, shading: 'some' }),
          flatCtx({
            market: US,
            regionCode: 'FL',
            utility: u,
            exportPolicy: { id: 'fl', kind: 'net_metering', trueUp: 'forfeit', rates: [] },
            installedCostPerWatt: { line: fixtureCosts.FL.installed_cost_per_watt, includesTax: null },
            batteryInstalledCost: { line: fixtureCosts.FL.battery_installed_cost, includesTax: null },
            assumptions: globalAssumptions('FL'),
            production: prod,
          }),
        );
        sameNumbers(ok(g), l);
      });
    }
  }
  for (const battery of [0, 1, 2] as const) {
    it(`CA battery ${battery}: net_billing at the single export credit equals the US engine`, () => {
      const l = legacy(caFixture, 240, battery);
      if (!l.ok) throw new Error('fixture should compute');
      const credit = caFixture.avg_export_credit_per_kwh!;
      const g = calculateGlobal(
        input({ utilityId: caFixture.id, avgMonthlyBill: 240, battery, shading: 'some' }),
        flatCtx({
          market: US,
          regionCode: 'CA',
          utility: caFixture,
          exportPolicy: { id: 'ca', kind: 'net_billing', trueUp: null, rates: [{ ...NET_BILLING.rates[0]!, low: credit, likely: credit, high: credit }] },
          installedCostPerWatt: { line: fixtureCosts.CA.installed_cost_per_watt, includesTax: null },
          batteryInstalledCost: { line: fixtureCosts.CA.battery_installed_cost, includesTax: null },
          assumptions: globalAssumptions('CA'),
          production: prod,
        }),
      );
      sameNumbers(ok(g), l);
    });
  }
});

describe('net billing, flat rate: hand-worked', () => {
  const r = ok(calculateGlobal(input(), flatCtx()));
  // Likely system 4.56 kW -> 6,840 kWh; self 40% = 2,736; exported 4,104. Year 1 = 2,736 x 0.30 + 4,104 x 0.06 = 1,067.04.
  // Low end: size 4.32 kW (6,480 kWh), share 0.3: self 1,944 x 0.30 + exported 4,536 x 0.04 = 583.2 + 181.44 = 764.64
  // High end: size 4.80 kW (7,200 kWh), share 0.5: self 3,600 x 0.30 + exported 3,600 x 0.08 = 1,080 + 288 = 1,368
  it('sizes and costs in the market currency (cost = kW x 1000 x $/W, ends paired)', () => {
    expect(r.country).toBe('AU');
    expect(r.currency).toBe('AUD');
    expect(r.annualUsageKwh).toBe(7200);
    expect(r.size).toEqual({ low: 4.3, likely: 4.6, high: 4.8 });
    // low 4.32 x 1500 = 6,480 -> 6,500; likely 4.56 x 2000 = 9,120 -> 9,100; high 4.8 x 2500 = 12,000
    expect(r.cost).toEqual({ low: 6500, likely: 9100, high: 12000 });
  });
  it('year-1 savings follow the size range with the matching export rate', () => {
    expect(r.year1Savings).toEqual({ low: 800, likely: 1100, high: 1400 });
    expect(r.yearlySavings[0]).toBe(1067);
  });
  it('net savings (likely): escalated retail + flat export, minus cost', () => {
    // escalation likely 3% (the fixture's CA value): 820.8 x (1.03^25 - 1)/0.03 + 246.24 x 25 - 9,120
    const expected = 820.8 * ((1.03 ** 25 - 1) / 0.03) + 246.24 * 25 - 9120;
    expect(r.netSavings25.likely).toBe(Math.round(expected / 100) * 100);
    expect(r.yearlySavings).toHaveLength(25);
  });
  it('best / worst outcomes order the way calculate() documents (payback low = best)', () => {
    expect(r.paybackYears.low!).toBeLessThanOrEqual(r.paybackYears.likely!);
    expect(r.paybackYears.likely!).toBeLessThanOrEqual(r.paybackYears.high!);
    expect(r.netSavings25.low).toBeLessThan(r.netSavings25.likely);
    expect(r.netSavings25.likely).toBeLessThan(r.netSavings25.high);
  });
});

describe('export policy changes the result', () => {
  const run = (policy: ExportPolicy) => ok(calculateGlobal(input(), flatCtx({ exportPolicy: policy })));
  const base = run(NET_BILLING);
  it('none is worth less than net billing; gross metering income is production x buy-back rate', () => {
    expect(run({ id: 'n', kind: 'none', trueUp: null, rates: [] }).yearlySavings[0]).toBe(Math.round(820.8));
    expect(run({ id: 'n', kind: 'none', trueUp: null, rates: [] }).paybackYears.likely!).toBeGreaterThan(base.paybackYears.likely!);
    expect(run({ ...NET_BILLING, kind: 'gross_metering' }).yearlySavings[0]).toBe(Math.round(6840 * 0.06));
  });
  it('feed-in: a year-stepped rate changes the yearly series after year 4', () => {
    const fit: ExportPolicy = {
      id: 'fit',
      kind: 'feed_in',
      trueUp: null,
      rates: [
        { ...NET_BILLING.rates[0]!, yearsFrom: 1, yearsTo: 4, low: 0.24, likely: 0.24, high: 0.24 },
        { ...NET_BILLING.rates[0]!, yearsFrom: 5, yearsTo: null, low: 0.083, likely: 0.083, high: 0.083 },
      ],
    };
    const r = run(fit);
    // year 1 (esc 0 baseline retail): 820.8 + 4,104 x 0.24 = 1,805.76 ; year 5 retail 820.8 x 1.03^4 + 4,104 x 0.083
    expect(r.yearlySavings[0]).toBe(Math.round(820.8 + 4104 * 0.24));
    expect(r.yearlySavings[4]).toBe(Math.round(820.8 * 1.03 ** 4 + 4104 * 0.083));
  });
  it('Fio B schedule: the share by calendar year lowers savings; a year past the schedule fails with the exact path', () => {
    const rate = (y: number, share: number) => ({ ...NET_BILLING.rates[0]!, validFrom: `${y}-01-01`, validTo: `${y}-12-31`, low: null, likely: null, high: null, fioBPerKwh: 0.1, fioBNonOffsetShare: share });
    const fio: ExportPolicy = { id: 'br', kind: 'br_fio_b', trueUp: null, rates: [rate(2026, 0.6), rate(2027, 0.75), rate(2028, 0.9)] };
    const short = calculateGlobal(input(), flatCtx({ exportPolicy: fio, assumptions: { ...globalAssumptions('CA'), analysis_years: { value: 3 } } }));
    const r = ok(short);
    // year 1 retail growth 1: 820.8 + 4,104 x (0.30 - 0.6 x 0.1); year 3: share 0.9, retail x 1.03^2
    expect(r.yearlySavings[0]).toBe(Math.round(820.8 + 4104 * (0.3 - 0.06)));
    expect(r.yearlySavings[2]).toBe(Math.round(820.8 * 1.03 ** 2 + 4104 * (0.3 * 1.03 ** 2 - 0.09)));
    const long = calculateGlobal(input(), flatCtx({ exportPolicy: fio }));
    expect(long).toMatchObject({ ok: false, reason: 'missing_data' });
    expect(long.ok === false && long.missing).toContain('export_policies[br].rates[2029]');
  });
  it('a date-effective export rate: the install date picks the window', () => {
    const p: ExportPolicy = {
      id: 'de',
      kind: 'net_billing',
      trueUp: null,
      rates: [
        { ...NET_BILLING.rates[0]!, validFrom: '2025-01-01', validTo: '2026-06-30', low: 0.1, likely: 0.1, high: 0.1 },
        { ...NET_BILLING.rates[0]!, validFrom: '2026-07-01', validTo: null, low: 0.02, likely: 0.02, high: 0.02 },
      ],
    };
    const early = ok(calculateGlobal(input({ installDate: '2026-06-30' }), flatCtx({ exportPolicy: p })));
    const late = ok(calculateGlobal(input({ installDate: '2026-07-01' }), flatCtx({ exportPolicy: p })));
    expect(early.yearlySavings[0]).toBe(Math.round(820.8 + 4104 * 0.1));
    expect(late.yearlySavings[0]).toBe(Math.round(820.8 + 4104 * 0.02));
  });
});

describe('incentives and payback', () => {
  const rebate: Incentive = {
    id: 'reb', name: 'Synthetic rebate', appliesTo: 'both', amountType: 'per_kw', amountLow: null, amountLikely: 500, amountHigh: null,
    capAmount: null, capPercentOfCost: null, maxKw: null, maxKwh: null, taxable: false, excludesExportKind: null, status: 'open', effectiveFrom: null, effectiveTo: null,
  };
  const without = ok(calculateGlobal(input(), flatCtx()));
  it('an applicable incentive lowers net cost: 4.56 kW x 500 = 2,280; cost stays gross; payback improves', () => {
    const r = ok(calculateGlobal(input(), flatCtx({ incentives: [rebate] })));
    expect(r.cost).toEqual(without.cost);
    expect(r.upfrontIncentive).toEqual({ low: 2300, likely: 2300, high: 2300 });
    expect(Math.abs(r.netSavings25.likely - without.netSavings25.likely - 2280)).toBeLessThanOrEqual(100); // each figure rounds to 100 separately
    expect(r.paybackYears.likely!).toBeLessThan(without.paybackYears.likely!);
    expect(r.incentivesApplied.map((i) => i.id)).toEqual(['reb']);
    expect(r.assumptions.join(' ')).toContain('Synthetic rebate');
  });
  it('an incentive that is not yet in effect on the install date changes nothing and is reported', () => {
    const r = ok(calculateGlobal(input(), flatCtx({ incentives: [{ ...rebate, effectiveFrom: '2027-01-01' }] })));
    expect(r.netSavings25).toEqual(without.netSavings25);
    expect(r.incentivesSkipped).toEqual([{ id: 'reb', name: 'Synthetic rebate', reason: 'not_in_effect' }]);
    expect(r.assumptions.join(' ')).toContain('not in effect on your install date');
  });
  it('the "before vs after" comparison: the same system installed on two dates', () => {
    const stepDown = { ...rebate, effectiveTo: '2026-12-31' };
    const now = ok(calculateGlobal(input({ installDate: '2026-12-31' }), flatCtx({ incentives: [stepDown] })));
    const later = ok(calculateGlobal(input({ installDate: '2027-01-01' }), flatCtx({ incentives: [stepDown] })));
    expect(now.upfrontIncentive.likely).toBe(2300);
    expect(later.upfrontIncentive.likely).toBe(0);
  });
  it('US without incentive rows deducts nothing and states that the federal credit is not included', () => {
    const r = ok(calculateGlobal(input(), flatCtx({ market: US, regionCode: 'CA' })));
    expect(r.upfrontIncentive).toEqual({ low: 0, likely: 0, high: 0 });
    expect(r.assumptions[0]).toContain('No federal tax credit is included');
  });
  it('an incentive that excludes net metering gives two paths side by side', () => {
    const hrs = { ...rebate, excludesExportKind: 'net_metering' as const };
    const nm: ExportPolicy = { id: 'nm', kind: 'net_metering', trueUp: 'forfeit', rates: [] };
    const both = calculateBothPaths(input(), flatCtx({ exportPolicy: nm, incentives: [hrs] }));
    const withNm = ok(both.withPolicy);
    const alt = ok(both.alternative!);
    expect(withNm.upfrontIncentive.likely).toBe(0);
    expect(withNm.incentivesSkipped[0]!.reason).toBe('excluded_by_export_policy');
    expect(alt.upfrontIncentive.likely).toBe(2300);
    // alternative path: exports worth nothing -> savings = self-consumption only
    expect(alt.yearlySavings[0]).toBe(Math.round(820.8));
    expect(calculateBothPaths(input(), flatCtx({ incentives: [rebate] })).alternative).toBeNull();
  });
  it('annual payments (VPP) raise every year of savings', () => {
    const vpp = { ...rebate, id: 'vpp', amountType: 'annual_payment' as const, amountLikely: 100 };
    const r = ok(calculateGlobal(input(), flatCtx({ incentives: [vpp] })));
    expect(r.yearlySavings[0]).toBe(Math.round(1067.04 + 100));
    expect(sum(r.yearlySavings)).toBeGreaterThan(sum(without.yearlySavings) + 2400);
  });
});

describe('VAT, currency and rounding', () => {
  it('ex-tax cost lines are converted with the market VAT rate (10%): likely 9,120 -> 10,032', () => {
    const r = ok(calculateGlobal(input(), flatCtx({ installedCostPerWatt: { line: line(1.5, 2.0, 2.5), includesTax: false } })));
    expect(r.cost).toEqual({ low: 7100, likely: 10000, high: 13200 }); // 6,480 x 1.1 = 7,128; 10,032; 12,000 x 1.1 = 13,200
  });
  it('an ex-tax line with no verified VAT rate fails with the exact path', () => {
    const r = calculateGlobal(input(), flatCtx({ market: { ...AU, vatRate: null }, installedCostPerWatt: { line: line(1.5, 2.0, 2.5), includesTax: false } }));
    expect(r).toEqual({ ok: false, reason: 'missing_data', missing: ['markets[AU].vat_rate'] });
  });
  it('battery cost is also converted to consumer prices', () => {
    const r = ok(calculateGlobal(input({ battery: 1 }), flatCtx({ batteryInstalledCost: { line: line(8000, 10000, 12000), includesTax: false } })));
    // likely: 9,120 + 10,000 x 1.1 = 20,120 -> 20,100
    expect(r.cost.likely).toBe(20100);
  });
  it('rounds money to the market display unit (e.g. 1,000 for a high-denomination currency); kW and kWh are unchanged', () => {
    const r = ok(calculateGlobal(input(), flatCtx({ market: { ...AU, displayRound: 1000 } })));
    expect(r.cost).toEqual({ low: 6000, likely: 9000, high: 12000 }); // 6,480 / 9,120 / 12,000
    expect(r.size).toEqual({ low: 4.3, likely: 4.6, high: 4.8 });
  });
  it('assumption text uses the market currency, with no dollar sign for a non-USD market', () => {
    const r = ok(calculateGlobal(input(), flatCtx({ market: { ...AU, currency: 'EUR', locale: 'de-DE' } })));
    const text = r.assumptions.join(' ');
    expect(text).toContain('€');
    expect(text).not.toContain('$');
    expect(r.currency).toBe('EUR');
  });
});

describe('failures never guess', () => {
  it('unknown utility, invalid bill', () => {
    expect(calculateGlobal(input({ utilityId: 'nope' }), flatCtx())).toEqual({ ok: false, reason: 'unknown_utility' });
    expect(calculateGlobal(input({ avgMonthlyBill: 0 }), flatCtx())).toEqual({ ok: false, reason: 'invalid_bill' });
    expect(calculateGlobal(input({ avgMonthlyBill: 99999 }), flatCtx())).toEqual({ ok: false, reason: 'invalid_bill' });
  });
  it('lists every missing value at once (export rate, cost line)', () => {
    const r = calculateGlobal(
      input(),
      flatCtx({ exportPolicy: { ...NET_BILLING, rates: [{ ...NET_BILLING.rates[0]!, low: null, likely: null, high: null }] }, installedCostPerWatt: { line: line(null, null, null), includesTax: true } }),
    );
    expect(r).toMatchObject({ ok: false, reason: 'missing_data' });
    expect(r.ok === false && r.missing).toEqual(['export_policies[nb].rates[year 1].rate_likely (+24 more years)', 'cost_ranges[AU/NSW/installed_cost_per_watt].likely']);
  });
  it('a tiered tariff with a non-net-metering policy is reported, not computed wrongly', () => {
    const r = calculateGlobal(input({ utilityId: flTwoTier.id }), flatCtx({ utility: { ...flTwoTier, name: 'x', rate_schedule: 'y' } }));
    expect(r).toMatchObject({ ok: false, reason: 'missing_data' });
  });
  it('malformed input is a caller bug and throws', () => {
    expect(() => calculateGlobal(input({ installDate: '1 Aug 2026' }), flatCtx())).toThrow(RangeError);
    expect(() => calculateGlobal(input({ battery: 3 as 0 }), flatCtx())).toThrow(RangeError);
  });
});
