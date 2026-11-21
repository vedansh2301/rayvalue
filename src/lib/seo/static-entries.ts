/**
 * Index entries that need no database: the curated static pages and the guide / blog articles. Pure (the caller reads
 * the content collections and passes plain objects), so the sitemap and llms.txt builders and their tests share it.
 */
import { articlePath } from '../content/paths.ts';
import { taxPath } from '../paths.ts';
import { toDate, maxDate } from './lastmod.ts';
import { COLLECTION_INDEX_PATHS, STATIC_INDEX, countryOf, pageTypeOf, type IndexEntry, type Section } from './site-index.ts';

export interface ArticleInput {
  collection: 'guides' | 'blog';
  id: string;
  route?: string;
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
      const path = articlePath(a.collection, a.id, a.route);
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

/** The curated static pages; /guides and /blog are listed only while their collection has a published entry. */
export function staticEntries(articles: readonly ArticleInput[]): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const [path, meta] of Object.entries(STATIC_INDEX)) {
    const coll = COLLECTION_INDEX_PATHS[path];
    let lastmod: string | null = null;
    if (coll) {
      const live = articles.filter((a) => a.collection === coll && !a.draft);
      if (live.length === 0) continue;
      lastmod = maxDate(...live.filter((a) => !a.noindex).map((a) => toDate(a.updated) ?? toDate(a.published)));
    }
    out.push({ path, country: countryOf(path), type: pageTypeOf(path), section: meta.section, lastmod, title: meta.title, summary: meta.summary });
  }
  return out;
}
