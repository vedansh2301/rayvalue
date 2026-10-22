import type { Assumptions } from '../../data/schemas';
import type { Result } from '../db/client';

/**
 * PVWatts proxy logic (pure, testable). The Astro endpoint src/pages/api/pvwatts.ts is a thin wrapper.
 * NREL is now NLR (National Laboratory of the Rockies); the v8 API lives at developer.nlr.gov.
 */
export const PVWATTS_URL = 'https://developer.nlr.gov/api/pvwatts/v8.json';
export const UPSTREAM_TIMEOUT_MS = 15000;

/**
 * Request-shape inputs that are not model choices: results are per 1 kW DC (the calculator scales
 * them) and monthly. The array geometry (tilt, azimuth, module/array type, dataset) is a model
 * assumption and comes from the database (model_assumptions.pvwatts_array).
 */
export const FIXED_PARAMS = { system_capacity: '1', timeframe: 'monthly' } as const;

/** Generous bounding boxes (FL incl. Keys and panhandle; CA incl. islands). Not exact borders. */
export const BOUNDS = {
  FL: { latMin: 24.3, latMax: 31.1, lonMin: -87.7, lonMax: -79.8 },
  CA: { latMin: 32.4, latMax: 42.1, lonMin: -124.6, lonMax: -114.0 },
} as const;

export type PvwattsArray = Assumptions['pvwatts_array'];

/** What the endpoint needs from the database: the accepted `losses` values and the array geometry. */
export interface PvwattsConfig {
  /** The configured per-shading losses (model_assumptions.pvwatts_system_loss_pct), ascending, unique. */
  losses: number[];
  array: PvwattsArray;
}

export function pvwattsConfig(a: Assumptions): PvwattsConfig {
  const { kind: _k, rationale: _r, ...byShading } = a.pvwatts_system_loss_pct;
  return { losses: [...new Set(Object.values(byShading))].sort((x, y) => x - y), array: a.pvwatts_array };
}

export interface PvwattsQuery {
  lat: string; // rounded to 2 decimals, e.g. "25.77"
  lon: string;
  losses: number;
  state: 'FL' | 'CA';
}

export type ParseResult = { ok: true; query: PvwattsQuery } | { ok: false; error: string };

