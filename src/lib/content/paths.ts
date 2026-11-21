/** URL segment for an ISO2 country: lowercase, with GB served under /uk/. */
export const countrySegment = (cc: string): string => (cc.toLowerCase() === 'gb' ? 'uk' : cc.toLowerCase());

/** The slug of an entry under src/content/<collection>/<cc>/: the id without its leading "<cc>/" folder. */
export const articleSlug = (id: string, country = 'us'): string =>
  country === 'us' ? id : id.replace(new RegExp(`^${country.toLowerCase()}/`), '');

/**
 * Public URL of a guide or blog entry. US: its keyword `route` when set, else /<collection>/<id>.
 * Non-US: /<cc>/<collection>/<slug> (a `route` is ignored; keyword routes are US-only).
 */
export function articlePath(collection: 'guides' | 'blog', id: string, route?: string, country = 'us'): string {
  if (country.toLowerCase() === 'us') return route ?? `/${collection}/${id}`;
  return `/${countrySegment(country)}/${collection}/${articleSlug(id, country)}`;
}

/** Index page of a collection for a country: /guides, /blog (US) or /<cc>/guides, /<cc>/blog. */
export const articleIndexPath = (collection: 'guides' | 'blog', country = 'us'): string =>
  country.toLowerCase() === 'us' ? `/${collection}` : `/${countrySegment(country)}/${collection}`;

/** 301 map from the default path to the keyword route, for entries that set one (feeds astro.config redirects). */
export function routeRedirects(entries: readonly { collection: 'guides' | 'blog'; id: string; route?: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) if (e.route) out[`/${e.collection}/${e.id}`] = e.route;
  return out;
}
