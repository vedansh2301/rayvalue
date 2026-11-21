import { err, ok, selectRows, siteDbEnv, type Result } from '../db/client';
import { round2 } from './pvwatts';
import { hemisphereOfLat, toCompassAzimuth, toPvgisAspect, type YieldResult } from './yield-provider';

/**
 * PVGIS proxy logic (pure + injectable, so it is unit tested without network). The Astro endpoint
 * src/pages/api/pvgis.ts is a thin wrapper. PVGIS (EU Joint Research Centre) serves every market that is not
 * served by PVWatts; one provider per country (markets.yield_provider), never mixed.
 *
 * Why a proxy: PVGIS states that access to its API via AJAX is not allowed, so the browser calls this route
 * (same origin, CSP connect-src 'self' unchanged) and the server calls PVGIS. PVGIS needs no key and states a
 * limit of 30 calls per second per IP (429 above it, 529 when overloaded), so the proxy
 *   - answers from the CDN first (success is cached 30 days per canonical URL, like /api/pvwatts),
 *   - then from a small in-instance cache,
 *   - and only then calls PVGIS, through a client-side rate gate well below the limit.
 *
 * Geometry: the array faces the equator (RayValue azimuth 180) at the PVGIS-computed OPTIMAL tilt. The aspect
 * sent to PVGIS depends on the hemisphere of the request: 0 (south) in the north, 180 (north) in the south.
 * Version v5_3 is pinned (PVGIS 6 exists); the dataset PVGIS used (e.g. PVGIS-ERA5, PVGIS-SARAH3) is returned so
 * pages can disclose it.
 */
export const PVGIS_URL = 'https://re.jrc.ec.europa.eu/api/v5_3/PVcalc';
export const PVGIS_PROVIDER = 'pvgis_5_3' as const;
export const UPSTREAM_TIMEOUT_MS = 15000;
/** RayValue convention: 180 = equator-facing, in both hemispheres (see yield-provider.ts). */
export const EQUATOR_FACING_AZIMUTH = 180;

export interface PvgisQuery {
  country: string;
  lat: string; // 2 decimals
  lon: string;
  losses: number;
}

export type ParseResult = { ok: true; query: PvgisQuery } | { ok: false; error: string };

