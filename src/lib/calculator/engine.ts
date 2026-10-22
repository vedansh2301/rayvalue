/**
 * Everything the island needs only when it runs an estimate: the calc engine (which pulls in
 * src/lib/geo.ts and its ZIP tables) and the nearest-city production fallback. The island
 * loads this module with a dynamic import(), so it is not part of the initial island chunk.
 */
import type { State } from '../../data/schemas';
import type { ProductionInput } from '../calc/types';
import { nearestCity } from '../geo';
import { fetchLiveProduction, PVWATTS_TIMEOUT_MS, type FallbackCity, type FallbackProduction } from './production';

export { calculate, lossesForShading } from '../calc';

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

/** Live first; on failure the nearest-city fallback; ok:false if neither is available or the request was aborted. */
export async function getProduction(
  args: { lat: number; lon: number; state: State; losses: number; cities: readonly FallbackCity[]; rows: readonly FallbackProduction[] },
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PVWATTS_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<ProductionLookup> {
  const live = await fetchLiveProduction(args.lat, args.lon, args.losses, fetchImpl, timeoutMs, signal);
  if (signal?.aborted) return { ok: false };
  if (live) return { ok: true, source: 'live', production: live };
  const fb = fallbackProduction(args.lat, args.lon, args.state, args.losses, args.cities, args.rows);
  if (fb) return { ok: true, source: 'fallback', production: fb.production, cityName: fb.city.name };
  return { ok: false };
}
