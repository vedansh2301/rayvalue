/**
 * Which of a country's articles a place page links to: only live, indexable ones (not draft, not noindex), newest first.
 * Pure (the page passes the content-collection entries in), so the selection is unit tested.
 */
import { articlePath } from '../content/paths.ts';

export interface ArticleEntry {
  id: string;
  collection: 'guides' | 'blog';
  data: { title: string; country: string; draft?: boolean | undefined; noindex?: boolean | undefined; updated?: Date | undefined; published?: Date | undefined };
}

export function placeArticleLinks(entries: readonly ArticleEntry[], articleCountry: string, limit = 6): { title: string; href: string }[] {
  const stamp = (e: ArticleEntry): number => (e.data.updated ?? e.data.published ?? new Date(0)).getTime();
  return entries
    .filter((e) => e.data.country === articleCountry && !e.data.draft && !e.data.noindex)
    .sort((a, b) => stamp(b) - stamp(a) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((e) => ({ title: e.data.title, href: articlePath(e.collection, e.id, undefined, e.data.country) }));
}
