/** Yield-provider abstraction and the PVGIS proxy, with a SYNTHETIC upstream body (same shape as PVGIS v5_3 PVcalc). */
import { describe, expect, it, vi } from 'vitest';
import { buildUpstreamUrl, canonicalSearch, createRateGate, createTtlCache, handlePvgis, mapPvgisResponse, parsePvgisParams, pvgisAspectForLat, PVGIS_URL, type PvgisDeps } from './pvgis';
import { hemisphereOfLat, providerForCountry, providersAreExclusive, routeForProvider, toCompassAzimuth, toPvgisAspect, toPvwattsAzimuth } from './yield-provider';

const monthly = [150, 140, 130, 110, 90, 80, 85, 100, 120, 135, 145, 155];
const upstream = (over: Record<string, unknown> = {}) => ({
  inputs: {
    location: { latitude: -33.87, longitude: 151.21, elevation: 57 },
    meteo_data: { radiation_db: 'PVGIS-ERA5', meteo_db: 'ERA5', year_min: 2005, year_max: 2023 },
    mounting_system: { fixed: { slope: { value: 34, optimal: true }, azimuth: { value: 180, optimal: false }, type: 'free-standing' } },
  },
  outputs: {
    monthly: { fixed: monthly.map((E_m, i) => ({ month: i + 1, E_d: E_m / 30, E_m, 'H(i)_d': 5, 'H(i)_m': 150, SD_m: 5 })) },
    totals: { fixed: { E_y: monthly.reduce((a, b) => a + b, 0) } },
  },
  ...over,
});

describe('azimuth conventions (RayValue 180 = equator-facing)', () => {
  it('northern hemisphere: equator-facing is compass 180 = PVWatts azimuth 180 = PVGIS aspect 0', () => {
    const c = toCompassAzimuth(180, 'N');
    expect([c, toPvwattsAzimuth(c), toPvgisAspect(c)]).toEqual([180, 180, 0]);
  });
  it('southern hemisphere: equator-facing is NORTH: compass 0 = PVWatts azimuth 0 = PVGIS aspect 180', () => {
    const c = toCompassAzimuth(180, 'S');
    expect([c, toPvwattsAzimuth(c), toPvgisAspect(c)]).toEqual([0, 0, 180]);
  });
  it('PVGIS aspect for the cardinal directions: S 0, W 90, E -90, N 180', () => {
    expect([180, 270, 90, 0].map(toPvgisAspect)).toEqual([0, 90, -90, 180]);
  });
  it('an off-axis array: RayValue 160 (20 degrees from equator-facing) is aspect -20 in the north and aspect 160 in the south', () => {
    expect(toPvgisAspect(toCompassAzimuth(160, 'N'))).toBe(-20);
    expect(toPvgisAspect(toCompassAzimuth(160, 'S'))).toBe(160);
  });
  it('hemisphere is taken from the sign of the latitude (equator = north)', () => {
    expect([hemisphereOfLat(-33.87), hemisphereOfLat(28.6), hemisphereOfLat(0)]).toEqual(['S', 'N', 'N']);
  });
  it('the upstream aspect follows the request latitude: Sydney / Sao Paulo / Cape Town 180 (north-facing), Delhi / Tokyo / Dubai 0', () => {
    expect([-33.87, -23.55, -33.92].map(pvgisAspectForLat)).toEqual([180, 180, 180]);
    expect([28.61, 35.68, 25.2].map(pvgisAspectForLat)).toEqual([0, 0, 0]);
  });
});

describe('provider choice is per country, from the markets table', () => {
  const markets = [
    { code: 'US', yield_provider: 'pvwatts' as const },
    { code: 'CA', yield_provider: 'pvwatts' as const },
    { code: 'AU', yield_provider: 'pvgis' as const },
  ];
  it('maps a country to exactly one provider and route', () => {
    expect(providerForCountry('US', markets)).toBe('pvwatts_v8');
    expect(providerForCountry('CA', markets)).toBe('pvwatts_v8');
    expect(providerForCountry('AU', markets)).toBe('pvgis_5_3');
    expect(providerForCountry('NZ', markets)).toBeNull();
    expect(routeForProvider('pvwatts_v8')).toBe('/api/pvwatts');
    expect(routeForProvider('pvgis_5_3')).toBe('/api/pvgis');
  });
  it('detects a country listed under two providers', () => {
    expect(providersAreExclusive(markets)).toBe(true);
    expect(providersAreExclusive([...markets, { code: 'AU', yield_provider: 'pvwatts' }])).toBe(false);
  });
});

