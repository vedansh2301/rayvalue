/**
 * Export-policy model on SYNTHETIC numbers, every expected value worked by hand.
 * Shared case: usage 7,200 kWh/yr, production 6,840 kWh/yr, self-consumption 0.4 (self 2,736 kWh, exported 4,104 kWh),
 * flat retail $0.30/kWh, export rate 0.04 / 0.06 / 0.08.
 *   retail part  = 2,736 x 0.30 = 820.80
 *   export part  = 4,104 x 0.06 = 246.24 (likely)
 */
import { describe, expect, it } from 'vitest';
import { inWindow, legacyExport, policySavingsYear, resolveExport, shiftYears, type ExportKind, type ExportPolicy, type RateWindow, type YearTerms } from './export-policy';
import type { AvgRates, TieredRates } from './rates';
import { flSavingsYear } from './savings';

const avg: AvgRates = { kind: 'avg', fixedMonthly: 20, retailRate: 0.3, exportCredit: 0 };
const tiered: TieredRates = {
  kind: 'tiered',
  fixedMonthly: 10,
  minimum: null,
  monthTiers: Array.from({ length: 12 }, () => [
    { upTo: 1000, rate: 0.1, baseRate: 0.1 },
    { upTo: null, rate: 0.15, baseRate: 0.15 },
  ]),
};
const win = (o: Partial<RateWindow> = {}): RateWindow => ({
  validFrom: null,
  validTo: null,
  yearsFrom: 1,
  yearsTo: null,
  low: 0.04,
  likely: 0.06,
  high: 0.08,
  dailyCapKwh: null,
  fioBPerKwh: null,
  fioBNonOffsetShare: null,
  ...o,
});
const policy = (kind: ExportKind, rates: RateWindow[] = [win()], trueUp: ExportPolicy['trueUp'] = null): ExportPolicy => ({ id: 'p', kind, trueUp, rates });

const flat = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].map(() => 570); // 6,840 / 12

const savings = (kind: ExportKind, terms: Partial<YearTerms>, over: Partial<Parameters<typeof policySavingsYear>[0]> = {}, trueUp: 'forfeit' | 'pay_at_rate' = 'forfeit') =>
  policySavingsYear({
    model: avg,
    terms: { rate: { low: 0.04, likely: 0.06, high: 0.08 }, dailyCapKwh: null, fioBPerKwh: null, fioBShare: null, ...terms },
    resolved: { kind, trueUp },
    end: 'likely',
    annualUsageKwh: 7200,
    annualProductionKwh: 6840,
    monthlyProductionKwh: flat,
    selfConsumptionShare: 0.4,
    rateGrowth: 1,
    ...over,
  });

