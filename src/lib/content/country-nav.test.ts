import { describe, expect, it } from 'vitest';
import { contentCountries, countryFromPath, countryName, countryNav, hubIndexable, hubItemCount, HUB_MIN_ITEMS } from './country-nav';
import { uiText, hubIntro, resolveUiLang, SUPPORTED_UI_LANGS } from '../i18n/ui';
import { countryHubEntries } from '../seo/country-hubs';
import { renderSitemaps } from '../seo/sitemaps';
import { renderCountryLlms } from '../seo/llms';
import type { ArticleInput } from '../seo/static-entries';
import type { IndexEntry } from '../seo/site-index';

const known = ['au', 'de', 'ie', 'uk'];

describe('countryFromPath', () => {
  it('detects the country segment of articles, hubs and place pages', () => {
    expect(countryFromPath('/uk', known)).toBe('uk');
    expect(countryFromPath('/uk/guides/x', known)).toBe('uk');
    expect(countryFromPath('/uk/solar-panels/kent/dover', known)).toBe('uk');
    expect(countryFromPath('/de/photovoltaik/bayern', known)).toBe('de');
    expect(countryFromPath('/au/solar-payback/nsw/sydney', known)).toBe('au');
  });
  it('is null for US, global and non-country two-letter routes', () => {
    expect(countryFromPath('/', known)).toBeNull();
    expect(countryFromPath('/us/solar-payback/florida', known)).toBeNull();
    expect(countryFromPath('/guides/foo', known)).toBeNull();
    expect(countryFromPath('/go/x', known)).toBeNull();
    expect(countryFromPath('/og/default.png', known)).toBeNull();
    expect(countryFromPath('/nl/guides/x', known)).toBeNull();
  });
});

describe('countryNav', () => {
  const base = { segment: 'uk', lang: 'en-GB', counts: { guides: 4, blog: 2 }, countries: ['uk', 'de', 'au'] };
  it('has the country home, Guides and Blog, and a switcher; no US links', () => {
    const n = countryNav(base);
    expect(n.home).toEqual({ href: '/uk', label: 'Home' });
    expect(n.links).toEqual([{ href: '/uk/guides', label: 'Guides' }, { href: '/uk/blog', label: 'Blog' }]);
    expect(n.switcher.map((s) => s.href)).toEqual(['/au', '/de', '/uk']);
    expect(n.switcher.find((s) => s.current)?.href).toBe('/uk');
    const all = JSON.stringify(n);
    expect(all).not.toMatch(/quotes|florida|california/i);
  });
  it('omits Guides / Blog with no published entries', () => {
    expect(countryNav({ ...base, counts: { guides: 0, blog: 2 } }).links.map((l) => l.label)).toEqual(['Blog']);
    expect(countryNav({ ...base, counts: { guides: 0, blog: 0 } }).links).toEqual([]);
  });
  it('localises labels per language with English fallback', () => {
    expect(countryNav({ ...base, segment: 'de', lang: 'de-DE' }).links.map((l) => l.label)).toEqual(['Ratgeber', 'Blog']);
    expect(countryNav({ ...base, segment: 'de', lang: 'de-DE' }).home.label).toBe('Startseite');
    expect(uiText('es-ES').guides).toBe('Guías');
    expect(uiText('xx').home).toBe('Home');
    // Full tag before primary subtag: Brazilian Portuguese is not the European one.
    expect(uiText('pt-BR').contact).toBe('Contato');
    expect(uiText('pt-PT').contact).toBe('Contacto');
    expect(uiText('pt').contact).toBe('Contacto');
    expect(resolveUiLang('PT_br')).toBe('pt-br');
    expect(uiText('ja').home).toBe('ホーム');
    expect(uiText('ja-JP').guides).toBe('ガイド');
    expect(uiText('hi-IN').home).toBe('होम');
    expect(hubIntro('pt-BR', 'Brasil')).toContain('energia solar');
    expect(hubIntro('ja', '日本')).toContain('日本');
    for (const l of SUPPORTED_UI_LANGS) {
      const t = uiText(l);
      for (const [k, v] of Object.entries(t)) expect(v, `${l}.${k}`).toBeTruthy();
    }
    expect(uiText(undefined).guides).toBe('Guides');
    expect(hubIntro('de', 'Deutschland')).toContain('Deutschland');
  });
  it('names countries (GB is uk)', () => {
    expect(countryName('uk')).toBe('United Kingdom');
    expect(countryName('de', 'de')).toBe('Deutschland');
  });
  it('lists content countries by segment, excluding the US', () => {
    expect(contentCountries([{ data: { country: 'gb' } }, { data: { country: 'gb' } }, { data: { country: 'us' } }, { data: { country: 'de' } }])).toEqual(['de', 'uk']);
  });
});

describe('hub indexability', () => {
  it('needs at least 3 published items', () => {
    expect(HUB_MIN_ITEMS).toBe(3);
    expect(hubIndexable(hubItemCount({ guides: 1, blog: 1 }))).toBe(false);
    expect(hubIndexable(hubItemCount({ guides: 1, blog: 1, placeHubs: 1 }))).toBe(true);
    expect(hubIndexable(hubItemCount({ guides: 2, blog: 1 }))).toBe(true);
  });
  const art = (cc: string, i: number, extra: Partial<ArticleInput> = {}): ArticleInput => ({ collection: 'guides', id: `${cc}/a${i}`, country: cc, title: 't', description: 'd', updated: '2026-11-01', ...extra });
  it('lists hubs only for countries with >= 3 indexable items, in sitemap-<seg>-pages and llms', () => {
    const arts = [art('gb', 1), art('gb', 2), art('gb', 3), art('de', 1), art('de', 2), art('ie', 1), art('ie', 2, { draft: true }), art('ie', 3, { noindex: true }), art('us', 1)];
    const hubs = countryHubEntries(arts);
    expect(hubs.map((h) => h.path)).toEqual(['/uk']);
    expect(hubs[0]).toMatchObject({ country: 'uk', type: 'pages' });
    const { files } = renderSitemaps(hubs);
    expect([...files.keys()]).toEqual(['sitemap-uk-pages.xml']);
    expect(renderCountryLlms(hubs, 'uk')).toContain('https://rayvalue.com/uk');
  });
  it('place hubs count toward the threshold', () => {
    const places: IndexEntry[] = [{ path: '/de/photovoltaik/bayern', country: 'de', type: 'places', section: 'places', lastmod: '2026-11-01', title: 'h', summary: 's', placeKind: 'hub' }];
    expect(countryHubEntries([art('de', 1), art('de', 2)], places).map((h) => h.path)).toEqual(['/de']);
    expect(countryHubEntries([art('de', 1), art('de', 2)]).length).toBe(0);
  });
});
