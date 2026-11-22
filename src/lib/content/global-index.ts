/**
 * Data shaping for the global /guides and /blog indexes: every live article of every country, grouped by country.
 * Pure: the pages pass plain objects read from the content collections. Nothing numeric is typed here.
 */
import { articleIndexPath, articlePath, articleSlug, countrySegment } from './paths.ts';
import { US_SEGMENT, countryName } from './country-nav.ts';

export interface IndexArticle {
  id: string;
  route?: string;
  country: string;
  lang: string;
  title: string;
  description: string;
  published?: Date | null;
  updated?: Date | null;
  draft?: boolean;
  noindex?: boolean;
}

export interface IndexItem { href: string; title: string; description: string; lang: string; date: Date | null; slug: string }

export interface CountryGroup {
  segment: string;
  name: string;
  /** In-page anchor id, e.g. "united-states". */
  anchor: string;
  /** The country's own index: /guides (US) or /<seg>/guides. */
  indexHref: string;
  items: IndexItem[];
}

/** Anchor id of a country section: its English name, lowercased and hyphenated. */
export const countryAnchor = (segment: string): string =>
  countryName(segment, 'en').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const segOf = (country: string): string => (country.toLowerCase() === 'us' ? US_SEGMENT : countrySegment(country));
const stamp = (a: IndexArticle): number => (a.updated ?? a.published ?? new Date(0)).getTime();

/**
 * Live (not draft, not noindex) articles grouped by country: the United States first, then the other countries by
 * English name. Within a country, newest first. Countries without live articles do not appear.
 */
export function groupByCountry(collection: 'guides' | 'blog', articles: readonly IndexArticle[]): CountryGroup[] {
  const live = articles.filter((a) => !a.draft && !a.noindex);
  const segs = [...new Set(live.map((a) => segOf(a.country)))];
  const groups = segs.map((segment): CountryGroup => {
    const mine = live.filter((a) => segOf(a.country) === segment).sort((a, b) => stamp(b) - stamp(a) || a.id.localeCompare(b.id));
    return {
      segment,
      name: countryName(segment, 'en'),
      anchor: countryAnchor(segment),
      indexHref: articleIndexPath(collection, segment === US_SEGMENT ? 'us' : segment),
      items: mine.map((a) => ({
        href: articlePath(collection, a.id, a.route, a.country),
        title: a.title,
        description: a.description,
        lang: a.lang,
        date: a.updated ?? a.published ?? null,
        slug: articleSlug(a.id, a.country),
      })),
    };
  });
  return groups.sort((a, b) => (a.segment === US_SEGMENT ? -1 : b.segment === US_SEGMENT ? 1 : a.name.localeCompare(b.name)));
}
