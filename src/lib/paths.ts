/**
 * The one place that knows RayValue's US URL scheme (/us/<topic>/...). Pages, nav, sitemap, JSON-LD and emails build
 * links with these helpers so no internal link relies on a redirect. Pure functions, no DB or env access.
 */
export type UsState = 'FL' | 'CA';

export const US_BASE = '/us';
export const STATE_SLUG: Record<UsState, string> = { FL: 'florida', CA: 'california' };
export const STATE_BY_SLUG: Record<string, UsState> = { florida: 'FL', california: 'CA' };

const stateSlug = (s: UsState | string): string => STATE_SLUG[s as UsState] ?? s;

/** Solar + battery payback calculator for a state: /us/solar-payback/florida. */
export const calcPath = (state: UsState | string): string => `${US_BASE}/solar-payback/${stateSlug(state)}`;
/** City page: /us/solar-payback/florida/miami. */
export const cityPath = (state: UsState | string, city: string): string => `${calcPath(state)}/${city}`;
/** Utility page: /us/utility/florida/fpl. */
export const utilityPath = (state: UsState | string, slug: string): string => `${US_BASE}/utility/${stateSlug(state)}/${slug}`;
/** Solar tax benefits: hub /us/solar-tax-benefits, or per state /us/solar-tax-benefits/florida. */
export const taxPath = (state?: UsState | string): string => `${US_BASE}/solar-tax-benefits${state ? `/${stateSlug(state)}` : ''}`;

/** Old (pre /us/) paths for the state pages, kept only to build 301 redirects. */
export const legacyCalcPath = (state: UsState | string): string => `/calculator/${stateSlug(state)}`;
export const legacyCityPath = (state: UsState | string, city: string): string => `/solar/${stateSlug(state)}/${city}`;
export const legacyUtilityPath = (state: UsState | string, slug: string): string => `/solar/${stateSlug(state)}/${slug}`;
export const legacyTaxPath = (state?: UsState | string): string => `/solar-tax-benefits${state ? `/${stateSlug(state)}` : ''}`;

/**
 * Explicit one-hop 301 map from every old US path to its /us/ URL (feeds astro.config `redirects`). Utility pages are
 * listed here so they win over the generic city pattern in vercel.json.
 */
export function usRedirects(utilities: readonly { state: UsState; slug: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const st of ['FL', 'CA'] as const) {
    out[legacyCalcPath(st)] = calcPath(st);
    out[legacyTaxPath(st)] = taxPath(st);
  }
  out[legacyTaxPath()] = taxPath();
  for (const u of utilities) out[legacyUtilityPath(u.state, u.slug)] = utilityPath(u.state, u.slug);
  return out;
}
