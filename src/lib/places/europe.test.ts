import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLACE_COUNTRIES, PLACE_PATH_RE, isRegionPage, placeCountryByCode, placeCountryForRoute, placePath, regionHubPath } from './config';
import { ALLOWED_KEYS, SECTION_KEYS, evaluatePlace, renderablePlaces } from './gate';
import { planCountry } from './import-plan';
import { placeIndexEntries } from './index-entries';
import { PLACE_TEXT } from './i18n';
import { NUTS_COUNTRIES, mapPackFacts, packFactsFromCsv, parsePackPlaces, placeLocator, regionsFromMigration, type PackFact } from './pack';
import { resolvePlaceRoute } from './resolve';
import { fact, monthlyFacts } from './test-fixtures';
import type { PlaceRegion, PlaceWithFacts } from './schema';
import { buildPlaceView } from './view';

const EUROPE = ['ES', 'IE', 'SE', 'DK', 'NO', 'FI', 'PL', 'CZ', 'RO'] as const;

const pf = (over: Partial<PackFact>): PackFact => ({ key: 'x', region: 'r', value: '1', unit: 'u', valid_from: '', valid_to: '', source_url: 'https://example.org/s', publisher: 'Pub', retrieved_on: '2026-11-22', excerpt: 'e', confidence: 'primary', ...over });

describe('config: the new countries', () => {
  it('URL words, locales and article countries', () => {
    expect(PLACE_COUNTRIES.map((c) => c.code).sort()).toEqual(['AU', 'CZ', 'DE', 'DK', 'ES', 'FI', 'GB', 'IE', 'NO', 'PL', 'RO', 'SE']);
    expect(placePath(placeCountryByCode('ES')!, 'andalucia', 'almeria')).toBe('/es/placas-solares/andalucia/almeria');
    expect(placePath(placeCountryByCode('SE')!, 'stockholms-lan', 'stockholm')).toBe('/se/solceller/stockholms-lan/stockholm');
    expect(placePath(placeCountryByCode('FI')!, 'uusimaa', 'helsinki')).toBe('/fi/aurinkopaneelit/uusimaa/helsinki');
    expect(placePath(placeCountryByCode('RO')!, 'bucuresti', 'bucuresti')).toBe('/ro/panouri-fotovoltaice/bucuresti/bucuresti');
    expect(placePath(placeCountryByCode('PL')!, 'malopolskie', 'krakow')).toBe('/pl/fotovoltaika/malopolskie/krakow');
    expect(placePath(placeCountryByCode('CZ')!, 'praha', 'praha')).toBe('/cz/fotovoltaika/praha/praha');
    expect(placeCountryForRoute('ie', 'solar-payback')?.code).toBe('IE');
    expect(placeCountryForRoute('au', 'solar-payback')?.code).toBe('AU');
    expect(placeCountryForRoute('ie', 'solceller')).toBeNull();
  });

  it('every country has a unique segment and a complete text dictionary', () => {
    expect(new Set(PLACE_COUNTRIES.map((c) => c.segment)).size).toBe(PLACE_COUNTRIES.length);
    for (const c of PLACE_COUNTRIES) {
      const t = PLACE_TEXT[c.code];
      expect(t.h1('X')).toContain('X');
      expect(t.title('X')).toContain('X');
      expect(t.notFound.title).not.toBe('');
      expect(t.unavailable.body).not.toBe('');
      expect(t.chart.methodLine('PVGIS-SARAH3', 40, 14, t.facing.south)).toContain('PVGIS-SARAH3');
    }
  });

  it('PLACE_PATH_RE classifies paths of every configured country, and county pages', () => {
    expect(PLACE_PATH_RE.test('/es/placas-solares/andalucia/almeria')).toBe(true);
    expect(PLACE_PATH_RE.test('/ie/solar-payback/dublin')).toBe(true);
    expect(PLACE_PATH_RE.test('/pl/fotovoltaika/malopolskie')).toBe(true);
    expect(PLACE_PATH_RE.test('/se/fotovoltaika/x/y')).toBe(false);
    expect(PLACE_PATH_RE.test('/es/guides/algo')).toBe(false);
    expect(PLACE_PATH_RE.exec('/cz/fotovoltaika/praha/praha')?.[1]).toBe('cz');
  });

  it('county pages live at the hub URL (IE only)', () => {
    const ie = placeCountryByCode('IE')!;
    expect(isRegionPage(ie, 'dublin', 'dublin')).toBe(true);
    expect(isRegionPage(ie, 'dublin', 'swords')).toBe(false);
    expect(placePath(ie, 'dublin', 'dublin')).toBe(regionHubPath(ie, 'dublin'));
    expect(isRegionPage(placeCountryByCode('ES')!, 'madrid', 'madrid')).toBe(false);
    expect(placePath(placeCountryByCode('ES')!, 'comunidad-de-madrid', 'madrid')).toBe('/es/placas-solares/comunidad-de-madrid/madrid');
  });
});