function parseNumber(raw: string | null): number | null {
  if (raw === null || !/^-?\d{1,3}(\.\d+)?$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Round to 2 decimals as a canonical string (avoids "-0.00" and float noise). */
export function round2(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2);
  return s === '-0.00' ? '0.00' : s;
}

type CoordsResult = { ok: true; lat: number; lon: number; state: 'FL' | 'CA' } | { ok: false; error: string };

/** lat/lon checks (no database needed). */
export function parseCoords(params: URLSearchParams): CoordsResult {
  const lat = parseNumber(params.get('lat'));
  const lon = parseNumber(params.get('lon'));
  if (lat === null || lon === null) return { ok: false, error: 'lat and lon must be numbers' };
  const state = (Object.keys(BOUNDS) as Array<keyof typeof BOUNDS>).find((s) => {
    const b = BOUNDS[s];
    return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
  });
  if (!state) return { ok: false, error: 'lat/lon must be inside Florida or California' };
  return { ok: true, lat, lon, state };
}

/** Full parameter check. `losses` = the configured values (pvwattsConfig); anything else is rejected. */
export function parsePvwattsParams(params: URLSearchParams, losses: readonly number[]): ParseResult {
  const c = parseCoords(params);
  if (!c.ok) return c;
  const rawLosses = params.get('losses');
  const l = rawLosses !== null && /^\d{1,3}(\.\d+)?$/.test(rawLosses) ? Number(rawLosses) : NaN;
  if (!losses.includes(l)) return { ok: false, error: `losses must be one of ${losses.join(', ')}` };
  return { ok: true, query: { lat: round2(c.lat), lon: round2(c.lon), losses: l, state: c.state } };
}

/** The one canonical query string for a request; the CDN caches per URL so everything redirects to this. */
export function canonicalSearch(q: PvwattsQuery): string {
  return `?lat=${q.lat}&lon=${q.lon}&losses=${q.losses}`;
}

export function buildUpstreamUrl(q: PvwattsQuery, apiKey: string, array: PvwattsArray): URL {
  const u = new URL(PVWATTS_URL);
  u.searchParams.set('api_key', apiKey);
  u.searchParams.set('system_capacity', FIXED_PARAMS.system_capacity);
  u.searchParams.set('module_type', String(array.module_type));
  u.searchParams.set('array_type', String(array.array_type));
  u.searchParams.set('tilt', String(array.tilt));
  u.searchParams.set('azimuth', String(array.azimuth));
  u.searchParams.set('dataset', array.dataset);
  u.searchParams.set('timeframe', FIXED_PARAMS.timeframe);
  u.searchParams.set('losses', String(q.losses));
  u.searchParams.set('lat', q.lat);
  u.searchParams.set('lon', q.lon);
  return u;
}

export interface PvwattsResult {
  annual_kwh_per_kw: number;
  monthly_kwh_per_kw: number[];
  source: 'pvwatts_v8';
  station?: { lat: number; lon: number; distance_m?: number; weather_data_source?: string };
}

/** Map an upstream PVWatts v8 JSON body to the client shape; throws on anything unexpected. */
export function mapPvwattsResponse(json: unknown): PvwattsResult {
  const j = json as any;
  const o = j?.outputs;
  if (j?.errors?.length) throw new Error('upstream reported errors');
  if (!o || !Array.isArray(o.ac_monthly) || o.ac_monthly.length !== 12 || !o.ac_monthly.every((m: unknown) => typeof m === 'number' && Number.isFinite(m) && m >= 0) || !(typeof o.ac_annual === 'number' && o.ac_annual > 0)) {
    throw new Error('unexpected upstream response shape');
  }
  const r: PvwattsResult = {
    annual_kwh_per_kw: Math.round(o.ac_annual * 10) / 10,
    monthly_kwh_per_kw: o.ac_monthly.map((m: number) => Math.round(m * 10) / 10),
    source: 'pvwatts_v8',
  };
  const s = j.station_info;
  if (s && typeof s.lat === 'number' && typeof s.lon === 'number') {
    r.station = { lat: s.lat, lon: s.lon };
    if (typeof s.distance === 'number') r.station.distance_m = s.distance;
    if (typeof s.weather_data_source === 'string') r.station.weather_data_source = s.weather_data_source;
  }
  return r;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const errorResponse = (status: number, error: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store', ...extra } });

export const SUCCESS_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0',
  'CDN-Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=86400',
} as const;

export interface PvwattsDeps {
  fetch?: typeof fetch;
  /** Losses allowlist + array geometry from the database (default: repo, cached briefly per instance). */
  loadConfig?: () => Promise<Result<PvwattsConfig>>;
}

/** Instance-level cache of the DB config (the CDN caches successful responses per URL anyway). */
const CONFIG_TTL_MS = 5 * 60 * 1000;
let cached: { at: number; value: PvwattsConfig } | null = null;
export async function loadPvwattsConfigFromDb(): Promise<Result<PvwattsConfig>> {
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return { ok: true, value: cached.value };
  const { createRepo } = await import('../db/repo');
  const a = await createRepo().loadAssumptions();
  if (!a.ok) return a;
  cached = { at: Date.now(), value: pvwattsConfig(a.value) };
  return { ok: true, value: cached.value };
}

/**
 * Full request handler. `apiKey` undefined => 503; database config unavailable => 503 (no-store).
 * The key never appears in any response or log.
 */
export async function handlePvwatts(request: Request, apiKey: string | undefined, deps: PvwattsDeps = {}): Promise<Response> {
  const fetchImpl = deps.fetch ?? fetch;
  const url = new URL(request.url);
  const coords = parseCoords(url.searchParams);
  if (!coords.ok) return errorResponse(400, coords.error);
  const config = await (deps.loadConfig ?? loadPvwattsConfigFromDb)();
  if (!config.ok) {
    console.error('pvwatts: config unavailable:', config.error.kind, config.error.message);
    return errorResponse(503, 'Live solar production data is temporarily unavailable.');
  }
  const parsed = parsePvwattsParams(url.searchParams, config.value.losses);
  if (!parsed.ok) return errorResponse(400, parsed.error);
  const canonical = canonicalSearch(parsed.query);
  if (url.search !== canonical) {
    // Unrounded / reordered / extra params: send the client to the canonical URL so the CDN key is stable.
    return new Response(null, { status: 308, headers: { Location: url.pathname + canonical, 'Cache-Control': 'public, max-age=86400' } });
  }
  if (!apiKey) return errorResponse(503, 'Live solar production data is temporarily unavailable.');

  try {
    const res = await fetchImpl(buildUpstreamUrl(parsed.query, apiKey, config.value.array), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`pvwatts upstream status ${res.status}`);
      return errorResponse(502, 'Solar production service error.');
    }
    const body = mapPvwattsResponse(await res.json());
    return new Response(JSON.stringify(body), { status: 200, headers: { ...JSON_HEADERS, ...SUCCESS_CACHE_HEADERS } });
  } catch (e) {
    // Log only a redacted message: fetch errors can embed the full upstream URL (with the key).
    console.error('pvwatts upstream failure:', redact(e instanceof Error ? e.message : String(e), apiKey));
    return errorResponse(502, 'Solar production service error.');
  }
}

export function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join('[redacted]') : text;
}
