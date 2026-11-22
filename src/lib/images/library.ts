/**
 * The place photo library, pure. Photos live in src/assets/places/<cc>/ and every one is described in
 * src/data/images/credits.json (source page, author, licence, licence URL). Only Unsplash-licence photos and Wikimedia
 * Commons public-domain / CC0 / CC BY / CC BY-SA files are allowed; `validateCredits` enforces it in the tests.
 *
 * Keys are URL segments (GB is "uk"). Scopes: "country" (the country hub and the fallback for everything below it),
 * "state" (US: place = "florida" | "california") and "city" (place = the place slug used in the page URL).
 */
export type PhotoScope = 'country' | 'state' | 'city';
export type PhotoFocus = 'center' | 'top' | 'bottom' | 'left' | 'right';

export interface PhotoCredit {
  id: string;
  scope: PhotoScope;
  country: string;
  place?: string;
  /** Path under src/assets/places/. */
  file: string;
  alt: string;
  focus: PhotoFocus;
  title: string;
  source_url: string;
  author: string;
  license: string;
  license_url: string | null;
  /** CC BY and CC BY-SA need a visible credit next to the photo. */
  attribution_required: boolean;
  width: number;
  height: number;
  verified_on: string;
}

export interface PhotoKey {
  country: string;
  /** City slug, or "florida" / "california" for US state pages. */
  place?: string;
}

/** Tailwind classes written out in full so the build keeps them (no inline styles: the CSP is hashed). */
export const FOCUS_CLASS: Record<PhotoFocus, string> = {
  center: 'object-center',
  top: 'object-top',
  bottom: 'object-bottom',
  left: 'object-left',
  right: 'object-right',
};

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/**
 * The best photo for a page: the exact place (city or US state), else the country. With several candidates at the
 * same level, `seed` (for example an article id) picks one stably so a list does not repeat a single image.
 */
export function pickPhoto<T extends PhotoCredit>(photos: readonly T[], key: PhotoKey, seed?: string): T | null {
  const pick = (list: T[]): T | null => (list.length === 0 ? null : list[seed ? hash(seed) % list.length : 0]!);
  if (key.place) {
    const exact = pick(photos.filter((p) => p.country === key.country && p.place === key.place));
    if (exact) return exact;
  }
  return pick(photos.filter((p) => p.country === key.country && p.scope === 'country'));
}

/** "Photo: Author, CC BY-SA 4.0" (the visible credit line). */
export function creditLine(p: Pick<PhotoCredit, 'author' | 'license'>): string {
  const author = p.author.length > 48 ? `${p.author.slice(0, 45).trimEnd()}...` : p.author;
  return `Photo: ${author}, ${p.license}`;
}

export const needsVisibleCredit = (p: Pick<PhotoCredit, 'attribution_required'>): boolean => p.attribution_required;

const ALLOWED_LICENSE = /^(public domain|cc0|pdm|unsplash license|cc by(-sa)? [0-9.]+)/i;
const FORBIDDEN = /\b(nc|nd|all rights reserved|gfdl)\b/i;

/** Problems in a credits file, as readable strings (empty = valid). Used by the unit tests. */
export function validateCredits(list: readonly PhotoCredit[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const p of list) {
    const at = `[${p.id}]`;
    if (ids.has(p.id)) problems.push(`${at} duplicate id`);
    ids.add(p.id);
    if (!p.source_url?.startsWith('https://')) problems.push(`${at} source_url must be an https URL`);
    if (!p.author?.trim() || p.author === 'Unknown') problems.push(`${at} author missing`);
    if (!ALLOWED_LICENSE.test(p.license) || FORBIDDEN.test(p.license)) problems.push(`${at} licence not allowed: ${p.license}`);
    if (/^cc by/i.test(p.license) && !p.license_url) problems.push(`${at} CC licence needs license_url`);
    if (/^cc by/i.test(p.license) !== p.attribution_required) problems.push(`${at} attribution_required does not match the licence`);
    if (!p.alt?.trim()) problems.push(`${at} alt text missing`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.verified_on)) problems.push(`${at} verified_on missing`);
    if (p.scope !== 'country' && !p.place) problems.push(`${at} place required for scope ${p.scope}`);
    if (!p.file.startsWith(`${p.country}/`)) problems.push(`${at} file should live under ${p.country}/`);
  }
  return problems;
}

/** Photos with a visible-credit requirement first, then by country: the order of the /credits table. */
export function creditsTableOrder<T extends PhotoCredit>(list: readonly T[]): T[] {
  const rank = (p: PhotoCredit) => (p.scope === 'country' ? 0 : p.scope === 'state' ? 1 : 2);
  return [...list].sort((a, b) => a.country.localeCompare(b.country) || rank(a) - rank(b) || (a.place ?? '').localeCompare(b.place ?? ''));
}

/** Licence breakdown for a list of photos: { "CC BY-SA 4.0": 3, ... }. */
export function licenseCounts(list: readonly Pick<PhotoCredit, 'license'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of list) out[p.license] = (out[p.license] ?? 0) + 1;
  return out;
}
