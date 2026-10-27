import { describe, expect, it } from 'vitest';
import { formatUsdRange, usableRate, usdRange, type FxRate } from './fx';
import { eventsFilter, parseEventsByCampaign, parseVisitsByCampaign, vercelError } from './funnel';
import type { AdObject, InsightRow } from './types';
import { ageSeconds, byIdAndDate, count, datesBetween, deliveryTree, DASH, inr, pct, statusTone } from './view';

const rate = (over: Partial<FxRate> = {}): FxRate => ({
  id: 'inr_per_usd',
  low: 94.46,
  likely: 94.94,
  high: 94.94,
  observed_from: '2026-10-19',
  observed_to: '2026-10-23',
  note: null,
  source_url: 'https://www.federalreserve.gov/releases/h10/20261026/',
  verified_on: '2026-10-27',
  verification: 'agent_sourced',
  ...over,
});

describe('fx', () => {
  it('needs all bounds, a source and a date', () => {
    expect(usableRate(rate())).toBe(true);
    expect(usableRate(rate({ low: null }))).toBe(false);
    expect(usableRate(rate({ source_url: null }))).toBe(false);
    expect(usableRate(rate({ verified_on: null }))).toBe(false);
    expect(usableRate(rate({ verification: 'unverified' }))).toBe(false);
    expect(usableRate(rate({ low: 95, likely: 94 }))).toBe(false);
    expect(usableRate(null)).toBe(false);
  });
  it('USD is a range: low from the highest rate, high from the lowest', () => {
    const r = usdRange(9494, rate())!;
    expect(r.low).toBeCloseTo(100, 6);
    expect(r.high).toBeCloseTo(9494 / 94.46, 6);
    expect(formatUsdRange(r)).toBe('$100.00–$100.51');
    expect(usdRange(100, rate({ high: null }))).toBeNull();
    expect(usdRange(null, rate())).toBeNull();
  });
  it('collapses an equal range', () => expect(formatUsdRange({ low: 1, high: 1.001 })).toBe('$1.00'));
});

describe('funnel parsing', () => {
  it('page views by campaign, (not set) for empty', () => {
    expect(parseVisitsByCampaign({ data: [{ utmCampaign: '', pageviews: 313, visitors: 200 }, { utmCampaign: 'fl_reel', pageviews: 20, visitors: 15 }, { utmCampaign: 'x' }] })).toEqual([
      { campaign: '(not set)', pageviews: 313, visitors: 200 },
      { campaign: 'fl_reel', pageviews: 20, visitors: 15 },
    ]);
    expect(parseVisitsByCampaign(null)).toEqual([]);
  });
  it('events by name and campaign', () => {
    expect(parseEventsByCampaign({ data: [{ eventName: 'quote_submit', utmCampaign: 'a', count: 2 }, { eventName: 'calc_start', utmCampaign: null, count: '9' }, { count: 1 }] })).toEqual([
      { event: 'calc_start', campaign: '(not set)', count: 9 },
      { event: 'quote_submit', campaign: 'a', count: 2 },
    ]);
  });
  it('filter lists the funnel events', () => {
    expect(eventsFilter()).toBe("eventName in ('calc_start', 'calc_complete', 'quote_form_start', 'quote_submit', 'nav_click')");
  });
  it('explains a 402 (custom events need Pro)', () => {
    expect(vercelError(402, { error: { message: 'Accessing Analytics custom events requires an Enterprise or Pro plan.' } })).toContain('Pro or Enterprise');
    expect(vercelError(403, null)).toContain('cannot read');
    expect(vercelError(500, null)).toBe('Vercel answered 500.');
  });
});

const o = (level: AdObject['level'], id: string, campaignId: string | null = null, adsetId: string | null = null): AdObject => ({
  level,
  id,
  name: id,
  campaignId,
  adsetId,
  effectiveStatus: 'ACTIVE',
  configuredStatus: 'ACTIVE',
  dailyBudgetInr: null,
  lifetimeBudgetInr: null,
  issues: [],
  objective: null,
  optimizationGoal: null,
  startTime: null,
  endTime: null,
});

describe('deliveryTree', () => {
  it('nests campaign > ad set > ad, counts visible ads, keeps orphans at the end', () => {
    const t = deliveryTree([o('campaign', 'C1')], [o('adset', 'S1', 'C1'), o('adset', 'S9', 'C_HIDDEN')], [o('ad', 'A1', 'C1', 'S1'), o('ad', 'A9', 'C_X', 'S_X')]);
    expect(t.map((r) => [r.object.id, r.depth, r.childAds])).toEqual([
      ['C1', 0, 1],
      ['S1', 1, 1],
      ['A1', 2, null],
      ['S9', 0, 0],
      ['A9', 0, null],
    ]);
  });
  it('a campaign with no visible ads shows 0', () => {
    expect(deliveryTree([o('campaign', 'C1')], [o('adset', 'S1', 'C1')], []).map((r) => r.childAds)).toEqual([0, 0]);
  });
});

describe('formatting', () => {
  it('never shows a missing value as 0', () => {
    expect(inr(null)).toBe(DASH);
    expect(count(undefined)).toBe(DASH);
    expect(pct(null)).toBe(DASH);
  });
  it('formats INR and percentages', () => {
    expect(inr(1234.5)).toBe('₹1,234.50');
    expect(inr(0)).toBe('₹0.00');
    expect(pct(0.6)).toBe('0.6%');
    expect(count(20000)).toBe('20,000');
  });
  it('dates, age, status tone', () => {
    expect(datesBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(ageSeconds('2026-10-27T00:00:00Z', new Date('2026-10-27T00:05:00Z'))).toBe(300);
    expect(statusTone('ACTIVE')).toBe('good');
    expect(statusTone('WITH_ISSUES')).toBe('bad');
    expect(statusTone('IN_PROCESS')).toBe('warn');
    expect(statusTone('PAUSED')).toBe('neutral');
  });
  it('byIdAndDate indexes daily rows', () => {
    const r = { level: 'adset', id: 'S1', dateStart: '2026-10-27' } as InsightRow;
    expect(byIdAndDate([r, { ...r, dateStart: null }]).get('S1')?.get('2026-10-27')).toBe(r);
  });
});
