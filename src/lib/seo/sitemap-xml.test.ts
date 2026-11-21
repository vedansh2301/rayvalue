import { describe, expect, it } from 'vitest';
import { renderSitemapIndex, renderUrlset } from './sitemap-xml';

describe('renderUrlset', () => {
  it('escapes, dedupes, writes lastmod only when present, and has no changefreq/priority', () => {
    const xml = renderUrlset([
      { loc: 'https://rayvalue.com/a?x=1&y=2', lastmod: '2026-10-25T00:00:00.000Z' },
      { loc: 'https://rayvalue.com/b' },
      { loc: 'https://rayvalue.com/b' },
    ]);
    expect(xml).toContain('<loc>https://rayvalue.com/a?x=1&amp;y=2</loc>');
    expect(xml).toContain('<lastmod>2026-10-25</lastmod>');
    expect(xml.match(/<url>/g)).toHaveLength(2);
    expect(xml.match(/<lastmod>/g)).toHaveLength(1);
    expect(xml).not.toMatch(/changefreq|priority/);
  });
});

describe('renderSitemapIndex', () => {
  it('lists children with lastmod', () => {
    const xml = renderSitemapIndex([{ loc: 'https://rayvalue.com/sitemap-us-cities.xml', lastmod: '2026-11-01' }, { loc: 'https://rayvalue.com/sitemap-global-pages.xml' }]);
    expect(xml).toContain('<sitemapindex');
    expect(xml.match(/<sitemap>/g)).toHaveLength(2);
    expect(xml).toContain('<lastmod>2026-11-01</lastmod>');
  });
});
