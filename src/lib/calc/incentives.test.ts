/** Incentive rules on SYNTHETIC amounts, hand-checked. Currency-neutral. */
import { describe, expect, it } from 'vitest';
import { prepareIncentives, type Incentive, type IncentiveSystem } from './incentives';
import { toConsumerPrice } from './tax';

const inc = (o: Partial<Incentive> = {}): Incentive => ({
  id: 'i1',
  name: 'Test rebate',
  appliesTo: 'both',
  amountType: 'per_kw',
  amountLow: null,
  amountLikely: 1000,
  amountHigh: null,
  capAmount: null,
  capPercentOfCost: null,
  maxKw: null,
  maxKwh: null,
  taxable: false,
  excludesExportKind: null,
  status: 'open',
  effectiveFrom: null,
  effectiveTo: null,
  ...o,
});
const sys: IncentiveSystem = { sizeKw: 6, batteries: 0, batteryUsableKwh: null };
const DATE = '2026-08-01';
const prep = (list: Incentive[], s = sys, kind: Parameters<typeof prepareIncentives>[3] = 'net_billing') => prepareIncentives(list, s, DATE, kind);

describe('amounts', () => {
  it('per_kw: 1,000 x 6 kW = 6,000; a null low / high falls back to likely', () => {
    const p = prep([inc()]);
    expect(p.upfront('likely', 20000)).toBe(6000);
    expect(p.upfront('low', 20000)).toBe(6000);
    expect(p.upfront('high', 20000)).toBe(6000);
  });
  it('a range: low 800 / likely 1,000 / high 1,200 per kW', () => {
    const p = prep([inc({ amountLow: 800, amountHigh: 1200 })]);
    expect([p.upfront('low', 20000), p.upfront('likely', 20000), p.upfront('high', 20000)]).toEqual([4800, 6000, 7200]);
  });
  it('per_kw respects max_kw (eligible size): min(6, 5) x 1,000', () => {
    expect(prep([inc({ maxKw: 5 })]).upfront('likely', 20000)).toBe(5000);
  });
  it('absolute cap: 1,000/kW x 6 = 6,000 capped at 5,000', () => {
    expect(prep([inc({ capAmount: 5000 })]).upfront('likely', 20000)).toBe(5000);
  });
  it('percent-of-cost cap: capped at 40% of 20,000 = 8,000 when 10,000 would be paid', () => {
    expect(prep([inc({ amountLikely: 1667, capPercentOfCost: 0.4 })]).upfront('likely', 20000)).toBe(8000);
  });
  it('percent type: 25% of the gross cost', () => {
    expect(prep([inc({ amountType: 'percent', amountLikely: 0.25 })]).upfront('likely', 20000)).toBe(5000);
  });
  it('flat amount', () => {
    expect(prep([inc({ amountType: 'flat', amountLikely: 1500 })]).upfront('likely', 20000)).toBe(1500);
  });
  it('per_kwh_storage: 300 x (2 batteries x 13.5 kWh) = 8,100; max_kwh 20 caps it to 6,000', () => {
    const s = { sizeKw: 6, batteries: 2, batteryUsableKwh: 13.5 };
    expect(prep([inc({ amountType: 'per_kwh_storage', appliesTo: 'battery', amountLikely: 300 })], s).upfront('likely', 30000)).toBe(8100);
    expect(prep([inc({ amountType: 'per_kwh_storage', appliesTo: 'battery', amountLikely: 300, maxKwh: 20 })], s).upfront('likely', 30000)).toBe(6000);
  });
  it('stacks, and the total never exceeds the gross cost', () => {
    const p = prep([inc(), inc({ id: 'i2', amountType: 'flat', amountLikely: 3000 })]);
    expect(p.upfront('likely', 20000)).toBe(9000);
    expect(p.upfront('likely', 7000)).toBe(7000);
  });
  it('annual_payment is not an upfront deduction; it sums per end', () => {
    const p = prep([inc({ amountType: 'annual_payment', amountLow: 50, amountLikely: 80, amountHigh: 100 })]);
    expect(p.upfront('likely', 20000)).toBe(0);
    expect(p.annual).toEqual({ low: 50, likely: 80, high: 100 });
  });
});