describe('dates', () => {
  it('shiftYears keeps the day and clamps Feb 29', () => {
    expect(shiftYears('2026-06-15', 2)).toBe('2028-06-15');
    expect(shiftYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(shiftYears('2028-02-29', 4)).toBe('2032-02-29');
  });
  it('inWindow is inclusive on both ends and open on null', () => {
    expect(inWindow('2026-01-01', '2026-01-01', '2026-12-31')).toBe(true);
    expect(inWindow('2026-12-31', '2026-01-01', '2026-12-31')).toBe(true);
    expect(inWindow('2027-01-01', '2026-01-01', '2026-12-31')).toBe(false);
    expect(inWindow('2020-01-01', null, null)).toBe(true);
    expect(inWindow('2020-01-01', '2021-01-01', null)).toBe(false);
  });
});

describe('policySavingsYear, flat retail rate', () => {
  it('net_billing: self x retail + exported x rate = 820.80 + 246.24', () => {
    expect(savings('net_billing', {})).toBeCloseTo(1067.04, 6);
  });
  it('net_billing: the worst / best outcome use the low / high rate (export 4,104 x 0.04 / 0.08)', () => {
    expect(savings('net_billing', {}, { end: 'low' })).toBeCloseTo(820.8 + 164.16, 6);
    expect(savings('net_billing', {}, { end: 'high' })).toBeCloseTo(820.8 + 328.32, 6);
  });
  it('net_billing: retail escalates, the export rate stays flat (growth 1.1 -> 902.88 + 246.24)', () => {
    expect(savings('net_billing', {}, { rateGrowth: 1.1 })).toBeCloseTo(1149.12, 6);
  });
  it('feed_in with a 5 kWh/day cap: exports capped at 1,825 kWh -> 820.80 + 109.50', () => {
    expect(savings('feed_in', { dailyCapKwh: 5 })).toBeCloseTo(930.3, 6);
  });
  it('feed_in without a cap equals net_billing', () => {
    expect(savings('feed_in', {})).toBeCloseTo(savings('net_billing', {}), 9);
  });
  it('gross_metering: all production at the buy-back rate = 6,840 x 0.06', () => {
    expect(savings('gross_metering', {})).toBeCloseTo(410.4, 6);
  });
  it('none: only self-consumption saves = 820.80', () => {
    expect(savings('none', { rate: null })).toBeCloseTo(820.8, 6);
  });
  it('net_metering, flat rate: offset = min(production, usage) x retail', () => {
    expect(savings('net_metering', { rate: null })).toBeCloseTo(6840 * 0.3, 6);
  });
  it('net_metering with surplus: forfeit counts 0, pay_at_rate pays 800 x 0.06', () => {
    // production 8,000 > usage 7,200: offset 7,200 x 0.30 = 2,160; surplus 800
    expect(savings('net_metering', {}, { annualProductionKwh: 8000 })).toBeCloseTo(2160, 6);
    expect(savings('net_metering', {}, { annualProductionKwh: 8000 }, 'pay_at_rate')).toBeCloseTo(2160 + 48, 6);
  });
  it('br_fio_b: exported kWh lose share x Fio B: 4,104 x (0.30 - 0.6 x 0.10) = 984.96, plus 820.80', () => {
    expect(savings('br_fio_b', { rate: null, fioBPerKwh: 0.1, fioBShare: 0.6 })).toBeCloseTo(1805.76, 6);
  });
  it('br_fio_b never goes below zero per exported kWh', () => {
    expect(savings('br_fio_b', { rate: null, fioBPerKwh: 1, fioBShare: 1 })).toBeCloseTo(820.8, 6);
  });
});

describe('policySavingsYear, tiered rates', () => {
  const base = { model: tiered, annualUsageKwh: 18000, annualProductionKwh: 18000, monthlyProductionKwh: Array.from({ length: 12 }, () => 1500) };
  it('net_metering forfeit = flSavingsYear x growth (the FL arithmetic)', () => {
    const terms: YearTerms = { rate: null, dailyCapKwh: null, fioBPerKwh: null, fioBShare: null };
    const got = policySavingsYear({ ...base, terms, resolved: { kind: 'net_metering', trueUp: 'forfeit' }, end: 'likely', selfConsumptionShare: 0, rateGrowth: 1.02 });
    expect(got).toBe(flSavingsYear(tiered, 1500, base.monthlyProductionKwh) * 1.02);
  });
  it('net_metering pay_at_rate adds leftover kWh x rate (production 1,600/mo vs usage 1,500: bank 1,200 kWh)', () => {
    const terms: YearTerms = { rate: { low: 0.03, likely: 0.05, high: 0.07 }, dailyCapKwh: null, fioBPerKwh: null, fioBShare: null };
    const prod = Array.from({ length: 12 }, () => 1600);
    const got = policySavingsYear({ ...base, monthlyProductionKwh: prod, terms, resolved: { kind: 'net_metering', trueUp: 'pay_at_rate' }, end: 'likely', selfConsumptionShare: 0, rateGrowth: 1 });
    expect(got).toBeCloseTo(flSavingsYear(tiered, 1500, prod) + 1200 * 0.05, 6);
  });
});

describe('resolveExport', () => {
  it('net_billing: picks the window that contains the install date (latest valid_from wins on overlap)', () => {
    const p = policy('net_billing', [win({ validFrom: '2025-01-01', validTo: '2026-06-30', likely: 0.05, low: 0.03, high: 0.07 }), win({ validFrom: '2026-07-01', likely: 0.06 })]);
    const r = resolveExport(p, '2026-08-01', 3, 0.15, avg);
    expect(r.ok && r.value.terms[0]!.rate!.likely).toBe(0.06);
    const early = resolveExport(p, '2026-02-01', 3, 0.15, avg);
    expect(early.ok && early.value.terms[0]!.rate!.likely).toBe(0.05);
  });
  it('an install date outside every window is missing data', () => {
    const p = policy('net_billing', [win({ validFrom: '2027-01-01' })]);
    expect(resolveExport(p, '2026-08-01', 2, 0.15, avg)).toEqual({ ok: false, missing: ['export_policies[p].rates[year 1] (+1 more years)'] });
  });
  it('feed_in year-stepped schedule: years 1-4 at one rate, then another', () => {
    const p = policy('feed_in', [win({ yearsFrom: 1, yearsTo: 4, likely: 0.24, low: 0.24, high: 0.24 }), win({ yearsFrom: 5, likely: 0.083, low: 0.083, high: 0.083 })]);
    const r = resolveExport(p, '2026-08-01', 6, 0.15, avg);
    expect(r.ok && r.value.terms.map((t) => t.rate!.likely)).toEqual([0.24, 0.24, 0.24, 0.24, 0.083, 0.083]);
  });
  it('null low / high are filled from the spread and flagged as estimated; null likely is missing', () => {
    const r = resolveExport(policy('net_billing', [win({ low: null, high: null, likely: 0.1 })]), '2026-08-01', 1, 0.2, avg);
    expect(r.ok && r.value.estimatedBounds).toBe(true);
    expect(r.ok && r.value.terms[0]!.rate!.low).toBeCloseTo(0.08, 12);
    expect(r.ok && r.value.terms[0]!.rate!.high).toBeCloseTo(0.12, 12);
    expect(resolveExport(policy('net_billing', [win({ likely: null })]), '2026-08-01', 1, 0.2, avg)).toEqual({ ok: false, missing: ['export_policies[p].rates[year 1].rate_likely'] });
  });
  it('none and net_metering (forfeit) need no rate rows', () => {
    expect(resolveExport(policy('none', []), '2026-08-01', 25, 0.15, avg).ok).toBe(true);
    expect(resolveExport(policy('net_metering', [], 'forfeit'), '2026-08-01', 25, 0.15, tiered).ok).toBe(true);
    expect(resolveExport(policy('net_metering', [], null), '2026-08-01', 25, 0.15, tiered)).toMatchObject({ ok: true, value: { trueUp: 'forfeit' } });
  });
  it('net_metering pay_at_rate needs a rate; carry is not modelled', () => {
    expect(resolveExport(policy('net_metering', [], 'pay_at_rate'), '2026-08-01', 1, 0.15, avg)).toEqual({ ok: false, missing: ['export_policies[p].rates[year 1]'] });
    expect(resolveExport(policy('net_metering', [], 'carry'), '2026-08-01', 1, 0.15, avg)).toMatchObject({ ok: false });
  });
  it('tiered tariffs support net_metering only', () => {
    const r = resolveExport(policy('net_billing'), '2026-08-01', 1, 0.15, tiered);
    expect(r.ok).toBe(false);
  });
  it('br_fio_b picks the window by CALENDAR year and a year past the schedule is missing, never extended', () => {
    const rates = [
      win({ validFrom: '2026-01-01', validTo: '2026-12-31', fioBPerKwh: 0.1, fioBNonOffsetShare: 0.6 }),
      win({ validFrom: '2027-01-01', validTo: '2027-12-31', fioBPerKwh: 0.1, fioBNonOffsetShare: 0.75 }),
      win({ validFrom: '2028-01-01', validTo: '2028-12-31', fioBPerKwh: 0.1, fioBNonOffsetShare: 0.9 }),
    ];
    const ok = resolveExport(policy('br_fio_b', rates), '2026-03-10', 3, 0.15, avg);
    expect(ok.ok && ok.value.terms.map((t) => t.fioBShare)).toEqual([0.6, 0.75, 0.9]);
    expect(resolveExport(policy('br_fio_b', rates), '2026-03-10', 4, 0.15, avg)).toEqual({ ok: false, missing: ['export_policies[p].rates[2029]'] });
    const nullShare = resolveExport(policy('br_fio_b', [win({ validFrom: '2026-01-01', validTo: '2026-12-31', fioBPerKwh: 0.1, fioBNonOffsetShare: null })]), '2026-03-10', 1, 0.15, avg);
    expect(nullShare).toEqual({ ok: false, missing: ['export_policies[p].rates[2026].fio_b_non_offset_share'] });
  });
});

describe('legacyExport', () => {
  it('maps the US models: tiered = net_metering/forfeit, flat = net_billing at the single export credit', () => {
    expect(legacyExport(tiered, 3)).toMatchObject({ kind: 'net_metering', trueUp: 'forfeit' });
    const l = legacyExport({ ...avg, exportCredit: 0.04 }, 2);
    expect(l.kind).toBe('net_billing');
    expect(l.terms[1]!.rate).toEqual({ low: 0.04, likely: 0.04, high: 0.04 });
    expect(l.estimatedBounds).toBe(false);
  });
});
