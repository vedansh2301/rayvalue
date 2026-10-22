import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/pvwatts-miami.json';
import {
  BOUNDS,
  PVWATTS_URL,
  allowedLosses,
  buildUpstreamUrl,
  canonicalSearch,
  handlePvwatts,
  mapPvwattsResponse,
  parsePvwattsParams,
  round2,
} from './pvwatts';

const KEY = 'SECRET-KEY-abc123';
const p = (q: string) => parsePvwattsParams(new URLSearchParams(q));
const req = (q: string) => new Request(`https://rayvalue.com/api/pvwatts${q}`);
const okFetch = () => vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));

describe('parsePvwattsParams', () => {
  it('accepts configured losses and FL / CA points, rounding to 2 decimals', () => {
    expect(allowedLosses().sort()).toEqual([14, 20, 30]);
    const r = p('lat=25.7685&lon=-80.2034&losses=14');
    expect(r).toEqual({ ok: true, query: { lat: '25.77', lon: '-80.20', losses: 14, state: 'FL' } });
    expect(p('lat=34.05&lon=-118.24&losses=30')).toMatchObject({ ok: true, query: { state: 'CA', losses: 30 } });
  });
  it('rejects non-numbers, out-of-state points and unconfigured losses (400 reasons)', () => {
    for (const q of [
      'lat=abc&lon=-80&losses=14',
      'lon=-80&losses=14',
      'lat=25.77&lon=-80.2',
      'lat=40.71&lon=-74.0&losses=14', // New York
      'lat=33.0&lon=-96.8&losses=14', // Texas
      'lat=25.77&lon=-80.2&losses=15',
      'lat=25.77&lon=-80.2&losses=14abc',
      'lat=1e1&lon=-80.2&losses=14',
    ]) {
      expect(p(q).ok, q).toBe(false);
    }
  });
  it('bounding boxes do not overlap', () => {
    expect(BOUNDS.FL.lonMin).toBeGreaterThan(BOUNDS.CA.lonMax);
  });
  it('round2 is canonical', () => {
    expect(round2(-0.001)).toBe('0.00');
    expect(round2(25.775)).toBe('25.78');
    expect(round2(-80.2)).toBe('-80.20');
  });
});

describe('upstream URL', () => {
  it('uses the NLR v8 endpoint with fixed system params', () => {
    const r = p('lat=25.77&lon=-80.20&losses=20');
    if (!r.ok) throw new Error('x');
    const u = buildUpstreamUrl(r.query, KEY);
    expect(u.origin + u.pathname).toBe(PVWATTS_URL);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      api_key: KEY, system_capacity: '1', module_type: '0', array_type: '1', tilt: '20', azimuth: '180',
      dataset: 'nsrdb', timeframe: 'monthly', losses: '20', lat: '25.77', lon: '-80.20',
    });
  });
});

describe('mapPvwattsResponse', () => {
  it('maps a recorded v8 response to the client shape', () => {
    const r = mapPvwattsResponse(fixture);
    expect(r.source).toBe('pvwatts_v8');
    expect(r.annual_kwh_per_kw).toBe(1558.4);
    expect(r.monthly_kwh_per_kw).toHaveLength(12);
    expect(r.monthly_kwh_per_kw[0]).toBe(118.3);
    expect(r.station).toEqual({ lat: 25.77000045776367, lon: -80.22000122070312, distance_m: 2026, weather_data_source: 'NSRDB PSM V3 GOES tmy-2020 3.2.0' });
  });
  it('throws on errors or malformed bodies', () => {
    expect(() => mapPvwattsResponse({ errors: ['bad'], outputs: fixture.outputs })).toThrow();
    expect(() => mapPvwattsResponse({ errors: [], outputs: { ac_annual: 1, ac_monthly: [1] } })).toThrow();
    expect(() => mapPvwattsResponse(null)).toThrow();
  });
});

describe('handlePvwatts', () => {
  const good = '?lat=25.77&lon=-80.20&losses=14';
  it('200 with CDN cache headers and the mapped body', async () => {
    const f = okFetch();
    const res = await handlePvwatts(req(good), KEY, f as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0');
    expect(res.headers.get('CDN-Cache-Control')).toBe('public, s-maxage=2592000, stale-while-revalidate=86400');
    expect((await res.json()).annual_kwh_per_kw).toBe(1558.4);
    expect(f).toHaveBeenCalledOnce();
  });
  it('308 redirects unrounded / reordered URLs to the canonical one without calling upstream', async () => {
    const f = okFetch();
    const res = await handlePvwatts(req('?losses=14&lon=-80.2034&lat=25.7685'), KEY, f as unknown as typeof fetch);
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('/api/pvwatts' + canonicalSearch({ lat: '25.77', lon: '-80.20', losses: 14, state: 'FL' }));
    expect(f).not.toHaveBeenCalled();
  });
  it('400 on invalid input (no-store), before any key check', async () => {
    const res = await handlePvwatts(req('?lat=40&lon=-74&losses=14'), undefined);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('503 without a key', async () => {
    const f = okFetch();
    const res = await handlePvwatts(req(good), undefined, f as unknown as typeof fetch);
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(f).not.toHaveBeenCalled();
  });
  it('502 on upstream HTTP errors, bad bodies and network errors, never leaking the key', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cases: Array<typeof fetch> = [
      (async () => new Response(`denied for ${KEY}`, { status: 403 })) as typeof fetch,
      (async () => new Response(JSON.stringify({ errors: [`bad key ${KEY}`], outputs: null }), { status: 200 })) as typeof fetch,
      (async () => { throw new Error(`fetch failed: ${PVWATTS_URL}?api_key=${KEY}`); }) as typeof fetch,
    ];
    for (const f of cases) {
      const res = await handlePvwatts(req(good), KEY, f);
      expect(res.status).toBe(502);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const text = await res.text();
      expect(text).not.toContain(KEY);
      expect(JSON.stringify([...res.headers])).not.toContain(KEY);
    }
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(KEY);
    errSpy.mockRestore();
  });
  it('success responses do not contain the key', async () => {
    const res = await handlePvwatts(req(good), KEY, okFetch() as unknown as typeof fetch);
    expect(await res.text()).not.toContain(KEY);
  });
});
