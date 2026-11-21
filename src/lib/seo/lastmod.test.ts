import { describe, expect, it } from 'vitest';
import { maxDate, pageLastmod, toDate, utilityStamp } from './lastmod';

describe('toDate / maxDate', () => {
  it('normalises timestamps and dates to UTC dates', () => {
    expect(toDate('2026-11-05T23:30:00-05:00')).toBe('2026-11-06');
    expect(toDate('2026-11-05')).toBe('2026-11-05');
    expect(toDate(null)).toBeNull();
    expect(toDate('garbage')).toBeNull();
  });
  it('ignores nulls and returns the newest', () => {
    expect(maxDate(null, '2026-01-02', undefined, '2026-03-01T00:00:00Z', '2026-02-01')).toBe('2026-03-01');
    expect(maxDate(null, undefined)).toBeNull();
  });
});

describe('utilityStamp', () => {
  it('reaches nested tier and TOU rows', () => {
    const u = { updated_at: '2026-01-01T00:00:00Z', verified_on: '2026-02-01', utility_tier_sets: [{ updated_at: '2026-03-01T00:00:00Z', utility_tiers: [{ updated_at: '2026-05-09T10:00:00Z' }] }], utility_tou_rates: [{ updated_at: '2026-04-01T00:00:00Z' }] };
    expect(utilityStamp(u)).toBe('2026-05-09');
  });
  it('uses the separate avg-rate and export-credit dates', () => {
    expect(utilityStamp({ updated_at: '2026-01-01T00:00:00Z', avg_rate_verified_on: '2026-06-01', export_credit_verified_on: '2026-07-01' })).toBe('2026-07-01');
  });
});

describe('pageLastmod', () => {
  it('is the newest across all rows the page renders', () => {
    expect(
      pageLastmod({
        city: { updated_at: '2026-02-01T00:00:00Z' },
        housing: { verified_on: '2026-03-01' },
        production: [{ fetched_on: '2026-04-01' }, { updated_at: '2026-01-01T00:00:00Z' }],
        utilities: [{ updated_at: '2026-05-01T00:00:00Z', utility_tou_rates: [{ updated_at: '2026-06-01T00:00:00Z' }] }],
        costs: [{ verified_on: '2026-05-15' }],
        assumptions: [{ updated_at: '2026-04-20T00:00:00Z' }],
      }),
    ).toBe('2026-06-01');
  });
  it('is never later than the newest input', () => {
    expect(pageLastmod({ city: { updated_at: '2026-02-01T00:00:00Z' } })).toBe('2026-02-01');
  });
  it('is null with no dated rows', () => {
    expect(pageLastmod({})).toBeNull();
    expect(pageLastmod({ city: {}, costs: [null] })).toBeNull();
  });
});
