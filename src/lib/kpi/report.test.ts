import { describe, expect, it } from 'vitest';
import { buildReport, completionState, deliveryPrice, netOfSpend, pct, rate, resultsToQuoteState, returnState, sourceKey, weekStart, type KpiLead } from './report';

const lead = (id: string, created: string, over: Partial<KpiLead> = {}): KpiLead => ({ id, created_at: created, status: 'sent', phone_verified: false, source: 'results', utm_source: null, ...over });

describe('weekStart', () => {
  it('returns the Monday (UTC)', () => {
    expect(weekStart('2026-11-02T00:00:00Z')).toBe('2026-11-02'); // Monday
    expect(weekStart('2026-11-08T23:59:00Z')).toBe('2026-11-02'); // Sunday
    expect(weekStart('2026-11-09T00:00:00Z')).toBe('2026-11-09');
  });
});

describe('sourceKey', () => {
  it('prefers utm_source, lowercased, else the form source', () => {
    expect(sourceKey({ source: 'results', utm_source: ' Google ' })).toBe('google');
    expect(sourceKey({ source: 'quotes_page', utm_source: null })).toBe('quotes_page');
  });
});

describe('buildReport', () => {
  const leads = [
    lead('a', '2026-11-03T10:00:00Z', { phone_verified: true, utm_source: 'google' }),
    lead('b', '2026-11-04T10:00:00Z', { status: 'returned', utm_source: 'google' }),
    lead('c', '2026-11-10T10:00:00Z', { status: 'nurture' }),
    lead('d', '2026-11-05T10:00:00Z'),
  ];
  const buyers = [{ id: 'B1', name: 'Alpha', price: 40 }, { id: 'B2', name: 'Beta', price: null }];
  const deliveries = [
    { lead_id: 'a', buyer_id: 'B1', status: 'delivered', price: 40 },
    { lead_id: 'a', buyer_id: 'B2', status: 'delivered', price: null },
    { lead_id: 'b', buyer_id: 'B1', status: 'delivered', price: 40 },
    { lead_id: 'd', buyer_id: 'B1', status: 'failed', price: 40 },
    { lead_id: 'zzz', buyer_id: 'B1', status: 'delivered', price: 40 },
  ];
  const r = buildReport(leads, deliveries, buyers, []);

  it('counts submissions, verified, delivered and returned by week and source', () => {
    const w = r.weeks.find((x) => x.key === '2026-11-02')!;
    expect(w).toMatchObject({ submissions: 3, verified: 1, delivered: 2, returned: 1 });
    expect(r.weeks.map((x) => x.key)).toEqual(['2026-11-09', '2026-11-02']);
    const g = r.sources.find((x) => x.key === 'google')!;
    expect(g).toMatchObject({ submissions: 2, delivered: 2, returned: 1 });
  });
  it('revenue: known prices only, returned leads credited back, unpriced flagged not guessed', () => {
    expect(r.total.revenue).toEqual({ known: 40, unpriced: 1 });
    expect(r.total).toMatchObject({ delivered: 2, returned: 1 });
  });
  it('per buyer return rate inputs', () => {
    const a = r.buyers.find((b) => b.id === 'B1')!;
    expect(a).toMatchObject({ delivered: 2, returned: 1, revenue: { known: 40, unpriced: 0 } });
    expect(r.buyers.find((b) => b.id === 'B2')!.revenue).toEqual({ known: 0, unpriced: 1 });
  });
  it('ignores deliveries for leads outside the window', () => {
    expect(r.buyers.reduce((n, b) => n + b.delivered, 0)).toBe(3);
  });
  it('owner inputs are null when not entered and summed when entered', () => {
    expect(r.total.adSpend).toBeNull();
    expect(r.total.calcStarts).toBeNull();
    const i = buildReport(leads, deliveries, buyers, [
      { week_start: '2026-11-02', source: '', ad_spend: 100, calc_starts: 200, calc_completes: 120, results_cta_clicks: 15, quote_form_starts: null },
      { week_start: '2026-11-09', source: 'google', ad_spend: null, calc_starts: 50, calc_completes: null, results_cta_clicks: null, quote_form_starts: null },
    ]);
    expect(i.total).toMatchObject({ adSpend: 100, calcStarts: 250, calcCompletes: 120, quoteFormStarts: null });
    expect(i.weeks.find((x) => x.key === '2026-11-02')).toMatchObject({ adSpend: 100, calcStarts: 200 });
    expect(i.sources.find((x) => x.key === 'google')).toMatchObject({ calcStarts: 50, adSpend: null });
  });
});

describe('targets and formatting', () => {
  it('rate is null on a zero or missing denominator', () => {
    expect(rate(1, 0)).toBeNull();
    expect(rate(null, 5)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
  });
  it('states follow the targets', () => {
    expect(completionState(0.5)).toBe('missed'); // must be above 50%
    expect(completionState(0.51)).toBe('met');
    expect(resultsToQuoteState(0.1)).toBe('met'); // at least 10%
    expect(resultsToQuoteState(0.09)).toBe('missed');
    expect(returnState(0.1)).toBe('missed'); // below 10%
    expect(returnState(0.09)).toBe('met');
    expect(completionState(null)).toBe('no_data');
  });
  it('net of spend is null without spend', () => {
    expect(netOfSpend({ known: 80, unpriced: 0 }, null)).toBeNull();
    expect(netOfSpend({ known: 80, unpriced: 0 }, 100)).toBe(-20);
  });
  it('delivery price falls back to the buyer price, then unknown', () => {
    expect(deliveryPrice({ lead_id: 'x', buyer_id: 'B', status: 'delivered', price: null }, { id: 'B', name: 'n', price: 30 })).toBe(30);
    expect(deliveryPrice({ lead_id: 'x', buyer_id: 'B', status: 'delivered', price: null }, undefined)).toBeNull();
  });
  it('pct', () => {
    expect(pct(null)).toBe('n/a');
    expect(pct(0.054)).toBe('5.4%');
    expect(pct(0.512)).toBe('51%');
  });
});