describe('which incentives apply', () => {
  const reasons = (i: Incentive, s = sys, kind: Parameters<typeof prepareIncentives>[3] = 'net_billing') => prep([i], s, kind).skipped.map((x) => x.reason);
  it('closed, unknown status, outside the date window, excluded by the export policy, amount unknown', () => {
    expect(reasons(inc({ status: 'closed' }))).toEqual(['closed']);
    expect(reasons(inc({ status: 'unknown' }))).toEqual(['status_unknown']);
    expect(reasons(inc({ effectiveFrom: '2026-09-01' }))).toEqual(['not_in_effect']);
    expect(reasons(inc({ effectiveTo: '2026-07-31' }))).toEqual(['not_in_effect']);
    expect(reasons(inc({ excludesExportKind: 'net_metering' }), sys, 'net_metering')).toEqual(['excluded_by_export_policy']);
    expect(reasons(inc({ amountLikely: null }))).toEqual(['amount_unknown']);
  });
  it('the date window is inclusive on both ends', () => {
    expect(prep([inc({ effectiveFrom: DATE, effectiveTo: DATE })]).applied).toHaveLength(1);
  });
  it('an exclusion of a different export kind does not skip', () => {
    expect(prep([inc({ excludesExportKind: 'net_metering' })], sys, 'net_billing').applied).toHaveLength(1);
  });
  it('battery incentives need a battery; per-kWh storage needs a known battery size (never guessed)', () => {
    expect(reasons(inc({ appliesTo: 'battery', amountType: 'per_kwh_storage' }))).toEqual(['not_applicable']);
    expect(reasons(inc({ appliesTo: 'battery', amountType: 'per_kwh_storage' }), { sizeKw: 6, batteries: 1, batteryUsableKwh: null })).toEqual(['battery_size_unknown']);
  });
  it('waitlist applies but is flagged; taxable passes through', () => {
    const p = prep([inc({ status: 'waitlist', taxable: true })]);
    expect(p.applied).toEqual([{ id: 'i1', name: 'Test rebate', amountType: 'per_kw', taxable: true, waitlist: true }]);
  });
  it('no incentive rows means no incentive: the US federal 25D credit has no row, so nothing is ever deducted', () => {
    const p = prep([]);
    expect(p.applied).toEqual([]);
    expect(p.upfront('high', 25000)).toBe(0);
    expect(p.annual).toEqual({ low: 0, likely: 0, high: 0 });
  });
});

describe('toConsumerPrice (VAT)', () => {
  const r = { low: 1000, likely: 2000, high: 3000 };
  it('inclusive, unknown (null) and absent tax info pass through unchanged', () => {
    expect(toConsumerPrice(r, { costsIncludeTax: true, vatRate: 0.1 }, 'AU')).toEqual({ ok: true, value: r });
    expect(toConsumerPrice(r, { costsIncludeTax: null, vatRate: null }, 'US')).toEqual({ ok: true, value: r });
    expect(toConsumerPrice(r, undefined, 'US')).toEqual({ ok: true, value: r });
  });
  it('ex-tax lines are multiplied by 1 + vat (10% -> 1,100 / 2,200 / 3,300)', () => {
    const t = toConsumerPrice(r, { costsIncludeTax: false, vatRate: 0.1 }, 'AU');
    expect(t.ok && t.value.low).toBeCloseTo(1100, 9);
    expect(t.ok && t.value.likely).toBeCloseTo(2200, 9);
    expect(t.ok && t.value.high).toBeCloseTo(3300, 9);
  });
  it('an ex-tax line with no verified VAT rate is missing data, never a silent zero', () => {
    expect(toConsumerPrice(r, { costsIncludeTax: false, vatRate: null }, 'AU')).toEqual({ ok: false, missing: ['markets[AU].vat_rate'] });
  });
});
