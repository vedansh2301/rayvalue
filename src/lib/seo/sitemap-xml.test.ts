import { describe, expect, it } from 'vitest';
import { parseSitemapEntries, renderSitemapXml, sitemapRank } from './sitemap-xml';

describe('sitemapRank', () => {
  it('ranks page types', () => {
    expect(sitemapRank('/')).toEqual({ changefreq: 'daily', priority: '1.0' });
    expect(sitemapRank('/calculator/florida').priority).toBe('0.9');
    expect(sitemapRank('/solar/florida/fpl').priority).toBe('0.9');
    expect(sitemapRank('/blog')).toEqual({ changefreq: 'weekly', priority: '0.8' });
    expect(sitemapRank('/blog/x')).toEqual({ changefreq: 'monthly', priority: '0.8' });
    expect(sitemapRank('/methodology')).toEqual({ changefreq: 'monthly', priority: '0.5' });
  });
});

describe('renderSitemapXml', () => {
  const src =
    '<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>https://rayvalue.com/methodology</loc></url>' +
    '<url><loc>https://rayvalue.com/blog/a</loc><lastmod>2026-10-25T00:00:00.000Z</lastmod></url>' +
    '<url><loc>https://rayvalue.com/</loc></url><url><loc>https://rayvalue.com/</loc></url></urlset>';

  it('parses entries and keeps real lastmod only', () => {
    expect(parseSitemapEntries(src)).toEqual([
      { loc: 'https://rayvalue.com/methodology' },
      { loc: 'https://rayvalue.com/blog/a', lastmod: '2026-10-25T00:00:00.000Z' },
      { loc: 'https://rayvalue.com/' },
      { loc: 'https://rayvalue.com/' },
    ]);
  });

  it('writes one indented urlset, deduped, highest priority first', () => {
    const xml = renderSitemapXml(parseSitemapEntries(src));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')).toBe(true);
    expect(xml.match(/<loc>/g)).toHaveLength(3);
    expect(xml.indexOf('rayvalue.com/</loc>')).toBeLessThan(xml.indexOf('/blog/a'));
    expect(xml.indexOf('/blog/a')).toBeLessThan(xml.indexOf('/methodology'));
    expect(xml).toContain('    <lastmod>2026-10-25</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>');
    expect(xml.split('<lastmod>')).toHaveLength(2);
  });
});