describe('gate: sections per country', () => {
  it('ES: yield + housing + income pass; secondary municipal rows never count; a primary one does', () => {
    const base = [fact('solar_yield_kwh_per_kwp'), fact('homeownership_pct'), fact('household_net_income_avg')];
    expect(evaluatePlace('ES', { published: true, place_facts: base })).toMatchObject({ renders: true, sections: ['yield', 'housing', 'income'] });
    const sec = [...base, fact('municipal_icio_bonus_pct', { confidence: 'secondary' })];
    expect(evaluatePlace('ES', { published: true, place_facts: sec }).sections).toEqual(['yield', 'housing', 'income']);
    expect(evaluatePlace('ES', { published: true, place_facts: [...base, fact('municipal_ibi_bonus_pct')] }).sections).toEqual(['yield', 'housing', 'income', 'municipal']);
    expect(evaluatePlace('ES', { published: true, place_facts: [fact('solar_yield_kwh_per_kwp'), fact('homeownership_pct')] }).renders).toBe(false);
  });

  it('IE: yield, ownership, solar share and house types are four distinct sections', () => {
    const facts = [fact('solar_yield_kwh_per_kwp'), fact('homeownership_pct'), fact('solar_pv_households_pct'), fact('house_share_pct')];
    expect(evaluatePlace('IE', { published: true, place_facts: facts }).sections).toEqual(['yield', 'ownership', 'installs', 'dwellings']);
  });

  it.each(['SE', 'DK', 'NO', 'FI', 'PL', 'CZ', 'RO'] as const)('%s: needs yield + ownership + one-dwelling share (three sections)', (cc) => {
    const full = [fact('solar_yield_kwh_per_kwp'), fact('owner_occupied_share_pct'), fact('one_dwelling_share_pct')];
    expect(evaluatePlace(cc, { published: true, place_facts: full })).toMatchObject({ renders: true, sections: ['yield', 'ownership', 'dwellings'] });
    expect(evaluatePlace(cc, { published: true, place_facts: full.slice(0, 2) }).renders).toBe(false);
    expect(evaluatePlace(cc, { published: false, place_facts: full }).renders).toBe(false);
  });

  it('renderablePlaces handles every country code, ignores unknown ones', () => {
    const p = (country: string): Pick<PlaceWithFacts, 'country' | 'published' | 'place_facts'> => ({ country, published: true, place_facts: [fact('solar_yield_kwh_per_kwp'), fact('owner_occupied_share_pct'), fact('one_dwelling_share_pct')] });
    expect(renderablePlaces([p('SE'), p('XX'), p('PL')]).map((x) => x.country)).toEqual(['SE', 'PL']);
  });
});

