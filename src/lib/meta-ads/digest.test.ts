import { describe, expect, it } from 'vitest';
import { buildDigest, type DigestInput } from './digest';
import type { InsightMetrics } from './types';

const m = (over: Partial<InsightMetrics> = {}): InsightMetrics => ({
  spendInr: 0,
  impressions: 0,
  reach: null,
  frequency: null,
  cpmInr: null,
  linkClicks: 0,
  ctrPct: null,
  leads: 0,
  leadsActionType: null,
  costPerLeadInr: null,
  thruplays: 0,
  costPerThruplayInr: null,
  igProfileVisits: null,
  ...over,
});

const base: DigestInput = {
  today: '2026-10-30',
  since: '2026-10-24',
  timezone: 'Asia/Kolkata',
  days: [
    { date: '2026-10-28', ...m({ spendInr: 289.83, impressions: 50, thruplays: 6 }) },
    { date: '2026-10-30', ...m({ spendInr: 98, impressions: 400, linkClicks: 4, leads: 1 }) },
  ],
  hours: [
    { label: '20:00:00 - 20:59:59', ...m({ spendInr: 60, impressions: 200, linkClicks: 2 }) },
    { label: '18:00:00 - 18:59:59', ...m({ spendInr: 38, impressions: 200, linkClicks: 2 }) },
  ],
  spendCapInr: 847.45,
  amountSpentInr: 387.83,
  capPerDayInr: 100,
  adset: { id: '120246779987350609', status: 'PAUSED', endTime: '2026-11-04T10:30:00+0530' },
  schedule: { enabled: true, timezone: 'America/New_York', windows: '{"mon":[[18,22]]}' },
  dashboardUrl: 'https://rayvalue.com/admin/ads',
};

describe('buildDigest', () => {
  const { subject, text } = buildDigest(base);

  it('headlines today so far', () => {
    expect(subject).toBe('RayValue ads 2026-10-30: ₹98.00 spent, 4 clicks, 1 leads');
    expect(text).toContain('Today so far (2026-10-30): spent ₹98.00, shown 400x, 4 link clicks (₹24.50 each), 1 leads');
  });
  it('totals the 7 days and lists every day, including ones with no delivery', () => {
    expect(text).toContain('Last 7 days (2026-10-24 to 2026-10-30): spent ₹387.83, shown 450x, 4 link clicks');
    expect(text).toContain('  2026-10-24: no delivery');
    expect(text).toContain('  2026-10-28: ₹289.83, 50 views, 0 clicks, 0 leads');
    expect(text).toContain('  2026-10-30 (so far): ₹98.00');
  });
  it('lists hours in order with CPM and CTR', () => {
    expect(text.indexOf('  18:00')).toBeLessThan(text.indexOf('  20:00'));
    expect(text).toContain('  20:00: ₹60.00, 200 views, 2 clicks, ₹300.00 per 1,000, CTR 1%');
  });
  it('shows money left before the account limit', () => {
    expect(text).toContain('₹459.62, about 4 more days at ₹100.00/day');
  });
  it('says "no clicks" instead of dividing by zero, and handles no data', () => {
    const empty = buildDigest({ ...base, days: [], hours: [], spendCapInr: null, adset: null, schedule: null });
    expect(empty.subject).toBe('RayValue ads 2026-10-30: ₹0.00 spent, 0 clicks, 0 leads');
    expect(empty.text).toContain('(no clicks each)');
    expect(empty.text).toContain('  no delivery');
    expect(empty.text).toContain('Account spending limit: none set or not readable.');
    expect(empty.text).toContain('Hour schedule: not readable.');
  });
});
