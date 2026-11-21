/**
 * Real <lastmod> values: the newest updated_at / verified_on among the database rows a page renders, or the article's
 * `updated` date. Never a build time. Pure functions.
 */

/** ISO timestamp or date -> YYYY-MM-DD (UTC), or null when absent or not a date. */
export function toDate(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Newest of the given dates (nulls ignored); null when none is a date. */
export function maxDate(...vals: (string | Date | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of vals) {
    const d = toDate(v);
    if (d && (best === null || d > best)) best = d;
  }
  return best;
}

/** Row timestamps a page depends on. */
export interface Stamped {
  updated_at?: string | null;
  verified_on?: string | null;
  fetched_on?: string | null;
  avg_rate_verified_on?: string | null;
  export_credit_verified_on?: string | null;
}

export const stampDate = (r: Stamped | null | undefined): string | null =>
  r ? maxDate(r.updated_at, r.verified_on, r.fetched_on, r.avg_rate_verified_on, r.export_credit_verified_on) : null;

export interface UtilityStamps extends Stamped {
  utility_tier_sets?: { updated_at?: string | null; utility_tiers?: { updated_at?: string | null }[] | null }[] | null;
  utility_tou_rates?: { updated_at?: string | null }[] | null;
}

/** A utility row plus its nested tier sets, tiers and TOU rates. */
export function utilityStamp(u: UtilityStamps | null | undefined): string | null {
  if (!u) return null;
  const nested: (string | null | undefined)[] = [];
  for (const s of u.utility_tier_sets ?? []) {
    nested.push(s.updated_at);
    for (const t of s.utility_tiers ?? []) nested.push(t.updated_at);
  }
  for (const t of u.utility_tou_rates ?? []) nested.push(t.updated_at);
  return maxDate(stampDate(u), ...nested);
}

export interface PageRows {
  city?: Stamped | null;
  housing?: Stamped | null;
  production?: (Stamped | null)[];
  utilities?: (UtilityStamps | null | undefined)[];
  costs?: (Stamped | null)[];
  assumptions?: (Stamped | null)[];
  /** Other published cities whose rows feed the page (state calculators). */
  cities?: (Stamped | null)[];
}

/** Newest date across every row a page renders. No rows with dates -> null (the URL is listed without <lastmod>). */
export function pageLastmod(rows: PageRows): string | null {
  return maxDate(
    stampDate(rows.city),
    stampDate(rows.housing),
    ...(rows.production ?? []).map(stampDate),
    ...(rows.utilities ?? []).map(utilityStamp),
    ...(rows.costs ?? []).map(stampDate),
    ...(rows.assumptions ?? []).map(stampDate),
    ...(rows.cities ?? []).map(stampDate),
  );
}