describe('view: every key of every country has a label, a format and a line', () => {
  it.each(PLACE_COUNTRIES.map((c) => c.code))('%s: a place with one fact per section key renders every section with lines', (cc) => {
    const country = placeCountryByCode(cc)!;
    const facts = [...monthlyFacts()];
    for (const key of ALLOWED_KEYS[cc]) {
      facts.push(fact(key, { value_num: ['price_cap_region', 'network_for_place', 'stc_zone'].includes(key) ? null : 12.5, value_text: ['price_cap_region', 'network_for_place', 'stc_zone'].includes(key) ? 'Text' : null, unit: 'u', period: '2021-01-01/2021-12-31', note: key === 'solar_yield_kwh_per_kwp' ? 'db=PVGIS-SARAH3;tilt=40;azimuth=180;loss=14' : null }));
    }
    const region: PlaceRegion = { country: cc, code: 'R1', name: 'Region', slug: 'region' };
    const v = buildPlaceView({ id: 'p', country: cc, region_code: 'R1', slug: 'town', name: 'Town', lat: null, lon: null, published: true, updated_at: null, place_facts: facts }, region);
    expect(v).not.toBeNull();
    expect(v!.lang).toBe(country.htmlLang);
    expect(v!.sections.map((s) => s.id)).toEqual(SECTION_KEYS[cc].map((s) => s.id));
    for (const s of v!.sections) {
      expect(s.heading, `${cc} ${s.id} heading`).not.toBe('');
      expect(s.lines.length, `${cc} ${s.id} lines`).toBeGreaterThan(0);
      for (const l of s.lines) expect(l.label, `${cc} label`).not.toBe('');
    }
  });

  it('number formats follow each locale (percent sign placement, decimal comma, thousands separator)', () => {
    const mk = (cc: 'SE' | 'PL' | 'CZ' | 'ES' | 'IE', region: string): ReturnType<typeof buildPlaceView> =>
      buildPlaceView({
        id: 'p', country: cc, region_code: 'R1', slug: 'x', name: 'Ort', lat: null, lon: null, published: true, updated_at: null,
        place_facts: cc === 'ES'
          ? [fact('solar_yield_kwh_per_kwp', { value_num: 1723.4 }), fact('homeownership_pct', { value_num: 73.1 }), fact('household_net_income_avg', { value_num: 37081, unit: 'EUR per household per year (net)' })]
          : cc === 'IE'
            ? [fact('solar_yield_kwh_per_kwp', { value_num: 987.57 }), fact('homeownership_pct', { value_num: 56.7, note: 'Dublin city and suburbs, Counties Dublin & Meath: owner occupied 258087 / all 455000' }), fact('solar_pv_households_pct', { value_num: 1.96 }), fact('house_share_pct', { value_num: 71.2 })]
            : [fact('solar_yield_kwh_per_kwp', { value_num: 992.4 }), fact('owner_occupied_share_pct', { value_num: 25.2, scope: 'region', scope_label: region }), fact('one_dwelling_share_pct', { value_num: 27.6, scope: 'region', scope_label: region })],
      }, { country: cc, code: 'R1', name: 'Regionen', slug: 'regionen' });
    const nb = ' ';
    const se = mk('SE', 'Stockholms län')!;
    expect(se.sections[1]!.lines[0]!.value).toBe(`25,2${nb}%`);
    expect(se.sections[1]!.lines[0]!.note).toContain('Regionalt värde: Stockholms län');
    expect(se.keyNumbers.answer).toContain('992 kWh');
    expect(mk('PL', 'Warszawski')!.sections[1]!.lines[0]!.value).toBe('25,2%');
    expect(mk('CZ', 'Praha')!.sections[1]!.lines[0]!.value).toBe(`25,2${nb}%`);
    const es = mk('ES', '')!;
    expect(es.sections.find((s) => s.id === 'housing')!.lines[0]!.value).toBe(`73,1${nb}%`);
    expect(es.sections.find((s) => s.id === 'income')!.lines[0]!.value).toBe(`37.081${nb}€ por hogar y año`);
    const ie = mk('IE', '')!;
    expect(ie.sections.find((s) => s.id === 'installs')!.lines[0]!.value).toBe('1.96%');
    expect(ie.sections.find((s) => s.id === 'ownership')!.lines[0]!.note).toContain('Area used: Dublin city and suburbs, Counties Dublin & Meath');
  });

  it('ES: a secondary municipal row is never shown, even inside a counted municipal section', () => {
    const facts = [fact('solar_yield_kwh_per_kwp'), fact('homeownership_pct'), fact('household_net_income_avg'), fact('municipal_ibi_bonus_pct', { value_num: 50 }), fact('ibi_tax_rate_urban', { confidence: 'secondary', value_num: 0.97 }), fact('municipal_icio_bonus_pct', { confidence: 'secondary', value_num: 95 })];
    const v = buildPlaceView({ id: 'p', country: 'ES', region_code: 'MD', slug: 'madrid', name: 'Madrid', lat: null, lon: null, published: true, updated_at: null, place_facts: facts }, { country: 'ES', code: 'MD', name: 'Comunidad de Madrid', slug: 'comunidad-de-madrid' })!;
    const municipal = v.sections.find((s) => s.id === 'municipal')!;
    expect(municipal.lines.map((l) => l.label)).toEqual(['Bonificación del IBI por instalar placas']);
  });
});

