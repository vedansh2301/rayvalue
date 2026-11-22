import { describe, expect, it } from 'vitest';
import { placeIndexEntries } from './index-entries';
import { renderSitemaps } from '../seo/sitemaps';
import { llmsCountries, renderCountryLlms } from '../seo/llms';
import { SITEMAP_FILE_RE, countryOf, pageTypeOf } from '../seo/site-index';
import { fact } from './test-fixtures';
import type { PlaceRegion, PlaceWithFacts } from './schema';

describe('sitemaps and llms.txt are generic over the new countries', () => {
  const mk = (cc: 'ES' | 'SE' | 'PL', regionCode: string, slug: string, facts = [fact('solar_yield_kwh_per_kwp'), fact('owner_occupied_share_pct'), fact('one_dwelling_share_pct')]): PlaceWithFacts =>
    ({ id: `${cc}${slug}`, country: cc, region_code: regionCode, slug, name: slug, lat: null, lon: null, published: true, updated_at: null, place_facts: facts });
  const regions: PlaceRegion[] = [
    { country: 'ES', code: 'AN', name: 'Andalucía', slug: 'andalucia' },
    { country: 'SE', code: 'SE110', name: 'Stockholms län', slug: 'stockholms-lan' },
    { country: 'PL', code: 'PL21', name: 'Małopolskie', slug: 'malopolskie' },
  ];
  const es = [fact('solar_yield_kwh_per_kwp'), fact('homeownership_pct'), fact('household_net_income_avg')];
  const entries = placeIndexEntries(regions, [mk('ES', 'AN', 'a', es), mk('ES', 'AN', 'b', es), mk('ES', 'AN', 'c', es), mk('SE', 'SE110', 'stockholm'), mk('PL', 'PL21', 'krakow'), mk('PL', 'PL21', 'thin', [fact('solar_yield_kwh_per_kwp')])]);

  it('lists gated places and the hubs that have enough of them, under the right country segment', () => {
    expect(entries.map((e) => e.path).sort()).toEqual([
      '/es/placas-solares/andalucia', '/es/placas-solares/andalucia/a', '/es/placas-solares/andalucia/b', '/es/placas-solares/andalucia/c',
      '/pl/fotovoltaika/malopolskie/krakow', '/se/solceller/stockholms-lan/stockholm',
    ]);
    expect(entries.every((e) => e.type === 'places')).toBe(true);
  });

  it('classification of a path agrees with the entry (sitemap file, country)', () => {
    for (const e of entries) {
      expect(pageTypeOf(e.path)).toBe('places');
      expect(countryOf(e.path)).toBe(e.country);
    }
  });

  it('renders sitemap-<cc>-places.xml per country and a /<cc>/llms.txt listing the same URLs', () => {
    const maps = renderSitemaps(entries);
    expect([...maps.files.keys()].sort()).toEqual(['sitemap-es-places.xml', 'sitemap-pl-places.xml', 'sitemap-se-places.xml']);
    for (const name of maps.files.keys()) expect(name).toMatch(SITEMAP_FILE_RE);
    expect(maps.files.get('sitemap-es-places.xml')).toContain('https://rayvalue.com/es/placas-solares/andalucia/a');
    const llms = renderCountryLlms(entries, 'se');
    expect(llms).toContain('https://rayvalue.com/se/solceller/stockholms-lan/stockholm');
    expect(llms).not.toContain('/es/placas-solares');
    expect(llmsCountries(entries)).toEqual(['es', 'pl', 'se']);
  });
});
