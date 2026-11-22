import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALCULATOR_PAGES, NOINDEX_UTILITY_PAGES, STATIC_INDEX, SITEMAP_FILE_RE, countryOf, groupBySitemap, isExcludedStaticPath, pageTypeOf, pathFromPageFile, sitemapFileName, type IndexEntry } from './site-index';
import { UNREVIEWED_PAGES } from './unreviewed-pages';
import { UTILITY_PAGES, utilityPagePath } from '../utility/pages';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('pageTypeOf / countryOf', () => {
  it.each([
    ['/us/solar-payback/florida', 'calculators'],
    ['/us/solar-payback/california/', 'calculators'],
    ['/us/solar-payback/florida/miami', 'cities'],
    ['/us/utility/florida/fpl', 'utilities'],
    ['/us/solar-tax-benefits', 'articles'],
    ['/us/solar-tax-benefits/california', 'articles'],
    ['/uk/solar-panels/north-east/newcastle-upon-tyne', 'places'],
    ['/de/photovoltaik/bayern', 'places'],
    ['/au/solar-payback/nsw/sydney', 'places'],
    ['/au/solar-panels/nsw', 'pages'],
    ['/guides/x', 'pages'],
    ['/blog/x', 'pages'],
    ['/', 'pages'],
    ['/quotes', 'pages'],
  ])('%s -> %s', (p, t) => expect(pageTypeOf(p)).toBe(t));

  it('country and file names', () => {
    expect(countryOf('/us/solar-payback/florida')).toBe('us');
    expect(countryOf('/guides/x')).toBe('global');
    expect(sitemapFileName('us', 'cities')).toBe('sitemap-us-cities.xml');
    expect(sitemapFileName('global', 'pages')).toBe('sitemap-global-pages.xml');
    expect(SITEMAP_FILE_RE.test('sitemap-us-cities.xml')).toBe(true);
    expect(SITEMAP_FILE_RE.test('sitemap-index.xml')).toBe(false);
  });
});

describe('isExcludedStaticPath', () => {
  it('excludes private, unreviewed, noindex, redirected and collection-excluded paths', () => {
    for (const p of ['/api/leads', '/admin', '/admin/kpi', '/go/fl', '/go/ca', '/go/out/x', '/unsubscribe', '/404', ...UNREVIEWED_PAGES, ...NOINDEX_UTILITY_PAGES]) {
      expect(isExcludedStaticPath(p), p).toBe(true);
    }
    expect(isExcludedStaticPath('/old', { redirected: new Set(['/old']) })).toBe(true);
    expect(isExcludedStaticPath('/guides/x/', { excludedCollections: new Set(['/guides/x']) })).toBe(true);
    expect(isExcludedStaticPath('/methodology')).toBe(false);
  });
});

describe('every page file against the index', () => {
  const files = walk(join(process.cwd(), 'src/pages')).map(pathFromPageFile).filter((p): p is string => p !== null);
  const dbBacked = new Set([...CALCULATOR_PAGES.map((c) => c.path), ...UTILITY_PAGES.map(utilityPagePath)]);

  it('finds the page files', () => expect(files.length).toBeGreaterThan(10));

  it('each static route is curated, DB-backed or excluded (a new page fails here until classified)', () => {
    for (const p of files) {
      const ok = isExcludedStaticPath(p) || p in STATIC_INDEX || dbBacked.has(p);
      expect(ok, `${p} is not classified in site-index.ts`).toBe(true);
    }
  });

  it('every curated path is a real, non-excluded route', () => {
    for (const p of Object.keys(STATIC_INDEX)) {
      expect(isExcludedStaticPath(p), p).toBe(false);
      expect(files.includes(p), `${p} has no page file`).toBe(true);
    }
    for (const p of dbBacked) expect(files.includes(p), p).toBe(true);
  });

  it('no excluded path is curated', () => {
    for (const p of [...UNREVIEWED_PAGES, ...NOINDEX_UTILITY_PAGES, '/go/fl', '/go/ca']) expect(p in STATIC_INDEX).toBe(false);
  });
});

describe('groupBySitemap', () => {
  const e = (path: string, type: IndexEntry['type'], country: IndexEntry['country']): IndexEntry => ({ path, type, country, section: 'about', lastmod: null, title: 't', summary: 's' });
  it('groups, dedupes, sorts, and emits no empty file', () => {
    const g = groupBySitemap([e('/us/solar-payback/florida/b', 'cities', 'us'), e('/us/solar-payback/florida/a', 'cities', 'us'), e('/us/solar-payback/florida/a', 'cities', 'us'), e('/', 'pages', 'global')]);
    expect([...g.keys()]).toEqual(['sitemap-global-pages.xml', 'sitemap-us-cities.xml']);
    expect(g.get('sitemap-us-cities.xml')!.map((x) => x.path)).toEqual(['/us/solar-payback/florida/a', '/us/solar-payback/florida/b']);
  });
});