describe('pack mapping: ES', () => {
  const places = [{ country: 'ES' as const, regionSlug: 'andalucia', slug: 'almeria', name: 'Almería' }];
  const rows = [
    pf({ key: 'homeownership_pct', region: 'andalucia', value: '79.2', excerpt: '01 Andalucía; Total (tamaño de municipio); En propiedad 2568496 of 3241130' }),
    pf({ key: 'homeownership_pct', region: 'almeria', value: '73.1', excerpt: '04013 Almería: En propiedad 55531 of 75980' }),
    pf({ key: 'non_principal_dwellings_pct', region: 'almeria', value: '24.7', excerpt: '04013 Almería: Vivienda no principal 24977 of 100957' }),
    pf({ key: 'household_net_income_avg', region: 'almeria', value: '37081', excerpt: '04013 Almería: Renta neta media por hogar 2024 = 37081' }),
    pf({ key: 'municipal_icio_bonus_pct', region: 'almeria', value: '95', confidence: 'secondary' }),
    pf({ key: 'rented_pct', region: 'andalucia', value: '11.4' }),
  ];
  it('takes the municipal Census row, not the autonomous-community row; secondary stays flagged; unlisted keys are dropped', () => {
    const r = mapPackFacts('ES', places, rows, [], { regionNames: {} });
    expect(r.facts.filter((f) => f.key === 'homeownership_pct').map((f) => f.value_num)).toEqual([73.1]);
    expect(r.facts.find((f) => f.key === 'municipal_icio_bonus_pct')?.confidence).toBe('secondary');
    expect(r.skipped['regional or national row']).toBe(1);
    expect(r.skipped['key not shown on place pages']).toBe(1);
  });
});

describe('pack mapping: Nordic / CEE', () => {
  const PAGES = `url,page_type,language,title,target_query,intent,tone,unique_data_sections,data_status,priority,notes
/se/solceller/stockholms-lan/stockholm,city,sv,Solceller i Stockholm – lönar det sig 2026?,x,x,x,solar_yield_kwh_per_kwp (992);one_dwelling_share_pct SE110 (27.6%);owner_occupied_share_pct SE11 (25.2%);spot (needs_source),ready,P1,
/se/solceller/uppsala-lan/uppsala,city,sv,Solceller i Uppsala – lönar det sig 2026?,x,x,x,one_dwelling_share_pct SE121 (44.1%);owner_occupied_share_pct SE12 (42.3%),ready,P1,
`;
  it('reads the NUTS codes from pages.csv and the name from the title', () => {
    expect(parsePackPlaces('SE', PAGES)).toEqual([
      { country: 'SE', regionSlug: 'stockholms-lan', slug: 'stockholm', name: 'Stockholm', nuts3: 'SE110', nuts2: 'SE11' },
      { country: 'SE', regionSlug: 'uppsala-lan', slug: 'uppsala', name: 'Uppsala', nuts3: 'SE121', nuts2: 'SE12' },
    ]);
  });

  it('copies the NUTS3 / NUTS2 figures onto the place with scope region and the region name (code stripped)', () => {
    const places = parsePackPlaces('SE', PAGES);
    const rows = [
      pf({ key: 'one_dwelling_share_pct', region: 'Stockholms län (SE110)', value: '27.6', valid_from: '2021-01-01', valid_to: '2021-12-31' }),
      pf({ key: 'owner_occupied_share_pct', region: 'Stockholm (SE11)', value: '25.2', valid_from: '2021-01-01', valid_to: '2021-12-31' }),
      pf({ key: 'one_dwelling_share_pct', region: 'Uppsala län (SE121)', value: '44.1' }),
      pf({ key: 'one_dwelling_share_pct', region: 'no code here', value: '1' }),
    ];
    const r = mapPackFacts('SE', places, rows, [], { regionNames: {} });
    const s = r.facts.filter((f) => f.place === 'SE/stockholms-lan/stockholm');
    expect(s.map((f) => [f.key, f.value_num, f.scope, f.scope_label, f.period])).toEqual([
      ['owner_occupied_share_pct', 25.2, 'region', 'Stockholm', '2021-01-01/2021-12-31'],
      ['one_dwelling_share_pct', 27.6, 'region', 'Stockholms län', '2021-01-01/2021-12-31'],
    ]);
    expect(r.facts.filter((f) => f.place === 'SE/uppsala-lan/uppsala')).toHaveLength(1);
    expect(r.skipped['no NUTS code']).toBe(1);
  });

  it('files fetched yield under city:<slug> and covers every Nordic / CEE country', () => {
    expect(placeLocator({ country: 'PL', regionSlug: 'malopolskie', slug: 'krakow', name: 'Kraków' })).toBe('city:krakow');
    expect([...NUTS_COUNTRIES].sort()).toEqual(['CZ', 'DK', 'FI', 'NO', 'PL', 'RO', 'SE']);
  });

  it('parses the title patterns of each language', () => {
    const t = (cc: 'DK' | 'NO' | 'FI' | 'PL' | 'CZ' | 'RO' | 'ES', title: string, topic: string) => parsePackPlaces(cc, `url,page_type,title,unique_data_sections\n/${cc.toLowerCase()}/${topic}/r/c,city,"${title}",x\n`)[0]!.name;
    expect(t('DK', 'Solceller i København – kan det betale sig?', 'solceller')).toBe('København');
    expect(t('NO', 'Solceller i Tromsø – lønner det seg?', 'solceller')).toBe('Tromsø');
    expect(t('FI', 'Aurinkopaneelit Hämeenlinna – kannattaako?', 'aurinkopaneelit')).toBe('Hämeenlinna');
    expect(t('PL', 'Fotovoltaika Kraków – czy się opłaca?', 'fotovoltaika')).toBe('Kraków');
    expect(t('CZ', 'Fotovoltaika České Budějovice – vyplatí se?', 'fotovoltaika')).toBe('České Budějovice');
    expect(t('RO', 'Panouri fotovoltaice Cluj-Napoca – merită?', 'panouri-fotovoltaice')).toBe('Cluj-Napoca');
    expect(t('ES', 'Placas solares en Almería: ahorro, IBI y rendimiento', 'placas-solares')).toBe('Almería');
  });
});

