/**
 * Which licensed photo goes behind each slide (pure, deterministic). Florida posts open, answer and close on Florida
 * rooftops, California posts on California ones; generic photos fill the other data slides. The start point in each
 * pool rotates with a hash of the post's seed (template + target), so FPL, Duke and TECO posts don't look identical,
 * and no photo repeats within a post while the pools last (so adjacent slides never share one).
 */
import type { PhotoKey } from './photos';

/** What a slide is about, which decides the photo it prefers. */
export type PhotoRole = 'hook' | 'cost' | 'savings' | 'payback' | 'battery' | 'changed' | 'moves' | 'cta';

const STATE_PHOTOS: Record<'FL' | 'CA', readonly PhotoKey[]> = {
  FL: ['fl-broward-roof', 'fl-rooftop-1', 'fl-rooftop-2', 'fl-rooftop-3', 'fl-panels-sunrise', 'fl-broward-array'],
  CA: ['ca-tile-roof', 'ca-rooftop-install', 'ca-battery-home', 'ca-net-billing'],
};

/** Generic photos a data slide prefers, best fit first; the state's own photos follow as a fallback. */
const ROLE_PHOTOS: Record<'cost' | 'savings' | 'changed' | 'moves', readonly PhotoKey[]> = {
  cost: ['install-crew', 'compare-quotes', 'lease-vs-buy'],
  savings: ['worth-it', 'rooftop-wide', 'home-value', 'home-suburban'],
  changed: ['power-lines-sunset', 'roof-sky', 'rooftop-wide'],
  moves: ['compare-quotes', 'lease-vs-buy', 'home-patio', 'home-value'],
};

/** FNV-1a: a small, stable string hash (same seed -> same photos on every run). */
export function seedHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const rotate = <T>(list: readonly T[], by: number): T[] => {
  const k = list.length ? by % list.length : 0;
  return [...list.slice(k), ...list.slice(0, k)];
};

/** One photo per role, in order. */
export function assignPhotos(state: 'FL' | 'CA', seed: string, roles: readonly PhotoRole[]): PhotoKey[] {
  const h = seedHash(seed);
  const statePool = rotate(STATE_PHOTOS[state], h);
  const used = new Set<PhotoKey>();
  const out: PhotoKey[] = [];
  for (const role of roles) {
    const prev = out[out.length - 1];
    let prefs: PhotoKey[];
    if (role === 'hook' || role === 'cta') prefs = statePool;
    else if (role === 'payback') prefs = [...statePool, 'home-value', 'worth-it'];
    else if (role === 'battery') prefs = [...(state === 'CA' ? (['ca-battery-home'] as const) : []), 'home-battery', ...statePool];
    else prefs = [...rotate(ROLE_PHOTOS[role], h >>> 8), ...statePool];
    // An unused photo when there is one; otherwise anything but the previous slide's.
    const pick = prefs.find((p) => !used.has(p)) ?? prefs.find((p) => p !== prev) ?? prefs[0]!;
    used.add(pick);
    out.push(pick);
  }
  return out;
}