describe('request building and parsing', () => {
  it('builds the pinned v5_3 URL: 1 kW, losses, optimal tilt, hemisphere-correct aspect, JSON', () => {
    const u = buildUpstreamUrl({ country: 'AU', lat: '-33.87', lon: '151.21', losses: 14 });
    expect(u.origin + u.pathname).toBe(PVGIS_URL);
    expect(Object.fromEntries(u.searchParams)).toEqual({ lat: '-33.87', lon: '151.21', peakpower: '1', loss: '14', aspect: '180', optimalinclination: '1', outputformat: 'json' });
    expect(buildUpstreamUrl({ country: 'IN', lat: '28.61', lon: '77.21', losses: 14 }).searchParams.get('aspect')).toBe('0');
  });
  it('parses and rounds; only the market\'s configured losses are accepted', () => {
    const p = (q: string) => parsePvgisParams(new URLSearchParams(q), [14, 20, 30]);
    expect(p('country=AU&lat=-33.8688&lon=151.2093&losses=14')).toEqual({ ok: true, query: { country: 'AU', lat: '-33.87', lon: '151.21', losses: 14 } });
    expect(p('country=AU&lat=-33.87&lon=151.21&losses=15')).toMatchObject({ ok: false });
    expect(p('country=au&lat=-33.87&lon=151.21&losses=14')).toMatchObject({ ok: false });
    expect(p('country=AU&lat=95&lon=151.21&losses=14')).toMatchObject({ ok: false });
    expect(p('country=AU&lat=abc&lon=151.21&losses=14')).toMatchObject({ ok: false });
  });
});

describe('mapPvgisResponse', () => {
  it('maps monthly and annual energy per kW, the dataset and the geometry used', () => {
    const r = mapPvgisResponse(upstream());
    expect(r.annualKwhPerKw).toBe(1440);
    expect(r.monthlyKwhPerKw).toEqual(monthly);
    expect(r.dataset).toBe('PVGIS-ERA5');
    expect(r.tiltDeg).toBe(34);
    expect(r.compassAzimuthDeg).toBe(0); // PVGIS aspect 180 = facing north = compass 0 (southern-hemisphere equator-facing)
    expect(r.providerId).toBe('pvgis_5_3');
  });
  it('rejects a body of the wrong shape', () => {
    expect(() => mapPvgisResponse({})).toThrow();
    const bad = upstream();
    (bad.outputs.monthly.fixed as unknown[]).pop();
    expect(() => mapPvgisResponse(bad)).toThrow();
    const neg = upstream();
    neg.outputs.monthly.fixed[3]!.E_m = -1;
    expect(() => mapPvgisResponse(neg)).toThrow();
  });
});

describe('rate gate and cache', () => {
  it('allows at most N per rolling second', () => {
    let t = 0;
    const g = createRateGate(3, () => t);
    expect([g.tryAcquire(), g.tryAcquire(), g.tryAcquire(), g.tryAcquire()]).toEqual([true, true, true, false]);
    t = 999;
    expect(g.tryAcquire()).toBe(false);
    t = 1000;
    expect(g.tryAcquire()).toBe(true);
  });
  it('ttl cache expires and evicts the oldest at capacity', () => {
    let t = 0;
    const c = createTtlCache<number>(100, 2, () => t);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect([c.get('a'), c.get('b'), c.get('c')]).toEqual([undefined, 2, 3]);
    t = 101;
    expect(c.get('b')).toBeUndefined();
  });
});

