/**
 * Internal links to the PUBLISHED city pages (footer, calculators, guide/blog CTA cards, utility pages). Only cities the
 * owner has published are linked, the same rule as the sitemap, so a noindex page never gets an internal link.
 * Loaded once per build for static pages and cached for 10 minutes in on-demand functions; any failure links nothing.
 */
import { loadCities } from '../db/repo';
import type { City, State } from '../../data/schemas';
import { RESERVED_CITY_SLUGS, STATE_SLUG } from '../utility/pages';

export interface CityLink { state: State; slug: string; name: string; utilityId: string; href: string }

export function cityLinksFrom(cities: readonly City[]): CityLink[] {
  return cities
    .filter((c) => c.published && !RESERVED_CITY_SLUGS.has(c.slug))
    .map((c) => ({ state: c.state, slug: c.slug, name: c.name, utilityId: c.default_utility_id, href: `/solar/${STATE_SLUG[c.state]}/${c.slug}` }))
    .sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
}

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; links: Promise<CityLink[]> } | null = null;

export function publishedCityLinks(now = Date.now()): Promise<CityLink[]> {
  if (!cache || now - cache.at > TTL_MS) {
    const links = loadCities()
      .then((r) => (r.ok ? cityLinksFrom(r.value) : []))
      .catch(() => [] as CityLink[]);
    cache = { at: now, links };
  }
  return cache.links;
}
