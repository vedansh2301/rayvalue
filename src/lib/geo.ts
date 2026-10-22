import caZips from '../data/zips/ca.json';
import flZips from '../data/zips/fl.json';
import type { City, State } from '../data/schemas';

// Raw JSON imports (no Zod) keep the client bundle small. The same files are
// validated by src/data/index.ts (and its tests).
const ZIPS: Record<State, Record<string, readonly [number, number]>> = {
  FL: flZips as unknown as Record<string, [number, number]>,
  CA: caZips as unknown as Record<string, [number, number]>,
};

export interface ZipLocation {
  state: State;
  lat: number;
  lon: number;
}

/** Look up a 5-digit ZIP. Returns null for malformed, unknown or out-of-state ZIPs. */
export function lookupZip(zip: string): ZipLocation | null {
  if (typeof zip !== 'string') return null;
  const z = zip.trim();
  if (!/^\d{5}$/.test(z)) return null;
  for (const state of ['FL', 'CA'] as const) {
    const hit = ZIPS[state][z];
    if (hit) return { state, lat: hit[0], lon: hit[1] };
  }
  return null;
}

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres (haversine). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Anything with a state and coordinates (a City, or a slimmer client-side projection of one). */
export type Locatable = Pick<City, 'state' | 'lat' | 'lon'>;

/**
 * The closest of `cities` in `state` to the given point, or null if none is in that state.
 * The list comes from the database (loadCities) and is passed in, so this stays pure.
 */
export function nearestCity<C extends Locatable>(lat: number, lon: number, state: State, cities: readonly C[]): C | null {
  let best: C | null = null;
  let bestKm = Infinity;
  for (const city of cities) {
    if (city.state !== state) continue;
    const km = haversineKm(lat, lon, city.lat, city.lon);
    if (km < bestKm) {
      bestKm = km;
      best = city;
    }
  }
  return best;
}