describe('handlePvgis', () => {
  const Q = { country: 'AU', lat: '-33.87', lon: '151.21', losses: 14 };
  const req = (search = canonicalSearch(Q)) => new Request(`https://rayvalue.test/api/pvgis${search}`);
  const deps = (over: Partial<PvgisDeps> = {}): PvgisDeps => ({
    loadConfig: async () => ({ ok: true, value: { provider: 'pvgis', losses: [14, 20, 30] } }),
    fetch: vi.fn(async () => new Response(JSON.stringify(upstream()), { status: 200 })) as unknown as typeof fetch,
    gate: createRateGate(100),
    cache: createTtlCache(),
    ...over,
  });

  it('200: calls PVGIS once, returns the mapped body with 30-day CDN caching, then answers repeats from cache without another call', async () => {
    const d = deps();
    const a = await handlePvgis(req(), d);
    expect(a.status).toBe(200);
    expect(a.headers.get('CDN-Cache-Control')).toContain('s-maxage=2592000');
    expect(await a.json()).toMatchObject({ source: 'pvgis_5_3', annual_kwh_per_kw: 1440, dataset: 'PVGIS-ERA5', tiltDeg: 34 });
    const b = await handlePvgis(req(), d);
    expect(b.status).toBe(200);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    const sent = new URL(String((d.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]));
    expect(sent.searchParams.get('aspect')).toBe('180'); // Sydney: north-facing
  });
  it('308 to the canonical URL for unrounded / reordered params', async () => {
    const r = await handlePvgis(req('?lat=-33.8688&lon=151.2093&country=AU&losses=14'), deps());
    expect(r.status).toBe(308);
    expect(r.headers.get('Location')).toBe('/api/pvgis?country=AU&lat=-33.87&lon=151.21&losses=14');
  });
  it('400 for a country served by PVWatts (never mix providers within a country) and for an unknown country', async () => {
    const d = deps({ loadConfig: async () => ({ ok: true, value: { provider: 'pvwatts', losses: [14] } }) });
    const r = await handlePvgis(req('?country=US&lat=25.77&lon=-80.20&losses=14'), d);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'this market uses /api/pvwatts' });
    expect(d.fetch).not.toHaveBeenCalled();
    const unknown = await handlePvgis(req(), deps({ loadConfig: async () => ({ ok: false, error: { kind: 'not_found', message: 'x' } }) }));
    expect(unknown.status).toBe(400);
  });
  it('400 for a losses value that is not configured (no upstream call)', async () => {
    const d = deps();
    expect((await handlePvgis(req('?country=AU&lat=-33.87&lon=151.21&losses=99'), d)).status).toBe(400);
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it('503 when the market config is unavailable or has no losses', async () => {
    expect((await handlePvgis(req(), deps({ loadConfig: async () => ({ ok: false, error: { kind: 'network', message: 'x' } }) }))).status).toBe(503);
    expect((await handlePvgis(req(), deps({ loadConfig: async () => ({ ok: true, value: { provider: 'pvgis', losses: [] } }) }))).status).toBe(503);
  });
  it('429 with Retry-After when this instance is over its own upstream budget; cached answers still work', async () => {
    const gate = createRateGate(0);
    const d = deps({ gate });
    const r = await handlePvgis(req(), d);
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('1');
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it('upstream 429 / 529 -> 503 with Retry-After; 400 (e.g. over the sea) -> 422; 500 -> 502; bad body -> 502; no-store on errors', async () => {
    const status = (s: number) => deps({ fetch: vi.fn(async () => new Response('{"message":"x"}', { status: s })) as unknown as typeof fetch });
    const r429 = await handlePvgis(req(), status(429));
    expect([r429.status, r429.headers.get('Retry-After'), r429.headers.get('Cache-Control')]).toEqual([503, '5', 'no-store']);
    expect((await handlePvgis(req(), status(529))).status).toBe(503);
    expect((await handlePvgis(req(), status(400))).status).toBe(422);
    expect((await handlePvgis(req(), status(500))).status).toBe(502);
    const bad = deps({ fetch: vi.fn(async () => new Response('{"outputs":{}}', { status: 200 })) as unknown as typeof fetch });
    expect((await handlePvgis(req(), bad)).status).toBe(502);
    const boom = deps({ fetch: vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch });
    expect((await handlePvgis(req(), boom)).status).toBe(502);
  });
  it('a failed upstream call is not cached', async () => {
    const d = deps({ fetch: vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch });
    await handlePvgis(req(), d);
    await handlePvgis(req(), d);
    expect(d.fetch).toHaveBeenCalledTimes(2);
  });
  it('requests nothing but the documented PVGIS parameters (no user data forwarded)', async () => {
    const d = deps();
    await handlePvgis(req(), d);
    const sent = new URL(String((d.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]));
    expect([...sent.searchParams.keys()].sort()).toEqual(['aspect', 'lat', 'lon', 'loss', 'optimalinclination', 'outputformat', 'peakpower']);
  });
});
