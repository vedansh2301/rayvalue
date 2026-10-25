/**
 * Build-time list of PUBLISHED city page URLs for the sitemap. City pages are rendered on
 * demand, so @astrojs/sitemap cannot discover them; astro.config passes this list as
 * `customPages`. Any failure (no env, offline, bad response) returns [] so a build never fails.
 */

import { RESERVED_CITY_SLUGS } from '../utility/pages.ts';

interface Deps {
  url?: string;
  key?: string;
  site?: string;
  fetch?: typeof fetch;
}

export async function getPublishedCityUrls(deps: Deps = {}): Promise<string[]> {
  const url = deps.url ?? process.env.SUPABASE_URL;
  const key = deps.key ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  const site = (deps.site ?? 'https://rayvalue.com').replace(/\/+$/, '');
  if (!url || !key) return [];
  try {
    const u = new URL(`${url.replace(/\/+$/, '')}/rest/v1/cities`);
    u.searchParams.set('select', 'state,slug');
    u.searchParams.set('published', 'is.true');
    u.searchParams.set('order', 'state.asc,slug.asc');
    const res = await (deps.fetch ?? fetch)(u, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return [];
    const out: string[] = [];
    for (const r of rows) {
      const state = (r as { state?: unknown })?.state;
      const slug = (r as { slug?: unknown })?.slug;
      if ((state !== 'FL' && state !== 'CA') || typeof slug !== 'string' || RESERVED_CITY_SLUGS.has(slug) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) continue;
      out.push(`${site}/solar/${state === 'FL' ? 'florida' : 'california'}/${slug}`);
    }
    return out;
  } catch {
    return [];
  }
}