describe('Ireland: county pages and towns', () => {
  const PAGES = `url,page_type,language,title,target_query,intent,tone,unique_data_sections,data_status,priority,notes
/ie/solar-payback/dublin,region,en,Is solar worth it in County Dublin? Payback ranges 2026,x,x,x,x,ready,P1,
/ie/solar-payback/dublin/dublin-city,city,en,Is solar worth it in Dublin city? Payback ranges 2026,x,x,x,x,ready,P1,
/ie/solar-payback/dublin/swords,city,en,Is solar worth it in Swords? Payback ranges 2026,x,x,x,x,ready,P2,
/ie/solar-payback,calculator,en,Calculator,x,x,x,x,ready,P1,
`;
  const places = parsePackPlaces('IE', PAGES);
  it('county rows become places whose slug is the region slug; towns are files under <county>/<town>', () => {
    expect(places.map((p) => [p.regionSlug, p.slug, p.name])).toEqual([['dublin', 'dublin', 'County Dublin'], ['dublin', 'dublin-city', 'Dublin City'], ['dublin', 'swords', 'Swords']]);
    expect(places.map(placeLocator)).toEqual(['dublin', 'dublin/dublin-city', 'dublin/swords']);
  });

  const region: PlaceRegion = { country: 'IE', code: 'D', name: 'Dublin', slug: 'dublin' };
  const facts = [fact('solar_yield_kwh_per_kwp'), fact('homeownership_pct'), fact('solar_pv_households_pct'), fact('house_share_pct')];
  const mk = (slug: string, name: string, published = true): PlaceWithFacts => ({ id: slug, country: 'IE', region_code: 'D', slug, name, lat: null, lon: null, published, updated_at: null, place_facts: facts });
  const data = { regions: [region], places: [mk('dublin', 'County Dublin'), mk('dublin-city', 'Dublin City'), mk('swords', 'Swords')] };

  it('the hub URL serves the county page; a town one level down serves the town; the county one level down is a 404', () => {
    const hub = resolvePlaceRoute({ cc: 'ie', topic: 'solar-payback', region: 'dublin' }, data);
    expect(hub.kind).toBe('place');
    if (hub.kind === 'place') { expect(hub.view.path).toBe('/ie/solar-payback/dublin'); expect(hub.view.isRegionPage).toBe(true); expect(hub.view.sections.map((s) => s.id)).toEqual(['yield', 'ownership', 'installs', 'dwellings']); }
    expect(resolvePlaceRoute({ cc: 'ie', topic: 'solar-payback', region: 'dublin', city: 'swords' }, data).kind).toBe('place');
    expect(resolvePlaceRoute({ cc: 'ie', topic: 'solar-payback', region: 'dublin', city: 'dublin' }, data).kind).toBe('not_found');
  });

  it('an unpublished county falls back to the list (needs 3 renderable places) and never leaks', () => {
    const d = { regions: [region], places: [mk('dublin', 'County Dublin', false), mk('dublin-city', 'Dublin City'), mk('swords', 'Swords')] };
    expect(resolvePlaceRoute({ cc: 'ie', topic: 'solar-payback', region: 'dublin' }, d).kind).toBe('not_found');
  });

  it('the sitemap lists the county page once (no separate hub for the same URL) and the towns', () => {
    const paths = placeIndexEntries([region], data.places).map((e) => e.path).sort();
    expect(paths).toEqual(['/ie/solar-payback/dublin', '/ie/solar-payback/dublin/dublin-city', '/ie/solar-payback/dublin/swords']);
  });
});

