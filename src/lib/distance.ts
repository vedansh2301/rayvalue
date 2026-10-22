/**
 * Distance helpers with no data imports, so client code can use them without pulling
 * in the ZIP tables (geo.ts re-exports them for existing callers).
 */
import type { City, State } from '../data/schemas';

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
