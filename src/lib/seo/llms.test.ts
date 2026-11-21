import { describe, expect, it } from 'vitest';
import { articleEntries, staticEntries, type ArticleInput } from './static-entries';
import { llmsPageUrls, renderCountryLlms, renderLlmsFull, renderRootLlms } from './llms';
import { renderSitemaps } from './sitemaps';
import { loadDbIndexEntries } from './sitemap-db';
import { UTILITY_PAGES } from '../utility/pages';
import type { IndexEntry } from './site-index';

const ENV = { url: 'https://db.example', key: 'k' };

const tables: Record<string, unknown[]> = {
  cities: [
    { state: 'FL', slug: 'miami', name: 'Miami', default_utility_id: 'fpl', published: true, updated_at: '2026-10-01T00:00:00Z' },
    { state: 'FL', slug: 'ocala', name: 'Ocala', default_utility_id: 'duke-fl', published: true, updated_at: '2026-09-01T00:00:00Z' },
    // The DB must filter these, but even if it returns them they are never listed:
    { state: 'FL', slug: 'draftville', name: 'Draftville', default_utility_id: 'fpl', published: false, updated_at: '2026-11-01T00:00:00Z' },
    { state: 'FL', slug: 'fpl', name: 'Reserved', default_utility_id: 'fpl', published: true, updated_at: '2026-11-01T00:00:00Z' },
    { state: 'TX', slug: 'austin', name: 'Austin', default_utility_id: 'x', published: true, updated_at: '2026-11-01T00:00:00Z' },
  ],
  city_housing: [{ state: 'FL', slug: 'miami', updated_at: '2026-10-20T00:00:00Z', verified_on: '2026-10-19' }],
  pvwatts_city_production: [{ state: 'FL', slug: 'miami', updated_at: '2026-08-01T00:00:00Z', fetched_on: '2026-07-30' }],
  utilities: [
    { id: 'fpl', state: 'FL', name: 'Florida Power & Light', source_url: 'https://fpl.example/rates', avg_rate_source_url: null, export_credit_source_url: null, updated_at: '2026-06-01T00:00:00Z', verified_on: '2026-05-30', utility_tier_sets: [], utility_tou_rates: [] },
    { id: 'duke-fl', state: 'FL', name: 'Duke Energy Florida', source_url: null, avg_rate_source_url: null, export_credit_source_url: null, updated_at: '2026-06-02T00:00:00Z', verified_on: null },
  ],
  cost_ranges: [{ state: 'FL', updated_at: '2026-07-01T00:00:00Z', verified_on: '2026-07-01' }],
  model_assumptions: [{ state: null, updated_at: '2026-05-01T00:00:00Z' }],
};

