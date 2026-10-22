/**
 * PVWatts proxy logic (pure, testable). The Astro endpoint src/pages/api/pvwatts.ts is a thin wrapper.
 * NREL is now NLR (National Laboratory of the Rockies); the v8 API lives at developer.nlr.gov.
 */
import assumptionsJson from '../../data/assumptions.json';
import { AssumptionsSchema } from '../../data/schemas';

const assumptions = AssumptionsSchema.parse(assumptionsJson);

export const PVWATTS_URL = 'https://developer.nlr.gov/api/pvwatts/v8.json';
export const UPSTREAM_TIMEOUT_MS = 15000;

/** Fixed PVWatts inputs: 1 kW DC, standard modules, fixed roof mount, 20 degree tilt, south-facing. */
export const FIXED_PARAMS = {
  system_capacity: '1',
  module_type: '0',
  array_type: '1',
  tilt: '20',
  azimuth: '180',
  dataset: 'nsrdb',
  timeframe: 'monthly',
} as const;

/** Generous bounding boxes (FL incl. Keys and panhandle; CA incl. islands). Not exact borders. */
export const BOUNDS = {
  FL: { latMin: 24.3, latMax: 31.1, lonMin: -87.7, lonMax: -79.8 },
  CA: { latMin: 32.4, latMax: 42.1, lonMin: -124.6, lonMax: -114.0 },
} as const;

export function allowedLosses(): number[] {
  return [...new Set(Object.values(assumptions.pvwatts_system_loss_pct).filter((v): v is number => typeof v === 'number'))];
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

export function parsePvwattsParams(params: URLSearchParams, losses: readonly number[] = allowedLosses()): ParseResult {
  const lat = parseNumber(params.get('lat'));
  const lon = parseNumber(params.get('lon'));
  if (lat === null || lon === null) return { ok: false, error: 'lat and lon must be numbers' };
  const state = (Object.keys(BOUNDS) as Array<keyof typeof BOUNDS>).find((s) => {
    const b = BOUNDS[s];
    return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
  });
  if (!state) return { ok: false, error: 'lat/lon must be inside Florida or California' };
  const rawLosses = params.get('losses');
  const l = rawLosses !== null && /^\d{1,3}(\.\d+)?$/.test(rawLosses) ? Number(rawLosses) : NaN;
  if (!losses.includes(l)) return { ok: false, error: `losses must be one of ${losses.join(', ')}` };
  return { ok: true, query: { lat: round2(lat), lon: round2(lon), losses: l, state } };
}

/** The one canonical query string for a request; the CDN caches per URL so everything redirects to this. */
export function canonicalSearch(q: PvwattsQuery): string {
  return `?lat=${q.lat}&lon=${q.lon}&losses=${q.losses}`;
}

export function buildUpstreamUrl(q: PvwattsQuery, apiKey: string): URL {
  const u = new URL(PVWATTS_URL);
  u.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(FIXED_PARAMS)) u.searchParams.set(k, v);
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

/** Full request handler. `apiKey` undefined => 503. The key never appears in any response or log. */
export async function handlePvwatts(
  request: Request,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parsePvwattsParams(url.searchParams);
  if (!parsed.ok) return errorResponse(400, parsed.error);
  const canonical = canonicalSearch(parsed.query);
  if (url.search !== canonical) {
    // Unrounded / reordered / extra params: send the client to the canonical URL so the CDN key is stable.
    return new Response(null, { status: 308, headers: { Location: url.pathname + canonical, 'Cache-Control': 'public, max-age=86400' } });
  }
  if (!apiKey) return errorResponse(503, 'Live solar production data is temporarily unavailable.');

  try {
    const res = await fetchImpl(buildUpstreamUrl(parsed.query, apiKey), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
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
