/**
 * Client-side solar production lookup: live PVWatts via /api/pvwatts, falling back to the
 * precomputed nearest-city value (rows loaded from the DB and passed in as props).
 */
import type { State } from '../../data/schemas';
import type { ProductionInput } from '../calc/types';
import { nearestCity } from '../geo';

export const PVWATTS_TIMEOUT_MS = 6000;

/** Slim city shape the page sends to the browser. */
export interface FallbackCity {
  state: State;
  slug: string;
  name: string;
  lat: number;
  lon: number;
}

/** Slim precomputed production row the page sends to the browser. */
export interface FallbackProduction extends ProductionInput {
  slug: string;
  losses: number;
}

/** Canonical 2-decimal coordinate string (same rule as the endpoint, so no 308 redirect). */
export function coord2(n: number): string {
  const s = n.toFixed(2);
  return s === '-0.00' ? '0.00' : s;
}

/** /api/pvwatts URL with params in the endpoint's canonical order: lat, lon, losses. */
export function pvwattsUrl(lat: number, lon: number, losses: number): string {
  return `/api/pvwatts?lat=${coord2(lat)}&lon=${coord2(lon)}&losses=${String(losses)}`;
}

/** Validate the endpoint's JSON body; null if it is not a usable production record. */
export function parsePvwattsBody(json: unknown): ProductionInput | null {
  const j = json as { annual_kwh_per_kw?: unknown; monthly_kwh_per_kw?: unknown } | null;
  if (!j || typeof j !== 'object') return null;
  const annual = j.annual_kwh_per_kw;
  const monthly = j.monthly_kwh_per_kw;
  if (typeof annual !== 'number' || !Number.isFinite(annual) || annual <= 0) return null;
  if (!Array.isArray(monthly) || monthly.length !== 12 || !monthly.every((m) => typeof m === 'number' && Number.isFinite(m) && m >= 0)) return null;
  return { annualKwhPerKw: annual, monthlyKwhPerKw: monthly as number[] };
}

/** Live production, or null on any error / non-200 / bad body / timeout. Never throws. */
export async function fetchLiveProduction(
  lat: number,
  lon: number,
  losses: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PVWATTS_TIMEOUT_MS,
): Promise<ProductionInput | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(pvwattsUrl(lat, lon, losses), { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return parsePvwattsBody(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Precomputed production of the nearest city (in `state`) that has a row at `losses`. */
export function fallbackProduction(
  lat: number,
  lon: number,
  state: State,
  losses: number,
  cities: readonly FallbackCity[],
  rows: readonly FallbackProduction[],
): { production: ProductionInput; city: FallbackCity } | null {
  const bySlug = new Map(rows.filter((r) => r.losses === losses).map((r) => [r.slug, r]));
  const city = nearestCity(lat, lon, state, cities.filter((c) => bySlug.has(c.slug)));
  if (!city) return null;
  const row = bySlug.get(city.slug)!;
  const production: ProductionInput = row.monthlyKwhPerKw
    ? { annualKwhPerKw: row.annualKwhPerKw, monthlyKwhPerKw: row.monthlyKwhPerKw }
    : { annualKwhPerKw: row.annualKwhPerKw };
  return { production, city };
}

export type ProductionLookup =
  | { ok: true; source: 'live'; production: ProductionInput }
  | { ok: true; source: 'fallback'; production: ProductionInput; cityName: string }
  | { ok: false };

/** Live first; on failure the nearest-city fallback; ok:false if neither is available. */
export async function getProduction(
  args: { lat: number; lon: number; state: State; losses: number; cities: readonly FallbackCity[]; rows: readonly FallbackProduction[] },
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PVWATTS_TIMEOUT_MS,
): Promise<ProductionLookup> {
  const live = await fetchLiveProduction(args.lat, args.lon, args.losses, fetchImpl, timeoutMs);
  if (live) return { ok: true, source: 'live', production: live };
  const fb = fallbackProduction(args.lat, args.lon, args.state, args.losses, args.cities, args.rows);
  if (fb) return { ok: true, source: 'fallback', production: fb.production, cityName: fb.city.name };
  return { ok: false };
}
