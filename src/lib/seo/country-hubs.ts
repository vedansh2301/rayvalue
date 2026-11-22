/**
 * Country home hubs (/uk, /de, ...) as index entries. A hub is listed only when it is indexable (>= HUB_MIN_ITEMS published
 * items), the same rule the page uses for noindex, so the sitemap can never hold a noindex URL. Pure.
 */
import { countrySegment } from '../content/paths.ts';
import { countryName, hubIndexable, hubItemCount, hubPath } from '../content/country-nav.ts';
import { maxDate, toDate } from './lastmod.ts';
import type { ArticleInput } from './static-entries.ts';
import type { IndexEntry } from './site-index.ts';

export function countryHubEntries(articles: readonly ArticleInput[], placeEntries: readonly IndexEntry[] = []): IndexEntry[] {
  const live = articles.filter((a) => !a.draft && !a.noindex && (a.country ?? 'us').toLowerCase() !== 'us');
  const segs = [...new Set(live.map((a) => countrySegment(a.country!)))].sort();
  const out: IndexEntry[] = [];
  for (const seg of segs) {
    const mine = live.filter((a) => countrySegment(a.country!) === seg);
    const hubs = placeEntries.filter((e) => e.country === seg && e.type === 'places' && e.placeKind === 'hub');
    const count = hubItemCount({ guides: mine.filter((a) => a.collection === 'guides').length, blog: mine.filter((a) => a.collection === 'blog').length, placeHubs: hubs.length });
    if (!hubIndexable(count)) continue;
    const name = countryName(seg);
    out.push({
      path: hubPath(seg),
      country: seg,
      type: 'pages',
      section: 'home',
      lastmod: maxDate(...mine.map((a) => toDate(a.updated) ?? toDate(a.published)), ...hubs.map((h) => h.lastmod)),
      title: `RayValue: ${name}`,
      summary: `Solar and home-battery guides, blog posts and local data for readers in ${name}.`,
    });
  }
  return out;
}
