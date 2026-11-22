import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { countryAnchor, groupByCountry, type IndexArticle } from './global-index';

const art = (o: Partial<IndexArticle> & { id: string; country: string }): IndexArticle => ({ lang: 'en', title: o.id, description: 'd', updated: new Date('2026-01-01'), ...o });

describe('groupByCountry', () => {
  const list = [
    art({ id: 'gb/a', country: 'gb', updated: new Date('2026-02-01') }),
    art({ id: 'gb/b', country: 'gb', updated: new Date('2026-03-01') }),
    art({ id: 'de/a', country: 'de', lang: 'de-DE' }),
    art({ id: 'us-guide', country: 'us', route: '/us/solar-tax-benefits' }),
    art({ id: 'au/x', country: 'au', draft: true }),
    art({ id: 'fr/x', country: 'fr', noindex: true }),
  ];
  it('puts the US first, then countries by name, newest first, and drops drafts and noindex', () => {
    const g = groupByCountry('guides', list);
    expect(g.map((x) => x.segment)).toEqual(['us', 'de', 'uk']);
    expect(g[2]!.items.map((i) => i.slug)).toEqual(['b', 'a']);
  });
  it('keeps US article URLs (route or /guides/<id>) and per-country paths for the rest', () => {
    const g = groupByCountry('guides', [...list, art({ id: 'plain', country: 'us' })]);
    expect(g[0]!.items.map((i) => i.href).sort()).toEqual(['/guides/plain', '/us/solar-tax-benefits']);
    expect(g[1]!.items[0]!.href).toBe('/de/guides/a');
    expect(g[2]!.indexHref).toBe('/uk/guides');
    expect(groupByCountry('blog', list)[0]!.indexHref).toBe('/blog');
  });
  it('anchors are the hyphenated English country name', () => {
    expect(countryAnchor('us')).toBe('united-states');
    expect(countryAnchor('uk')).toBe('united-kingdom');
    expect(countryAnchor('za')).toBe('south-africa');
  });
});

describe('global index pages', () => {
  const src = (f: string) => readFileSync(f, 'utf8');
  it('global index components carry no US-only copy, quote CTA or inline style attributes (hashed CSP)', () => {
    for (const f of ['./src/pages/guides/index.astro', './src/pages/blog/index.astro', './src/components/content/GuidesIndex.astro', './src/components/content/BlogIndex.astro']) {
      const s = src(f);
      expect(s, f).not.toMatch(/\/quotes|Get quotes|Florida and California/);
      expect(s, f).not.toMatch(/\sstyle=/);
    }
  });
  it('every live country with content appears in the grouping (against the real content)', () => {
    const rows: IndexArticle[] = [];
    const walk = (dir: string, rel: string) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (d.isDirectory()) walk(`${dir}/${d.name}`, `${rel}${d.name}/`);
        else if (d.name.endsWith('.mdx')) {
          const t = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(`${dir}/${d.name}`, 'utf8'))![1]!;
          rows.push({ id: `${rel}${d.name.replace(/\.mdx$/, '')}`, country: /^country:\s*"?(\w+)/m.exec(t)?.[1] ?? 'us', lang: 'en', title: 't', description: 'd', draft: /^draft:\s*true/m.test(t), noindex: /^noindex:\s*true/m.test(t) });
        }
      }
    };
    walk('./src/content/guides', '');
    const g = groupByCountry('guides', rows);
    expect(g.length).toBeGreaterThan(10);
    expect(g[0]!.segment).toBe('us');
    expect(g.reduce((n, x) => n + x.items.length, 0)).toBe(rows.filter((r) => !r.draft && !r.noindex).length);
  });
});