function fakeFetch(overrides: Partial<Record<string, Response | 'fail'>> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const table = new URL(String(input)).pathname.split('/').pop()!;
    const o = overrides[table];
    if (o === 'fail') throw new Error('boom');
    if (o) return o;
    return new Response(JSON.stringify(tables[table] ?? []), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const articles: ArticleInput[] = [
  { collection: 'guides', id: 'live', title: 'Live guide', description: 'A live guide.', updated: '2026-10-10', noindex: false },
  { collection: 'guides', id: 'hidden', title: 'Hidden guide', description: 'noindex.', updated: '2026-10-11', noindex: true },
  { collection: 'blog', id: 'draft', title: 'Draft post', description: 'draft.', published: '2026-10-12', draft: true, noindex: false },
  { collection: 'blog', id: 'post', title: 'A post', description: 'A post.', published: '2026-09-12', noindex: false },
  { collection: 'guides', id: 'tax-fl', route: '/us/solar-tax-benefits/florida', title: 'FL tax', description: 'FL tax benefits.', updated: '2026-11-01', noindex: false },
];

async function build() {
  const db = await loadDbIndexEntries({ env: ENV, fetch: fakeFetch(), indexableUtilities: async () => UTILITY_PAGES.filter((p) => p.slug === 'fpl' || p.slug === 'duke-energy-florida') });
  if (!db.ok) throw new Error('db');
  const entries: IndexEntry[] = [...staticEntries(articles), ...articleEntries(articles), ...db.value];
  return entries;
}

describe('loadDbIndexEntries', () => {
  it('lists only published, non-reserved, valid-state cities with real lastmod', async () => {
    const e = await build();
    const cities = e.filter((x) => x.type === 'cities').map((x) => x.path);
    expect(cities).toEqual(['/us/solar-payback/florida/miami', '/us/solar-payback/florida/ocala']);
    const miami = e.find((x) => x.path.endsWith('/miami'))!;
    expect(miami.lastmod).toBe('2026-10-20');
    expect(miami.utility).toEqual({ name: 'Florida Power & Light', path: '/us/utility/florida/fpl' });
  });
  it('lists only indexable utility pages, with their sources', async () => {
    const e = await build();
    const u = e.filter((x) => x.type === 'utilities');
    expect(u.map((x) => x.path).sort()).toEqual(['/us/utility/florida/duke-energy-florida', '/us/utility/florida/fpl']);
    expect(u.find((x) => x.path.endsWith('/fpl'))!.sources).toEqual([{ url: 'https://fpl.example/rates', checkedOn: '2026-05-30' }]);
  });
  it('maps a DB error or missing env to an error result, never an empty list', async () => {
    expect((await loadDbIndexEntries({ env: ENV, fetch: fakeFetch({ cities: 'fail' }), indexableUtilities: async () => [] })).ok).toBe(false);
    expect((await loadDbIndexEntries({ env: ENV, fetch: fakeFetch({ utilities: new Response('x', { status: 500 }) }), indexableUtilities: async () => [] })).ok).toBe(false);
    expect((await loadDbIndexEntries({ env: null })).ok).toBe(false);
    expect((await loadDbIndexEntries({ env: ENV, fetch: fakeFetch(), indexableUtilities: async () => { throw new Error('x'); } })).ok).toBe(false);
  });
});

describe('static entries', () => {
  it('omits drafts and noindex articles, and index pages need a published entry', async () => {
    const e = await build();
    const paths = e.map((x) => x.path);
    expect(paths).toContain('/guides/live');
    expect(paths).toContain('/blog/post');
    expect(paths).toContain('/us/solar-tax-benefits/florida');
    expect(paths).not.toContain('/guides/hidden');
    expect(paths).not.toContain('/blog/draft');
    expect(paths).not.toContain('/guides/tax-fl');
    expect(staticEntries([]).map((x) => x.path)).not.toContain('/guides');
    expect(staticEntries([]).map((x) => x.path)).not.toContain('/blog');
  });
  it('uses the article updated date, else published, never a build time', async () => {
    const e = await build();
    expect(e.find((x) => x.path === '/guides/live')!.lastmod).toBe('2026-10-10');
    expect(e.find((x) => x.path === '/blog/post')!.lastmod).toBe('2026-09-12');
  });
});

describe('sitemaps', () => {
  it('splits into <cc>-<type> files and an index listing only non-empty ones', async () => {
    const { index, files } = renderSitemaps(await build());
    expect([...files.keys()]).toEqual(['sitemap-global-pages.xml', 'sitemap-us-articles.xml', 'sitemap-us-calculators.xml', 'sitemap-us-cities.xml', 'sitemap-us-utilities.xml']);
    for (const name of files.keys()) expect(index).toContain(`<loc>https://rayvalue.com/${name}</loc>`);
    expect(files.get('sitemap-us-cities.xml')).toContain('<lastmod>2026-10-20</lastmod>');
    expect(files.get('sitemap-us-cities.xml')).not.toContain('draftville');
  });
  it('lists every URL in exactly one child', async () => {
    const { files } = renderSitemaps(await build());
    const all = [...files.values()].flatMap((x) => [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('llms parity with the sitemaps', () => {
  it('every page URL in the llms files is in a sitemap, and nothing unpublished appears', async () => {
    const entries = await build();
    const { files } = renderSitemaps(entries);
    const sitemapUrls = new Set([...files.values()].flatMap((x) => [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)));
    const root = renderRootLlms(entries);
    const us = renderCountryLlms(entries, 'us');
    const full = renderLlmsFull(entries);
    for (const txt of [root, us, full]) {
      for (const u of llmsPageUrls(txt)) expect(sitemapUrls.has(u), u).toBe(true);
      expect(txt).not.toMatch(/draftville|\/guides\/hidden|\/blog\/draft|\/go\/|\/admin|\/api\//);
    }
    // The country file and the full file list every sitemap URL for their scope.
    for (const u of sitemapUrls) expect(llmsPageUrls(full)).toContain(u);
    for (const u of [...sitemapUrls].filter((x) => x.includes('/us/'))) expect(llmsPageUrls(us)).toContain(u);
  });
  it('root llms.txt links the country file, states the 25D rule, and does not read as a government site', async () => {
    const root = renderRootLlms(await build());
    expect(root).toContain('https://rayvalue.com/us/llms.txt');
    expect(root).toMatch(/25D\) is \$0 for 2026\+ installs/);
    expect(root).not.toMatch(/official|\.gov|government/i);
  });
  it('/us/llms.txt computes coverage counts from the entries and lists utility sources', async () => {
    const us = renderCountryLlms(await build(), 'us');
    expect(us).toContain('2 city pages');
    expect(us).toContain('2 utility pages');
    expect(us).toContain('Rate sources: https://fpl.example/rates (checked 2026-05-30)');
    expect(us).toContain('## Cities: Florida (2)');
  });
});