function parseNumber(raw: string | null): number | null {
  if (raw === null || !/^-?\d{1,3}(\.\d+)?$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** lat/lon/country shape checks (no database needed). Whether the country uses PVGIS is checked against markets. */
export function parseLocation(params: URLSearchParams): { ok: true; country: string; lat: number; lon: number } | { ok: false; error: string } {
  const country = params.get('country') ?? '';
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, error: 'country must be a two-letter ISO code, e.g. AU' };
  const lat = parseNumber(params.get('lat'));
  const lon = parseNumber(params.get('lon'));
  if (lat === null || lon === null) return { ok: false, error: 'lat and lon must be numbers' };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { ok: false, error: 'lat/lon out of range' };
  return { ok: true, country, lat, lon };
}

/** Full parameter check. `losses` = the market's configured loss percentages; anything else is rejected (keeps the cache key space small). */
export function parsePvgisParams(params: URLSearchParams, losses: readonly number[]): ParseResult {
  const c = parseLocation(params);
  if (!c.ok) return c;
  const raw = params.get('losses');
  const l = raw !== null && /^\d{1,3}(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  if (!losses.includes(l)) return { ok: false, error: `losses must be one of ${losses.join(', ')}` };
  return { ok: true, query: { country: c.country, lat: round2(c.lat), lon: round2(c.lon), losses: l } };
}

/** The one canonical query string; the CDN caches per URL so everything redirects to this. */
export const canonicalSearch = (q: PvgisQuery) => `?country=${q.country}&lat=${q.lat}&lon=${q.lon}&losses=${q.losses}`;

/** The aspect PVGIS gets for a latitude: equator-facing = 0 in the north, 180 in the south. */
export const pvgisAspectForLat = (lat: number): number => toPvgisAspect(toCompassAzimuth(EQUATOR_FACING_AZIMUTH, hemisphereOfLat(lat)));

export function buildUpstreamUrl(q: PvgisQuery): URL {
  const u = new URL(PVGIS_URL);
  u.searchParams.set('lat', q.lat);
  u.searchParams.set('lon', q.lon);
  u.searchParams.set('peakpower', '1');
  u.searchParams.set('loss', String(q.losses));
  u.searchParams.set('aspect', String(pvgisAspectForLat(Number(q.lat))));
  u.searchParams.set('optimalinclination', '1');
  u.searchParams.set('outputformat', 'json');
  return u;
}

export interface PvgisResult extends YieldResult {
  providerId: 'pvgis_5_3';
  annual_kwh_per_kw: number;
  monthly_kwh_per_kw: number[];
  source: 'pvgis_5_3';
}

/** Map an upstream PVGIS PVcalc JSON body to the client shape; throws on anything unexpected. */
export function mapPvgisResponse(json: unknown): PvgisResult {
  const j = json as any;
  const fixed = j?.outputs?.monthly?.fixed;
  const annual = j?.outputs?.totals?.fixed?.E_y;
  if (
    !Array.isArray(fixed) ||
    fixed.length !== 12 ||
    !fixed.every((m: any, i: number) => m?.month === i + 1 && typeof m.E_m === 'number' && Number.isFinite(m.E_m) && m.E_m >= 0) ||
    !(typeof annual === 'number' && annual > 0)
  ) {
    throw new Error('unexpected upstream response shape');
  }
  const mounting = j?.inputs?.mounting_system?.fixed;
  const slope = typeof mounting?.slope?.value === 'number' ? mounting.slope.value : null;
  const aspect = typeof mounting?.azimuth?.value === 'number' ? mounting.azimuth.value : null;
  const monthly = fixed.map((m: any) => Math.round(m.E_m * 10) / 10);
  const annualRounded = Math.round(annual * 10) / 10;
  return {
    providerId: PVGIS_PROVIDER,
    source: PVGIS_PROVIDER,
    annualKwhPerKw: annualRounded,
    annual_kwh_per_kw: annualRounded,
    monthlyKwhPerKw: monthly,
    monthly_kwh_per_kw: monthly,
    dataset: typeof j?.inputs?.meteo_data?.radiation_db === 'string' ? j.inputs.meteo_data.radiation_db : 'PVGIS',
    tiltDeg: slope,
    // PVGIS aspect (0 = south) back to compass azimuth (0 = north).
    compassAzimuthDeg: aspect === null ? Number.NaN : (((aspect + 180) % 360) + 360) % 360,
  };
}

// --------------------------------------------------------------- rate gate + cache

/** Allows at most `maxPerSecond` upstream calls per rolling second per instance (PVGIS allows 30/s per IP). */
export function createRateGate(maxPerSecond = 20, now: () => number = Date.now) {
  const stamps: number[] = [];
  return {
    tryAcquire(): boolean {
      const t = now();
      while (stamps.length && t - stamps[0]! >= 1000) stamps.shift();
      if (stamps.length >= maxPerSecond) return false;
      stamps.push(t);
      return true;
    },
  };
}

/** Tiny TTL cache (per instance) in front of the upstream call; the CDN is the main cache. */
export function createTtlCache<T>(ttlMs = 60 * 60 * 1000, max = 500, now: () => number = Date.now) {
  const m = new Map<string, { at: number; value: T }>();
  return {
    get(key: string): T | undefined {
      const e = m.get(key);
      if (!e) return undefined;
      if (now() - e.at > ttlMs) {
        m.delete(key);
        return undefined;
      }
      return e.value;
    },
    set(key: string, value: T) {
      if (m.size >= max) m.delete(m.keys().next().value as string);
      m.set(key, { at: now(), value });
    },
  };
}

// ---------------------------------------------------------------------- handler

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const errorResponse = (status: number, error: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store', ...extra } });

export const SUCCESS_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0',
  'CDN-Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=86400',
} as const;

export interface PvgisMarketConfig {
  provider: 'pvwatts' | 'pvgis';
  /** The market's configured loss percentages (model_assumptions.pvwatts_system_loss_pct), ascending, unique. */
  losses: number[];
}

export interface PvgisDeps {
  fetch?: typeof fetch;
  /** Market lookup (default: Supabase markets + model_assumptions, cached 5 minutes per instance). */
  loadConfig?: (country: string) => Promise<Result<PvgisMarketConfig>>;
  gate?: { tryAcquire(): boolean };
  cache?: ReturnType<typeof createTtlCache<PvgisResult>>;
}

const CONFIG_TTL_MS = 5 * 60 * 1000;
const configCache = new Map<string, { at: number; value: PvgisMarketConfig }>();

export async function loadPvgisConfigFromDb(country: string): Promise<Result<PvgisMarketConfig>> {
  const hit = configCache.get(country);
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return ok(hit.value);
  const env = siteDbEnv();
  const m = await selectRows<{ yield_provider: 'pvwatts' | 'pvgis' }>(env, 'markets', { select: 'code,yield_provider', code: `eq.${country}` });
  if (!m.ok) return m;
  if (!m.value[0]) return err('not_found', `no market ${country}`);
  const a = await selectRows<{ state: string | null; value: Record<string, unknown> }>(env, 'model_assumptions', {
    select: 'state,value',
    country: `eq.${country}`,
    key: 'eq.pvwatts_system_loss_pct',
  });
  if (!a.ok) return a;
  // Country-wide row only (state null): loss percentages are per market, not per region.
  const row = a.value.find((r) => r.state === null);
  const losses = row ? [...new Set(Object.values(row.value).filter((v): v is number => typeof v === 'number'))].sort((x, y) => x - y) : [];
  const value: PvgisMarketConfig = { provider: m.value[0].yield_provider, losses };
  configCache.set(country, { at: Date.now(), value });
  return ok(value);
}

const defaultGate = createRateGate(20);
const defaultCache = createTtlCache<PvgisResult>();

/**
 * Full request handler.
 *   400 bad parameters / a country served by PVWatts (use /api/pvwatts) / unknown country
 *   308 redirect to the canonical URL
 *   503 market config unavailable, or PVGIS overloaded (Retry-After)
 *   429 this instance is above its own upstream budget (Retry-After)
 *   422 PVGIS has no data for the point (for example over the sea)
 *   502 PVGIS error or unexpected body
 * Nothing secret is involved: PVGIS needs no key.
 */
export async function handlePvgis(request: Request, deps: PvgisDeps = {}): Promise<Response> {
  const fetchImpl = deps.fetch ?? fetch;
  const gate = deps.gate ?? defaultGate;
  const cache = deps.cache ?? defaultCache;
  const url = new URL(request.url);
  const loc = parseLocation(url.searchParams);
  if (!loc.ok) return errorResponse(400, loc.error);

  const config = await (deps.loadConfig ?? loadPvgisConfigFromDb)(loc.country);
  if (!config.ok) {
    if (config.error.kind === 'not_found') return errorResponse(400, 'unknown market');
    console.error('pvgis: config unavailable:', config.error.kind, config.error.message);
    return errorResponse(503, 'Live solar production data is temporarily unavailable.');
  }
  // One provider per country: PVWatts countries are never served from PVGIS.
  if (config.value.provider !== 'pvgis') return errorResponse(400, 'this market uses /api/pvwatts');
  if (config.value.losses.length === 0) return errorResponse(503, 'Live solar production data is temporarily unavailable.');

  const parsed = parsePvgisParams(url.searchParams, config.value.losses);
  if (!parsed.ok) return errorResponse(400, parsed.error);
  const canonical = canonicalSearch(parsed.query);
  if (url.search !== canonical) {
    return new Response(null, { status: 308, headers: { Location: url.pathname + canonical, 'Cache-Control': 'public, max-age=86400' } });
  }

  const cached = cache.get(canonical);
  if (cached) return new Response(JSON.stringify(cached), { status: 200, headers: { ...JSON_HEADERS, ...SUCCESS_CACHE_HEADERS } });
  if (!gate.tryAcquire()) return errorResponse(429, 'Too many requests, try again in a moment.', { 'Retry-After': '1' });

  try {
    const res = await fetchImpl(buildUpstreamUrl(parsed.query), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), headers: { Accept: 'application/json' } });
    if (res.status === 429 || res.status === 529) {
      console.error(`pvgis upstream status ${res.status}`);
      return errorResponse(503, 'Solar production service is busy, try again shortly.', { 'Retry-After': '5' });
    }
    if (res.status === 400) return errorResponse(422, 'No solar data is available for this location.');
    if (!res.ok) {
      console.error(`pvgis upstream status ${res.status}`);
      return errorResponse(502, 'Solar production service error.');
    }
    const body = mapPvgisResponse(await res.json());
    cache.set(canonical, body);
    return new Response(JSON.stringify(body), { status: 200, headers: { ...JSON_HEADERS, ...SUCCESS_CACHE_HEADERS } });
  } catch (e) {
    console.error('pvgis upstream failure:', e instanceof Error ? e.name : 'error');
    return errorResponse(502, 'Solar production service error.');
  }
}
