import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { articleKind, daysLeft, homeDestinations, latestPostLinks, upcomingDeadlines, urgencyPct, topCountries, siteTotals, DEADLINE_GUIDES, REGIONS, REGION_BY_SEGMENT, buildCountryCards, cardChips, cardCounts, deadlineLinks, groupByRegion, latestGuideLinks, liveCalculators, type HomeArticle } from './global-home';

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
    expect(cardCounts({ guides: 12, blog: 2, places: 31 })).toBe('12 guides, 2 posts, 31 places');
  });
});

describe('topCountries and siteTotals', () => {
  const cards = buildCountryCards([...many('de', 5, 'de-DE'), ...many('au', 3, 'en-AU'), ...many('gb', 4)], { au: { places: 10, hubs: 1 } });
  it('ranks by published content and limits', () => {
    expect(topCountries(cards, 2).map((c) => c.segment)).toEqual(['au', 'de']);
  });
  it('sums totals from the cards', () => {
    expect(siteTotals(cards)).toEqual({ countries: 3, guides: 12, posts: 0, places: 10 });
  });
  it('filters deadline guides by country (uk is gb)', () => {
    const list = [art({ id: 'gb/solar-panels-vat-deadline-2027', country: 'gb' }), art({ id: 'au/battery-rebate-changes-2027', country: 'au' })];
    expect(deadlineLinks(list, 'uk').map((d) => d.country)).toEqual(['uk']);
    expect(deadlineLinks(list).length).toBe(2);
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
    // Hashed CSP: no inline style attributes anywhere in the home markup. <script> blocks are Astro-bundled (hashed), but
    // must be plain module scripts: no is:inline.
    for (const f of ['src/pages/index.astro', ...readdirSync('./src/components/home').map((n) => `src/components/home/${n}`)]) {
      const t = readFileSync(`./${f}`, 'utf8');
      expect(t, f).not.toMatch(/\sstyle=|is:inline/);
      expect(t, f).not.toMatch(/—|&mdash;/);
    }
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

describe('cardChips', () => {
  it('US gets both state calculators; countries without a calculator get none; guides chip needs guides', () => {
    const us = cardChips({ segment: 'us', name: 'United States', guides: 3 }, []);
    expect(us.filter((c) => c.kind === 'calc').map((c) => c.href)).toEqual(['/us/solar-payback/florida', '/us/solar-payback/california']);
    expect(us.at(-1)).toMatchObject({ kind: 'guides', href: '/guides' });
    const fr = cardChips({ segment: 'fr', name: 'France', guides: 0 }, []);
    expect(fr).toEqual([]);
    expect(cardChips({ segment: 'uk', name: 'United Kingdom', guides: 2 }, [])[0]).toMatchObject({ kind: 'calc', href: '/uk/solar-calculator' });
  });
  it('adds the nearest live deadline guide', () => {
    const a = art({ id: 'gb/solar-panels-vat-deadline-2027', country: 'gb', title: 'VAT deadline' });
    expect(cardChips({ segment: 'uk', name: 'United Kingdom', guides: 1 }, [a]).some((c) => c.kind === 'deadline' && c.label === 'VAT deadline')).toBe(true);
  });
});

describe('deadline helpers', () => {
  const now = new Date('2026-11-22T15:30:00Z');
  it('counts whole UTC days to the deadline, 0 on the day, null after', () => {
    expect(daysLeft(new Date('2026-12-31'), now)).toBe(39);
    expect(daysLeft(new Date('2026-11-22'), now)).toBe(0);
    expect(daysLeft(new Date('2026-11-21'), now)).toBeNull();
  });
  it('urgency bar stays within 6..100 and grows as the date nears', () => {
    expect(urgencyPct(0)).toBe(100);
    expect(urgencyPct(900)).toBe(6);
    expect(urgencyPct(39)).toBeGreaterThan(urgencyPct(120));
  });
  it('upcomingDeadlines drops undated and past guides and sorts soonest first', () => {
    const arts = [
      art({ id: 'gb/solar-panels-vat-deadline-2027', country: 'gb', deadline: new Date('2027-03-31') }),
      art({ id: 'es/deduccion-irpf-placas-solares-antes-31-diciembre', country: 'es', deadline: new Date('2026-12-31') }),
      art({ id: 'it/detrazione-fotovoltaico-2027', country: 'it' }),
      art({ id: 'nl/einde-salderingsregeling-1-januari-2027', country: 'nl', deadline: new Date('2026-01-01') }),
    ];
    const up = upcomingDeadlines(deadlineLinks(arts), now);
    expect(up.map((d) => d.country)).toEqual(['es', 'uk']);
    expect(up[0]).toMatchObject({ days: 39, kind: 'deadline' });
  });
});

describe('articleKind', () => {
  it('tags deadline guides, battery guides and the rest', () => {
    expect(articleKind(art({ id: 'au/battery-rebate-changes-2027', country: 'au', deadline: new Date('2027-01-01') }))).toBe('deadline');
    expect(articleKind(art({ id: 'au/is-a-solar-battery-worth-it-australia', country: 'au', title: 'Is a solar battery worth it?' }))).toBe('battery');
    expect(articleKind(art({ id: 'fr/x', country: 'fr', title: 'Panneaux solaires' }))).toBe('guide');
  });
});

describe('homeDestinations', () => {
  it('sends countries with a calculator there, others to their hub, and lists the US twice', () => {
    const d = homeDestinations([
      { segment: 'uk', name: 'United Kingdom', href: '/uk' },
      { segment: 'fr', name: 'France', href: '/fr' },
      { segment: 'us', name: 'United States', href: '/us' },
    ]);
    expect(d.map((x) => x.key)).toEqual(['fr', 'uk', 'us-ca', 'us-fl']);
    expect(d.find((x) => x.key === 'fr')).toMatchObject({ kind: 'hub', href: '/fr' });
    expect(d.find((x) => x.key === 'uk')).toMatchObject({ kind: 'calc', href: '/uk/solar-calculator' });
    expect(d.find((x) => x.key === 'us-fl')!.href).toContain('florida');
  });
});

describe('latestPostLinks', () => {
  it('returns newest live posts, capped per country', () => {
    const posts = [1, 2, 3].map((i) => art({ id: `gb/p${i}`, country: 'gb', collection: 'blog', updated: new Date(`2026-0${i}-01`) }));
    const out = latestPostLinks([...posts, art({ id: 'de/p', country: 'de', collection: 'blog', updated: new Date('2025-01-01') })], 5, 2);
    expect(out.map((l) => l.id)).toEqual(['gb/p3', 'gb/p2', 'de/p']);
  });
});
