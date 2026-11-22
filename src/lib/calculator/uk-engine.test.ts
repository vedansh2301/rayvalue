import { describe, expect, it, vi } from 'vitest';
import { buildSavingsChart } from '../calc/chart';
import { moneyFormats } from './display';
import { fetchLivePvgis } from './uk-engine';

const BODY = { annual_kwh_per_kw: 1022.9, monthly_kwh_per_kw: [42.7, 55, 87.6, 114.5, 117.7, 120.1, 121.1, 109.5, 95.8, 70.2, 50.4, 38.3] };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

describe('fetchLivePvgis', () => {
  it('returns the production record from a good response, asking /api/pvgis', async () => {
    const f = vi.fn(async () => json(BODY));
    const p = await fetchLivePvgis('/api/pvgis?country=GB&lat=51.51&lon=-0.13&losses=14', f as unknown as typeof fetch);
    expect(p).toEqual({ annualKwhPerKw: 1022.9, monthlyKwhPerKw: BODY.monthly_kwh_per_kw });
    expect(f).toHaveBeenCalledWith('/api/pvgis?country=GB&lat=51.51&lon=-0.13&losses=14', expect.objectContaining({ headers: { Accept: 'application/json' } }));
  });
  it('is null (never throws) on an error status, a bad body, a network failure or an aborted run', async () => {
    expect(await fetchLivePvgis('/x', (async () => json({ error: 'x' }, 502)) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLivePvgis('/x', (async () => json({ annual_kwh_per_kw: -1, monthly_kwh_per_kw: [] })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLivePvgis('/x', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
    const c = new AbortController();
    c.abort();
    expect(await fetchLivePvgis('/x', (async () => json(BODY)) as unknown as typeof fetch, 1000, c.signal)).toBeNull();
  });
});

describe('GBP formatting and chart labels', () => {
  it('formats pounds in en-GB with a true minus sign', () => {
    const f = moneyFormats('en-GB', 'GBP');
    expect(f.money(5400)).toBe('£5,400');
    expect(f.signed(-350)).toBe('−£350');
    expect(f.signed(6400)).toBe('£6,400');
    expect(f.symbol).toBe('£');
  });
  it('the savings chart uses the given currency symbol and keeps "$" by default', () => {
    const r = { cost: { low: 4000, likely: 5000, high: 6000 }, paybackYears: { low: 8, likely: 10, high: 14 }, analysisYears: 3, yearlySavings: [600, 600, 600], yearlySavingsLow: [400, 400, 400], yearlySavingsHigh: [800, 800, 800] };
    const gbp = buildSavingsChart(r, '£')!;
    expect(gbp.costLabel).toBe('Upfront cost £5,000');
    expect(gbp.yTicks.every((t) => t.label.startsWith('£'))).toBe(true);
    expect(gbp.desc).not.toContain('$');
    const usd = buildSavingsChart(r)!;
    expect(usd.costLabel).toBe('Upfront cost $5,000');
    expect(usd.yTicks[0]!.label).toBe('$0');
  });
});
