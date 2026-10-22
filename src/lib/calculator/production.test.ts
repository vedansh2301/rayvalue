// Synthetic numbers only (shape tests); real production values live in the DB.
import { describe, expect, it, vi } from 'vitest';
import { coord2, fallbackProduction, fetchLiveProduction, getProduction, parsePvwattsBody, pvwattsUrl, type FallbackCity, type FallbackProduction } from './production';

const months = (v: number) => Array.from({ length: 12 }, () => v);
const cities: FallbackCity[] = [
  { state: 'FL', slug: 'north', name: 'North Town', lat: 30, lon: -82 },
  { state: 'FL', slug: 'south', name: 'South Town', lat: 26, lon: -80.2 },
  { state: 'CA', slug: 'west', name: 'West Town', lat: 26.1, lon: -80.3 },
];
const rows: FallbackProduction[] = [
  { slug: 'north', losses: 10, annualKwhPerKw: 120, monthlyKwhPerKw: months(10) },
  { slug: 'south', losses: 10, annualKwhPerKw: 240, monthlyKwhPerKw: months(20) },
  { slug: 'south', losses: 20, annualKwhPerKw: 216, monthlyKwhPerKw: months(18) },
];
const okBody = { annual_kwh_per_kw: 1200, monthly_kwh_per_kw: months(100), source: 'pvwatts_v8' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('pvwattsUrl', () => {
  it('uses canonical order and 2-decimal coordinates', () => {
    expect(pvwattsUrl(25.7743, -80.1937, 14)).toBe('/api/pvwatts?lat=25.77&lon=-80.19&losses=14');
    expect(pvwattsUrl(34, -118.5, 22.5)).toBe('/api/pvwatts?lat=34.00&lon=-118.50&losses=22.5');
  });
  it('never emits -0.00', () => {
    expect(coord2(-0.001)).toBe('0.00');
  });
});

describe('parsePvwattsBody', () => {
  it('accepts the endpoint shape', () => {
    expect(parsePvwattsBody(okBody)).toEqual({ annualKwhPerKw: 1200, monthlyKwhPerKw: months(100) });
  });
  it('rejects anything else', () => {
    expect(parsePvwattsBody(null)).toBeNull();
    expect(parsePvwattsBody({ error: 'x' })).toBeNull();
    expect(parsePvwattsBody({ ...okBody, annual_kwh_per_kw: 0 })).toBeNull();
    expect(parsePvwattsBody({ ...okBody, monthly_kwh_per_kw: months(1).slice(1) })).toBeNull();
    expect(parsePvwattsBody({ ...okBody, monthly_kwh_per_kw: [...months(1).slice(1), -1] })).toBeNull();
  });
});

describe('fetchLiveProduction', () => {
  it('returns production on 200', async () => {
    const f = vi.fn(async () => json(okBody));
    expect(await fetchLiveProduction(25.77, -80.19, 14, f as unknown as typeof fetch)).toEqual({ annualKwhPerKw: 1200, monthlyKwhPerKw: months(100) });
    expect((f.mock.calls[0] as unknown[])[0]).toBe('/api/pvwatts?lat=25.77&lon=-80.19&losses=14');
  });
  it('returns null on non-200, network error or bad JSON', async () => {
    expect(await fetchLiveProduction(25.77, -80.19, 14, (async () => json({ error: 'x' }, 503)) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLiveProduction(25.77, -80.19, 14, (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLiveProduction(25.77, -80.19, 14, (async () => new Response('not json')) as unknown as typeof fetch)).toBeNull();
  });
  it('gives up after the timeout', async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    expect(await fetchLiveProduction(25.77, -80.19, 14, hang, 10)).toBeNull();
  });
});

describe('fallbackProduction', () => {
  it('picks the nearest in-state city with a row at the requested losses', () => {
    const r = fallbackProduction(26.1, -80.3, 'FL', 10, cities, rows);
    expect(r?.city.slug).toBe('south');
    expect(r?.production.annualKwhPerKw).toBe(240);
  });
  it('skips cities without a row at those losses', () => {
    expect(fallbackProduction(30, -82, 'FL', 20, cities, rows)?.city.slug).toBe('south');
  });
  it('returns null when nothing matches', () => {
    expect(fallbackProduction(26, -80, 'FL', 99, cities, rows)).toBeNull();
    expect(fallbackProduction(26, -80, 'FL', 10, [], rows)).toBeNull();
  });
});

describe('getProduction', () => {
  const args = { lat: 26.1, lon: -80.3, state: 'FL' as const, losses: 10, cities, rows };
  it('prefers live data', async () => {
    expect(await getProduction(args, (async () => json(okBody)) as unknown as typeof fetch)).toEqual({ ok: true, source: 'live', production: { annualKwhPerKw: 1200, monthlyKwhPerKw: months(100) } });
  });
  it('falls back to the nearest city', async () => {
    const r = await getProduction(args, (async () => json({}, 502)) as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, source: 'fallback', cityName: 'South Town', production: { annualKwhPerKw: 240, monthlyKwhPerKw: months(20) } });
  });
  it('fails when neither is available', async () => {
    expect(await getProduction({ ...args, rows: [] }, (async () => json({}, 502)) as unknown as typeof fetch)).toEqual({ ok: false });
  });
});
