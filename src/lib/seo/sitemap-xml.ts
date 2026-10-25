/**
 * Single, human-readable /sitemap.xml (one <urlset>, two-space indent) built from the URL list that
 * @astrojs/sitemap already filtered (indexable pages only). Each entry gets changefreq and priority by
 * page type; lastmod is kept only where the source sitemap has a real content date (article `updated`).
 */

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

type Freq = 'daily' | 'weekly' | 'monthly';

/** changefreq + priority for a path (no trailing slash; "/" for home). */
export function sitemapRank(path: string): { changefreq: Freq; priority: string } {
  if (path === '/') return { changefreq: 'daily', priority: '1.0' };
  if (path.startsWith('/calculator/') || path === '/quotes') return { changefreq: 'weekly', priority: '0.9' };
  if (path.startsWith('/solar/')) return { changefreq: 'weekly', priority: '0.9' };
  if (path === '/solar-tax-benefits' || path.startsWith('/solar-tax-benefits/')) return { changefreq: 'weekly', priority: '0.9' };
  if (path === '/guides' || path === '/blog' || path === '/stories') return { changefreq: 'weekly', priority: '0.8' };
  if (path.startsWith('/guides/') || path.startsWith('/blog/')) return { changefreq: 'monthly', priority: '0.8' };
  return { changefreq: 'monthly', priority: '0.5' };
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Parse the <url> entries of a sitemap-N.xml written by @astrojs/sitemap. */
export function parseSitemapEntries(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(m[1]!)?.[1];
    if (!loc) continue;
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(m[1]!)?.[1];
    out.push(lastmod ? { loc, lastmod } : { loc });
  }
  return out;
}

/** Order: home, calculators/quotes, utility and city pages, hubs, articles, everything else; then by URL. */
export function renderSitemapXml(entries: SitemapEntry[]): string {
  const seen = new Set<string>();
  const rows = entries
    .filter((e) => (seen.has(e.loc) ? false : (seen.add(e.loc), true)))
    .map((e) => {
      const path = new URL(e.loc).pathname.replace(/\/+$/, '') || '/';
      return { ...e, ...sitemapRank(path) };
    })
    .sort((a, b) => Number(b.priority) - Number(a.priority) || a.loc.localeCompare(b.loc));
  const body = rows
    .map((r) =>
      [
        '  <url>',
        `    <loc>${escapeXml(r.loc)}</loc>`,
        ...(r.lastmod ? [`    <lastmod>${r.lastmod.slice(0, 10)}</lastmod>`] : []),
        `    <changefreq>${r.changefreq}</changefreq>`,
        `    <priority>${r.priority}</priority>`,
        '  </url>',
      ].join('\n'),
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