describe('end-to-end dry run on a synthetic Spanish pack', () => {
  const PAGES = `url,page_type,language,title,target_query,intent,tone,unique_data_sections,data_status,priority,notes
/es/placas-solares/andalucia/almeria,city,es,"Placas solares en Almería: ahorro, IBI y rendimiento",x,x,x,x,needs_source,P2,
/es/placas-solares/andalucia/cadiz,city,es,"Placas solares en Cádiz: ahorro, IBI y rendimiento",x,x,x,x,needs_source,P2,
`;
  const factsCsv = [
    'key,region,value,unit,valid_from,valid_to,source_url,publisher,retrieved_on,excerpt,confidence',
    'solar_yield_kwh_per_kwp,almeria,1723,kWh,,,https://re.jrc.ec.europa.eu/x,PVGIS,2026-11-22,e,primary',
    'homeownership_pct,almeria,73.1,%,2021-01-01,,https://www.ine.es/a,INE,2026-11-22,04013 Almería: En propiedad 1 of 2,primary',
    'household_net_income_avg,almeria,37081,EUR,2024-01-01,2024-12-31,https://www.ine.es/b,INE,2026-11-22,04013 Almería: x,primary',
    'solar_yield_kwh_per_kwp,cadiz,1707,kWh,,,https://re.jrc.ec.europa.eu/y,PVGIS,2026-11-22,e,primary',
    'homeownership_pct,cadiz,75.6,%,2021-01-01,,https://www.ine.es/a,INE,2026-11-22,11012 Cádiz: En propiedad 1 of 2,primary',
  ].join('\n');
  it('a place with only two sourced sections fails the gate, one with three passes', () => {
    const regions = [{ country: 'ES', code: 'AN', name: 'Andalucía', slug: 'andalucia' }];
    const plan = planCountry('ES', parsePackPlaces('ES', PAGES), regions, packFactsFromCsv(factsCsv), [], []);
    expect(plan.gate).toMatchObject({ places: 2, pass: 1, fail: 1 });
    expect(plan.places[0]).toMatchObject({ country: 'ES', region_code: 'AN', lat: null, coord_source_url: null });
  });
});

describe('migration 0034', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0034_places_europe.sql'), 'utf8');
  const regions = regionsFromMigration(sql);
  it('seeds a market per country (no VAT, unpublished, pvgis) and every region unpublished with a unique code and slug', () => {
    for (const cc of EUROPE) expect(sql).toMatch(new RegExp(`\\('${cc}',\\s+'[^']+',\\s+'[A-Z]{3}', '[a-z]{2}-[A-Z]{2}', '[a-z]{2}', 'pvgis', 'N', null, false\\)`));
    expect(sql).not.toMatch(/vat_rate/);
    expect(new Set(regions.map((r) => `${r.country}/${r.code}`)).size).toBe(regions.length);
    expect(new Set(regions.map((r) => `${r.country}/${r.slug}`)).size).toBe(regions.length);
    expect(sql.match(/, false\)/g)!.length).toBe(regions.length + EUROPE.length);
    expect(regions.every((r) => /^[A-Z0-9-]{1,8}$/.test(r.code))).toBe(true);
  });
  it('has the regions each pack uses (ES 17, IE 13, SE 18, DK 5, NO 11, FI 15, PL 16, CZ 14, RO 16)', () => {
    const n = (cc: string) => regions.filter((r) => r.country === cc).length;
    expect([n('ES'), n('IE'), n('SE'), n('DK'), n('NO'), n('FI'), n('PL'), n('CZ'), n('RO')]).toEqual([17, 13, 18, 5, 11, 15, 16, 14, 16]);
    expect(regions.find((r) => r.slug === 'andalucia')).toMatchObject({ country: 'ES', code: 'AN', name: 'Andalucía' });
  });
});
