/**
 * Client-side ZIP validation that loads only the page's state ZIP table, lazily.
 * Same semantics as lookupZip (src/lib/geo.ts) for the page's state: a 5-digit ZIP found
 * in the state's Census ZCTA table. A ZIP whose 3-digit prefix belongs to the other state
 * is reported as other_state (from the small prefix spec in _meta.json, so the other
 * state's table is never downloaded).
 */
import zipMeta from '../../data/zips/_meta.json';
import type { State } from '../../data/schemas';

/** ZIP -> [lat, lon]. */
export type ZipTable = Readonly<Record<string, readonly [number, number]>>;

export type ZipCheck =
  | { ok: true; location: { state: State; lat: number; lon: number } }
  | { ok: false; error: 'format' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'other_state'; otherState: State };

/** "320-339, 341, 342" -> predicate on a 3-digit prefix string. */
export function prefixMatcher(spec: string): (prefix3: string) => boolean {
  const parts = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const [a, b] = p.split('-').map((x) => x.trim());
      return { from: a!, to: b ?? a! };
    });
  // 3-digit strings compare correctly as strings.
  return (prefix3) => parts.some((r) => prefix3 >= r.from && prefix3 <= r.to);
}

const PREFIXES: Record<State, (p: string) => boolean> = {
  FL: prefixMatcher(zipMeta.fl_prefixes),
  CA: prefixMatcher(zipMeta.ca_prefixes),
};

/** The state a ZIP's prefix is assigned to, or null. */
export function stateByPrefix(zip: string): State | null {
  const p = zip.slice(0, 3);
  return PREFIXES.FL(p) ? 'FL' : PREFIXES.CA(p) ? 'CA' : null;
}

/** Pure check against an already loaded table for `pageState`. */
export function checkZipIn(raw: string, pageState: State, table: ZipTable): ZipCheck {
  const zip = raw.trim();
  if (!/^\d{5}$/.test(zip)) return { ok: false, error: 'format' };
  const hit = Object.prototype.hasOwnProperty.call(table, zip) ? table[zip] : undefined;
  if (hit) return { ok: true, location: { state: pageState, lat: hit[0], lon: hit[1] } };
  const other = stateByPrefix(zip);
  if (other && other !== pageState) return { ok: false, error: 'other_state', otherState: other };
  return { ok: false, error: 'not_found' };
}

const LOADERS: Record<State, () => Promise<{ default: unknown }>> = {
  FL: () => import('../../data/zips/fl.json'),
  CA: () => import('../../data/zips/ca.json'),
};
const cache = new Map<State, Promise<ZipTable>>();

/** Load (once) the ZIP table for one state. A failed load is not cached, so a retry can succeed. */
export function loadZipTable(state: State): Promise<ZipTable> {
  let p = cache.get(state);
  if (!p) {
    p = LOADERS[state]().then((m) => m.default as ZipTable);
    p.catch(() => cache.delete(state));
    cache.set(state, p);
  }
  return p;
}
