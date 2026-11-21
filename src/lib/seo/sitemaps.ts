/** Turns the indexable entry list into the sitemap index and its child files. Pure. */
import { absoluteUrl, groupBySitemap, SITE_ORIGIN, type IndexEntry } from './site-index.ts';
import { maxDate } from './lastmod.ts';
import { renderSitemapIndex, renderUrlset } from './sitemap-xml.ts';

export const MAX_URLS_PER_SITEMAP = 50000;

export interface RenderedSitemaps {
  index: string;
  files: Map<string, string>;
  /** child file name -> entries, for tests and llms parity */
  groups: Map<string, IndexEntry[]>;
}

/** Only files with at least one URL exist. The index lastmod of a child is the newest URL lastmod in it. */
export function renderSitemaps(entries: readonly IndexEntry[], origin = SITE_ORIGIN): RenderedSitemaps {
  const groups = groupBySitemap(entries);
  const files = new Map<string, string>();
  const children: { loc: string; lastmod: string | null }[] = [];
  for (const [name, list] of groups) {
    if (list.length > MAX_URLS_PER_SITEMAP) throw new Error(`${name} has ${list.length} URLs (limit ${MAX_URLS_PER_SITEMAP}); split it`);
    files.set(name, renderUrlset(list.map((e) => ({ loc: absoluteUrl(e.path, origin), lastmod: e.lastmod }))));
    children.push({ loc: `${origin}/${name}`, lastmod: maxDate(...list.map((e) => e.lastmod)) });
  }
  return { index: renderSitemapIndex(children), files, groups };
}
