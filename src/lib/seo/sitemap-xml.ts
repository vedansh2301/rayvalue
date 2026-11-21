/** Sitemap XML rendering (urlset and sitemapindex). No changefreq/priority: search engines ignore both. */

export interface SitemapUrl {
  loc: string;
  lastmod?: string | null;
}

export const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

const item = (tag: 'url' | 'sitemap', e: SitemapUrl): string =>
  [`  <${tag}>`, `    <loc>${escapeXml(e.loc)}</loc>`, ...(e.lastmod ? [`    <lastmod>${e.lastmod.slice(0, 10)}</lastmod>`] : []), `  </${tag}>`].join('\n');

/** One <urlset>; duplicates dropped, input order kept. */
export function renderUrlset(entries: readonly SitemapUrl[]): string {
  const seen = new Set<string>();
  const rows = entries.filter((e) => (seen.has(e.loc) ? false : (seen.add(e.loc), true))).map((e) => item('url', e));
  return `${HEAD}<urlset ${NS}>\n${rows.join('\n')}\n</urlset>\n`;
}

/** A <sitemapindex> of child sitemap files (children are never nested indexes). */
export function renderSitemapIndex(children: readonly SitemapUrl[]): string {
  return `${HEAD}<sitemapindex ${NS}>\n${children.map((e) => item('sitemap', e)).join('\n')}\n</sitemapindex>\n`;
}
