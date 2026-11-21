/**
 * Index entries that need no database: the curated static pages and the guide / blog articles. Pure (the caller reads
 * the content collections and passes plain objects), so the sitemap and llms.txt builders and their tests share it.
 */
import { articleIndexPath, articlePath, countrySegment } from '../content/paths.ts';
import { taxPath } from '../paths.ts';
import { toDate, maxDate } from './lastmod.ts';
import { COLLECTION_INDEX_PATHS, STATIC_INDEX, countryOf, pageTypeOf, type IndexEntry, type Section } from './site-index.ts';

export interface ArticleInput {
  collection: 'guides' | 'blog';
  id: string;
  route?: string;
  /** ISO2 lowercase; default 'us'. */
  country?: string;
  title: string;
  seoTitle?: string;
  description: string;
  published?: Date | string | null;
  updated?: Date | string | null;
  draft?: boolean;
  /** Guides default to noindex until the owner publishes them. */
  noindex?: boolean;
}

/** Articles that are live and indexable (drafts and noindex entries never appear). */
export function articleEntries(articles: readonly ArticleInput[]): IndexEntry[] {
  return articles
    .filter((a) => !a.draft && !a.noindex)
    .map((a): IndexEntry => {
      const path = articlePath(a.collection, a.id, a.route, a.country);
      const tax = path === taxPath() || path.startsWith(`${taxPath()}/`);
      const section: Section = tax ? 'tax' : a.collection;
      return {
        path,
        country: countryOf(path),
        type: pageTypeOf(path),
        section,
        lastmod: maxDate(toDate(a.updated), a.updated ? null : toDate(a.published)),
        title: a.seoTitle ?? a.title,
        summary: a.description,
      };
    });
}

/** One /<cc>/guides or /<cc>/blog index per non-US country that has at least one indexable article of that collection. */
function intlIndexEntries(articles: readonly ArticleInput[]): IndexEntry[] {
  const out: IndexEntry[] = [];
  const seen = new Set<string>();
  for (const a of articles) {
    const cc = (a.country ?? 'us').toLowerCase();
    if (cc === 'us' || a.draft || a.noindex) continue;
    const path = articleIndexPath(a.collection, cc);
    if (seen.has(path)) continue;
    seen.add(path);
    const live = articles.filter((x) => x.collection === a.collection && (x.country ?? 'us').toLowerCase() === cc && !x.draft && !x.noindex);
    const label = a.collection === 'guides' ? 'Guides' : 'Blog';
    out.push({ path, country: countrySegment(cc), type: 'articles', section: a.collection, lastmod: maxDate(...live.map((x) => toDate(x.updated) ?? toDate(x.published))), title: `${label} (${countrySegment(cc).toUpperCase()})`, summary: `RayValue ${label.toLowerCase()} for readers in ${countrySegment(cc).toUpperCase()}.` });
  }
  return out;
}

/** The curated static pages; /guides and /blog are listed only while their collection has a published entry. */
export function staticEntries(articles: readonly ArticleInput[]): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const [path, meta] of Object.entries(STATIC_INDEX)) {
    const coll = COLLECTION_INDEX_PATHS[path];
    let lastmod: string | null = null;
    if (coll) {
      const live = articles.filter((a) => a.collection === coll && !a.draft && (a.country ?? 'us') === 'us');
      if (live.length === 0) continue;
      lastmod = maxDate(...live.filter((a) => !a.noindex).map((a) => toDate(a.updated) ?? toDate(a.published)));
    }
    out.push({ path, country: countryOf(path), type: pageTypeOf(path), section: meta.section, lastmod, title: meta.title, summary: meta.summary });
  }
  return [...out, ...intlIndexEntries(articles)];
}
