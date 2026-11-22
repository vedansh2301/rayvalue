import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { DEADLINE_GUIDES, REGIONS, REGION_BY_SEGMENT, buildCountryCards, cardCounts, deadlineLinks, groupByRegion, latestGuideLinks, liveCalculators, type HomeArticle } from './global-home';

const art = (o: Partial<HomeArticle> & { id: string; country: string }): HomeArticle => ({ collection: 'guides', lang: 'en', title: o.id, description: 'd', updated: new Date('2026-01-01'), noindex: false, ...o });
const many = (cc: string, n: number, lang = 'en-GB'): HomeArticle[] => Array.from({ length: n }, (_, i) => art({ id: `${cc}/a${i}`, country: cc, lang }));

describe('buildCountryCards', () => {
  it('lists only countries with an indexable hub (>= 3 items) and computes real counts', () => {
    const cards = buildCountryCards([...many('gb', 3), ...many('de', 2, 'de-DE'), art({ id: 'gb/b1', country: 'gb', collection: 'blog' })]);
    expect(cards.map((c) => c.segment)).toEqual(['uk']);
    expect(cards[0]).toMatchObject({ guides: 3, blog: 1, href: '/uk', name: 'United Kingdom', region: 'Europe', localName: null });
  });
  it('place hubs count toward the hub rule and place pages are shown', () => {
    const cards = buildCountryCards(many('de', 2, 'de-DE'), { de: { places: 40, hubs: 1 } });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ places: 40, guides: 2 });
  });
  it('ignores drafts and noindex entries', () => {
    const list = [...many('fr', 3, 'fr-FR'), art({ id: 'fr/x', country: 'fr', draft: true }), art({ id: 'fr/y', country: 'fr', noindex: true })];
    expect(buildCountryCards(list)[0]!.guides).toBe(3);
  });
  it('gives a local name in the content language', () => {
    const c = buildCountryCards(many('de', 3, 'de-DE'))[0]!;
    expect(c).toMatchObject({ name: 'Germany', localName: 'Deutschland', localLang: 'de' });
  });
  it('keeps the US card (hub /us) with its own counts and place count', () => {
    const c = buildCountryCards(many('us', 2, 'en-US'), {}, { places: 7 }).find((x) => x.segment === 'us')!;
    expect(c).toMatchObject({ href: '/us', guides: 2, places: 7, region: 'Americas' });
  });
  it('sorts by English name', () => {
    const names = buildCountryCards([...many('de', 3), ...many('au', 3), ...many('gb', 3)]).map((c) => c.name);
    expect(names).toEqual([...names].sort());
  });
});

describe('groupByRegion and cardCounts', () => {
  it('groups in fixed region order and drops empty regions', () => {
    const g = groupByRegion(buildCountryCards([...many('au', 3, 'en-AU'), ...many('de', 3, 'de-DE'), ...many('za', 3, 'en-ZA')]));
    expect(g.map((x) => x.region)).toEqual(['Europe', 'Asia-Pacific', 'Africa & Middle East']);
  });
  it('formats counts and omits zeros', () => {
    expect(cardCounts({ guides: 1, blog: 0, places: 0 })).toBe('1 guide');
    expect(cardCounts({ guides: 12, blog: 2, places: 31 })).toBe('12 guides · 2 posts · 31 places');
  });
});

describe('deadlines and latest', () => {
  it('uses the article frontmatter title and path; skips noindex', () => {
    const list = [art({ id: 'gb/solar-panels-vat-deadline-2027', country: 'gb', title: 'VAT title' }), art({ id: 'nl/einde-salderingsregeling-1-januari-2027', country: 'nl', noindex: true })];
    expect(deadlineLinks(list)).toEqual([expect.objectContaining({ href: '/uk/guides/solar-panels-vat-deadline-2027', title: 'VAT title', countryName: 'United Kingdom' })]);
  });
  it('resolves the US deadline guide', () => {
    const d = deadlineLinks([art({ id: 'california-solar-property-tax-exclusion-ends-2027', country: 'us' })]);
    expect(d[0]!.href).toBe('/guides/california-solar-property-tax-exclusion-ends-2027');
  });
  it('latest guides: newest first, one per country, guides only', () => {
    const l = latestGuideLinks([
      art({ id: 'gb/a', country: 'gb', updated: new Date('2026-05-01') }), art({ id: 'gb/b', country: 'gb', updated: new Date('2026-06-01') }),
      art({ id: 'de/a', country: 'de', updated: new Date('2026-04-01') }), art({ id: 'fr/a', country: 'fr', updated: new Date('2026-03-01'), collection: 'blog' }),
    ], 5);
    expect(l.map((x) => x.href)).toEqual(['/uk/guides/b', '/de/guides/a']);
  });
});

describe('liveCalculators', () => {
  it('lists the two US state calculators and the UK, German and Australian ones', () => {
    expect(liveCalculators().map((c) => c.href)).toEqual(['/us/solar-payback/florida', '/us/solar-payback/california', '/uk/solar-calculator', '/de/photovoltaik-rechner', '/au/solar-battery-calculator']);
  });
});

describe('global home page source', () => {
  const src = readFileSync('./src/pages/index.astro', 'utf8');
  it('has no US-only quote CTA, no inline style or script, no em dash', () => {
    expect(src).not.toMatch(/\/quotes|Get quotes|get installer quotes/i);
    expect(src).not.toMatch(/\sstyle=|<script/);
    expect(src).not.toMatch(/—|&mdash;/);
  });
  it('does not present the federal credit as available', () => {
    expect(src).not.toMatch(/25D|tax credit/i);
  });
});

describe('against the real content', () => {
  const fm = (f: string) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(f, 'utf8'))![1]!;
  const rows: { collection: 'guides' | 'blog'; id: string; t: string }[] = [];
  for (const collection of ['guides', 'blog'] as const) {
    const walk = (dir: string, rel: string) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (d.isDirectory()) walk(`${dir}/${d.name}`, `${rel}${d.name}/`);
        else if (d.name.endsWith('.mdx')) rows.push({ collection, id: `${rel}${d.name.replace(/\.mdx$/, '')}`, t: fm(`${dir}/${d.name}`) });
      }
    };
    walk(`./src/content/${collection}`, '');
  }
  const articles: HomeArticle[] = rows
    .filter((r) => !/^draft:\s*true/m.test(r.t) && /^noindex:\s*false/m.test(r.t))
    .map((r) => ({ collection: r.collection, id: r.id, country: /^country:\s*"?(\w+)/m.exec(r.t)?.[1] ?? 'us', lang: /^lang:\s*"?([\w-]+)/m.exec(r.t)?.[1] ?? 'en-US', title: /^title:\s*"?(.*?)"?$/m.exec(r.t)![1]!, description: '', noindex: false }));
  it('every country card has a region and region values are known', () => {
    for (const c of buildCountryCards(articles)) expect(c.region, c.segment).not.toBeNull();
    expect(Object.values(REGION_BY_SEGMENT).every((r) => (REGIONS as readonly string[]).includes(r))).toBe(true);
  });
  it('every editorial deadline guide exists and is live', () => {
    expect(deadlineLinks(articles)).toHaveLength(DEADLINE_GUIDES.length);
  });
  it('card counts equal the live files of that country', () => {
    for (const c of buildCountryCards(articles)) {
      const mine = articles.filter((a) => (a.country === 'gb' ? 'uk' : a.country) === c.segment);
      expect(c.guides, c.segment).toBe(mine.filter((a) => a.collection === 'guides').length);
      expect(c.blog, c.segment).toBe(mine.filter((a) => a.collection === 'blog').length);
    }
  });
});
