/** Astro-only loader for the footer's "Solar by country and city" block. Cached 10 minutes; any failure just shortens the block. */
import { getCollection } from 'astro:content';
import { publishedCityLinks } from './seo/city-links';
import { loadPlaceIndexEntries } from './places/index-entries';
import { utilityPagePath, UTILITY_PAGES } from './utility/pages';
import { footerSeoGroups, type FooterGroup } from './footer-links';

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; groups: Promise<FooterGroup[]> } | null = null;

export function loadFooterGroups(now = Date.now()): Promise<FooterGroup[]> {
  if (!cache || now - cache.at > TTL_MS) {
    const groups = (async () => {
      const [places, guides, cities] = await Promise.all([loadPlaceIndexEntries(), getCollection('guides', (e) => !e.data.draft && !e.data.noindex), publishedCityLinks()]);
      return footerSeoGroups({
        places: places.ok ? places.value : [],
        guides: guides.map((e) => ({ id: e.id, route: e.data.route, country: e.data.country, lang: e.data.lang, title: e.data.title })),
        usCities: cities.map((c) => ({ href: c.href, name: c.name, state: c.state })),
        usUtilities: UTILITY_PAGES.map((p) => ({ href: utilityPagePath(p), label: p.short })),
      });
    })().catch(() => [] as FooterGroup[]);
    cache = { at: now, groups };
  }
  return cache.groups;
}
