import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GLOBAL_NAV, countryMenu, isGlobalPath, isUsPath, navContext } from './nav';

const known = ['au', 'de', 'ie', 'uk'];
const counts = new Map([
  ['uk', { guides: 4, blog: 2 }],
  ['de', { guides: 3, blog: 0 }],
  ['au', { guides: 5, blog: 1 }],
  ['ie', { guides: 3, blog: 0 }],
]);
const ctx = (path: string, lang = 'en') => navContext({ path, known, counts, lang });

describe('path classification', () => {
  it('treats country-independent pages, and the global /guides and /blog indexes, as global', () => {
    for (const p of ['/', '/about', '/methodology', '/contact', '/privacy', '/terms', '/affiliate-disclosure', '/404', '/guides', '/blog', '/guides/', '/blog/']) expect(isGlobalPath(p), p).toBe(true);
  });
  it('treats US pages and US article pages as US', () => {
    for (const p of ['/us', '/us/solar-payback/florida', '/quotes', '/stories', '/guides/solar-lease-vs-buy', '/blog/some-post', '/go/x', '/alerts/thanks']) {
      expect(isUsPath(p), p).toBe(true);
      expect(isGlobalPath(p), p).toBe(false);
    }
  });
});

describe('global header', () => {
  it('has Countries, Calculators, Guides, Methodology and no Get quotes', () => {
    expect(GLOBAL_NAV.map((l) => l.label)).toEqual(['Countries', 'Calculators', 'Guides', 'Blog', 'Methodology']);
    expect(GLOBAL_NAV.some((l) => /quote/i.test(l.label + l.href))).toBe(false);
  });
});

describe('nav context per path', () => {
  it('global pages have no context row and no CTA', () => {
    for (const p of ['/', '/about', '/methodology', '/guides', '/blog', '/404', '/contact']) {
      const c = ctx(p);
      expect(c, p).toMatchObject({ kind: 'global', segment: null, links: [], cta: null });
    }
  });
  it('country pages get that country: overview, calculator when it has one, guides, blog', () => {
    const uk = ctx('/uk/guides/solar-panels-vat-deadline-2027');
    expect(uk).toMatchObject({ kind: 'country', segment: 'uk', name: 'United Kingdom', cta: null });
    expect(uk.links).toEqual([
      { href: '/uk', label: 'Home' },
      { href: '/uk/solar-calculator', label: 'Calculator' },
      { href: '/uk/guides', label: 'Guides' },
      { href: '/uk/blog', label: 'Blog' },
    ]);
    // A country without a calculator or without blog posts only lists what exists.
    expect(ctx('/ie').links.map((l) => l.href)).toEqual(['/ie', '/ie/guides']);
  });
  it('localises the country context in the page language', () => {
    const de = ctx('/de/photovoltaik-rechner', 'de-DE');
    expect(de.name).toBe('Deutschland');
    expect(de.links.map((l) => l.label)).toEqual(['Startseite', 'Rechner', 'Ratgeber']);
  });
  it('US pages get the US context with the state calculators and the only Get quotes CTA', () => {
    for (const p of ['/us', '/us/solar-payback/florida', '/quotes', '/stories', '/guides/solar-lease-vs-buy']) {
      const c = ctx(p);
      expect(c, p).toMatchObject({ kind: 'us', segment: 'us', name: 'United States', cta: { href: '/quotes', label: 'Get quotes' } });
      expect(c.links.map((l) => l.href), p).toContain('/us/solar-payback/california');
    }
  });
  it('no Get quotes, no US state calculators outside US pages', () => {
    for (const p of ['/', '/about', '/guides', '/blog', '/uk', '/de/photovoltaik-rechner', '/au/solar-battery-calculator', '/ie/guides']) {
      const c = ctx(p);
      expect(c.cta, p).toBeNull();
      expect(JSON.stringify(c.links), p).not.toMatch(/quote|florida|california/i);
    }
  });
});

describe('countryMenu', () => {
  const m = countryMenu(['us', 'uk', 'de', 'au', 'za', 'ie'], 'de');
  it('groups by region in the fixed order and sorts by name', () => {
    expect(m.map((g) => g.region)).toEqual(['Europe', 'Americas', 'Asia-Pacific', 'Africa & Middle East']);
    expect(m[0]!.items.map((i) => i.name)).toEqual(['Germany', 'Ireland', 'United Kingdom']);
  });
  it('links hubs, marks the current country and includes every segment given', () => {
    expect(m[0]!.items.find((i) => i.current)?.href).toBe('/de');
    expect(m.flatMap((g) => g.items).map((i) => i.segment).sort()).toEqual(['au', 'de', 'ie', 'uk', 'us', 'za']);
    expect(m[1]!.items[0]).toMatchObject({ href: '/us', name: 'United States' });
  });
});

describe('template sources', () => {
  const read = (f: string) => readFileSync(f, 'utf8');
  it('Get quotes lives only in the US context, never in the header or footer templates', () => {
    for (const f of ['./src/components/Header.astro', './src/components/Footer.astro']) {
      const s = read(f);
      expect(s, f).not.toMatch(/Get quotes/);
    }
    // The only "Get quotes" label in the nav model is the US context CTA.
    expect(read('./src/lib/nav.ts').match(/label: 'Get quotes'/g)).toHaveLength(1);
  });
  it('the header menu is CSP-safe: no inline style or inline script (bundled scripts are hashed by the CSP)', () => {
    for (const f of ['./src/components/Header.astro', './src/components/Footer.astro', './src/components/ui/PageHero.astro', './src/pages/index.astro']) {
      expect(read(f), f).not.toMatch(/\sstyle=|<script[^>]*is:inline/);
    }
  });
  it('the tagline is global', () => {
    expect(read('./src/lib/i18n/ui.ts')).not.toMatch(/Solar math for your home/);
    expect(read('./src/lib/i18n/ui.ts')).toContain('Solar payback, country by country');
  });
});
