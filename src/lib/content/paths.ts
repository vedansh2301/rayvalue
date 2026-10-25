/** Public URL of a guide or blog entry: its keyword `route` when set, else /<collection>/<id>. */
export function articlePath(collection: 'guides' | 'blog', id: string, route?: string): string {
  return route ?? `/${collection}/${id}`;
}

/** 301 map from the default path to the keyword route, for entries that set one (feeds astro.config redirects). */
export function routeRedirects(entries: readonly { collection: 'guides' | 'blog'; id: string; route?: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) if (e.route) out[`/${e.collection}/${e.id}`] = e.route;
  return out;
}
