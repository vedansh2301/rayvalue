import { describe, expect, it } from 'vitest';
import { loadPlaceIndexEntries, placeIndexEntries } from './index-entries';
import { renderSitemaps } from '../seo/sitemaps';
import { llmsCountries, renderCountryLlms, renderRootLlms } from '../seo/llms';
import { SITEMAP_FILE_RE, countryOf, pageTypeOf, sitemapFileName } from '../seo/site-index';
import { dePlace, fact, place, regions } from './test-fixtures';

const gb = (slug: string, over = {}) => place({ id: slug, slug, name: slug.toUpperCase(), ...over });
const places = [gb('a'), gb('b'), gb('c'), gb('hidden', { published: false }), gb('thin', { place_facts: [fact('solar_yield_kwh_per_kwp')] }), dePlace()];

describe('placeIndexEntries', () => {
  const entries = placeIndexEntries(regions, places);
  const paths = entries.map((e) => e.path);

  it('lists published places that pass the gate, and the hub with >= 3 of them', () => {
    expect(paths).toContain('/uk/solar-panels/north-east/a');
    expect(paths).toContain('/uk/solar-panels/north-east');
    expect(paths).toContain('/de/photovoltaik/bayern/muenchen');
  });

  it('never lists an unpublished or under-sourced place', () => {
    expect(paths.join(' ')).not.toContain('hidden');
    expect(paths.join(' ')).not.toContain('thin');
  });

  it('a region with fewer than 3 renderable places gets no hub (Bayern has one)', () => {
    expect(paths).not.toContain('/de/photovoltaik/bayern');
  });

  it('uses data dates for lastmod, never a build time', () => {
    expect(entries.find((e) => e.path.endsWith('/a'))!.lastmod).toBe('2026-11-22');
    expect(entries.every((e) => e.lastmod === null || /^\d{4}-\d{2}-\d{2}$/.test(e.lastmod))).toBe(true);
  });

  it('classifies by path as places, per country', () => {
    for (const e of entries) {
      expect(pageTypeOf(e.path)).toBe('places');
      expect(countryOf(e.path)).toBe(e.country);
    }
  });
});

describe('sitemap and llms parity', () => {
  const entries = placeIndexEntries(regions, places);

  it('writes sitemap-uk-places.xml and sitemap-de-places.xml with exactly the gated URLs', () => {
    const out = renderSitemaps(entries);
    expect([...out.files.keys()]).toEqual(['sitemap-de-places.xml', 'sitemap-uk-places.xml']);
    const uk = out.files.get('sitemap-uk-places.xml')!;
    expect(uk).toContain('https://rayvalue.com/uk/solar-panels/north-east/a');
    expect(uk).not.toContain('hidden');
    expect(uk).not.toContain('thin');
    expect(out.index).toContain('https://rayvalue.com/sitemap-uk-places.xml');
    expect(sitemapFileName('uk', 'places')).toBe('sitemap-uk-places.xml');
    expect(SITEMAP_FILE_RE.test('sitemap-au-places.xml')).toBe(true);
  });

  it('/uk/llms.txt lists the same places, grouped by region; unpublished ones are absent', () => {
    expect(llmsCountries(entries)).toEqual(['de', 'uk']);
    const txt = renderCountryLlms(entries, 'uk');
    expect(txt).toContain('## Places: North East');
    expect(txt).toContain('(https://rayvalue.com/uk/solar-panels/north-east/a)');
    expect(txt).toContain('(https://rayvalue.com/uk/solar-panels/north-east)');
    expect(txt).not.toContain('hidden');
    expect(txt).not.toContain('thin');
    expect(txt).toMatch(/Coverage \(computed from the database\): 3 place pages in 1 region/);
    expect(renderRootLlms(entries)).toContain('3 place pages');
  });
});

describe('loadPlaceIndexEntries', () => {
  const env = { url: 'https://db.example', key: 'k' };
  const respond = (status: number, body: unknown) => (async (input: RequestInfo | URL) => {
    const table = new URL(String(input)).pathname.split('/').pop();
    if (table === 'regions') return new Response(JSON.stringify(regions), { status: 200 });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

  it('lists gated places and drops unpublished rows even if the database returns them', async () => {
    const r = await loadPlaceIndexEntries({ env, fetch: respond(200, places) });
    expect(r.ok && r.value.map((e) => e.path)).toContain('/uk/solar-panels/north-east/a');
    expect(r.ok && r.value.map((e) => e.path).join(' ')).not.toContain('hidden');
  });

  it('before migration 0033 (404) there are simply no place entries; other failures are errors (503)', async () => {
    const missing = await loadPlaceIndexEntries({ env, fetch: respond(404, {}) });
    expect(missing.ok && missing.value).toEqual([]);
    const broken = await loadPlaceIndexEntries({ env, fetch: respond(500, {}) });
    expect(broken.ok).toBe(false);
  });
});
