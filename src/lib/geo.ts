import caZips from '../data/zips/ca.json';
import flZips from '../data/zips/fl.json';
import type { State } from '../data/schemas';

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

/**
 * Look up a 5-digit ZIP in both states' tables. Returns null for malformed, unknown or out-of-state ZIPs.
 * Imports BOTH tables: use it server-side / in tests. The island resolves ZIPs per state (calculator/zip.ts).
 */
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

export { haversineKm, nearestCity, type Locatable } from './distance';
