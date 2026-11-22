import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLACE_COUNTRIES, PLACE_PATH_RE, placeCountryByCode, placeCountryForRoute, placePath, regionHubPath } from './config';
import { ALLOWED_KEYS, SECTION_KEYS, evaluatePlace } from './gate';
import { planCountry } from './import-plan';
import { PLACE_TEXT } from './i18n';
import { mapPackFacts, packFactsFromCsv, parsePackPlaces, regionsFromMigration } from './pack';
import { fact, monthlyFacts } from './test-fixtures';
import { buildPlaceView } from './view';

const HEADER = 'key,region,value,unit,valid_from,valid_to,source_url,publisher,retrieved_on,excerpt,confidence';
const FR_PAGES = [
  'url,page_type,title,unique_data_sections',
  '/fr/panneaux-solaires/normandie/le-havre,city,Panneaux solaires a Le Havre : production et rentabilite,x',
  '/fr/panneaux-solaires/occitanie/nimes,city,Panneaux solaires a Nîmes : production et rentabilite,x',
  '/fr/panneaux-solaires/occitanie,region,Panneaux solaires en Occitanie : rentabilite 2026,x',
].join('\n');
const NL_PAGES = [
  'url,page_type,title,unique_data_sections',
  '/nl/zonnepanelen/friesland/sneek,city,Zonnepanelen Súdwest-Fryslân (Sneek): opbrengst en terugverdientijd,x',
  "/nl/zonnepanelen/noord-brabant/s-hertogenbosch,city,Zonnepanelen 's-Hertogenbosch: opbrengst en terugverdientijd,x",
  '/nl/zonnepanelen/groningen,region,Zonnepanelen in Groningen na 2027,x',
].join('\n');

describe('FR and NL configuration', () => {
  it('URL words, locale and article country', () => {
    expect(placePath(placeCountryByCode('FR')!, 'normandie', 'le-havre')).toBe('/fr/panneaux-solaires/normandie/le-havre');
    expect(placePath(placeCountryByCode('NL')!, 'friesland', 'sneek')).toBe('/nl/zonnepanelen/friesland/sneek');
    expect(regionHubPath(placeCountryByCode('NL')!, 'noord-holland')).toBe('/nl/zonnepanelen/noord-holland');
    expect(placeCountryByCode('FR')).toMatchObject({ locale: 'fr-FR', htmlLang: 'fr', currency: 'EUR', articleCountry: 'fr' });
    expect(placeCountryByCode('NL')).toMatchObject({ locale: 'nl-NL', htmlLang: 'nl', currency: 'EUR', articleCountry: 'nl' });
    expect(placeCountryForRoute('fr', 'panneaux-solaires')?.code).toBe('FR');
    expect(placeCountryForRoute('fr', 'zonnepanelen')).toBeNull();
    expect(PLACE_PATH_RE.test('/nl/zonnepanelen/friesland/sneek')).toBe(true);
    expect(PLACE_PATH_RE.test('/fr/panneaux-solaires/normandie')).toBe(true);
  });
});

describe('FR and NL gate: yield + ownership + dwellings (+ installs), primary facts only', () => {
  it.each(['FR', 'NL'] as const)('%s: four sections', (cc) => {
    expect(SECTION_KEYS[cc].map((s) => s.id)).toEqual(['yield', 'ownership', 'dwellings', 'installs']);
    expect(ALLOWED_KEYS[cc]).toEqual(expect.arrayContaining(['owner_occupied_share_pct', 'house_share_pct', 'pv_installations_cumulative', 'pv_capacity_mw_cumulative']));
  });
  it.each(['FR', 'NL'] as const)('%s: two sections fail, three pass, a secondary fact does not count', (cc) => {
    const base = [fact('solar_yield_kwh_per_kwp', { value_num: 1100 }), fact('owner_occupied_share_pct', { value_num: 50 })];
    expect(evaluatePlace(cc, { published: true, place_facts: base }).renders).toBe(false);
    expect(evaluatePlace(cc, { published: true, place_facts: [...base, fact('house_share_pct', { value_num: 40, confidence: 'secondary' })] }).renders).toBe(false);
    expect(evaluatePlace(cc, { published: true, place_facts: [...base, fact('house_share_pct', { value_num: 40 })] }).renders).toBe(true);
    expect(evaluatePlace(cc, { published: true, place_facts: [fact('solar_yield_kwh_per_kwp'), fact('owner_occupied_share_pct'), fact('pv_installations_cumulative')] }).sections).toEqual(['yield', 'ownership', 'installs']);
    expect(evaluatePlace(cc, { published: false, place_facts: [...base, fact('house_share_pct')] }).renders).toBe(false);
  });
});

describe('FR and NL pack mapping', () => {
  it('names come from the page titles (accents and the gemeente-and-town form kept); region pages are not places', () => {
    expect(parsePackPlaces('FR', FR_PAGES).map((p) => [p.regionSlug, p.slug, p.name])).toEqual([['normandie', 'le-havre', 'Le Havre'], ['occitanie', 'nimes', 'Nîmes']]);
    expect(parsePackPlaces('NL', NL_PAGES).map((p) => [p.regionSlug, p.slug, p.name])).toEqual([['friesland', 'sneek', 'Súdwest-Fryslân (Sneek)'], ['noord-brabant', 's-hertogenbosch', "'s-Hertogenbosch"]]);
  });

  const row = (key: string, region: string, value: string, over: Partial<Record<string, string>> = {}): string =>
    [key, region, value, 'u', '2023', '', 'https://api.insee.fr/melodi/data/X', 'INSEE', '2026-11-22', 'e', over.confidence ?? 'primary'].join(',');

  it('imports a place-scoped figure per place, ignores national rows, and the dry-run gate counts the places', () => {
    const facts = packFactsFromCsv([
      HEADER,
      row('solar_yield_kwh_per_kwp', 'city:le-havre', '1150'),
      row('owner_occupied_share_pct', 'city:le-havre', '47.5'),
      row('house_share_pct', 'city:le-havre', '40.1'),
      row('pv_installations_cumulative', 'city:le-havre', '4021'),
      row('solar_yield_kwh_per_kwp', 'city:nimes', '1500'),
      row('owner_occupied_share_pct', 'city:nimes', '52'),
      row('homeownership_pct', 'FR', '61.4'),
    ].join('\n'));
    const places = parsePackPlaces('FR', FR_PAGES);
    const mapped = mapPackFacts('FR', places, facts, [], { regionNames: {} });
    expect(mapped.facts.filter((f) => f.place === 'FR/normandie/le-havre')).toHaveLength(4);
    expect(mapped.facts.every((f) => f.scope === 'place' && f.confidence === 'primary')).toBe(true);
    expect(mapped.skipped['key not shown on place pages']).toBe(1);
    const regions = [{ country: 'FR', code: 'NOR', name: 'Normandie', slug: 'normandie' }, { country: 'FR', code: 'OCC', name: 'Occitanie', slug: 'occitanie' }];
    const plan = planCountry('FR', places, regions, facts, [], []);
    expect(plan.gate).toMatchObject({ places: 2, pass: 1, fail: 1 });
  });
});

const sp = (t: string): string => t.replace(/[\s\u00a0\u202f]/g, ' ');

describe('FR and NL pages', () => {
  const mk = (cc: 'FR' | 'NL') => buildPlaceView({
    id: 'p', country: cc, region_code: 'R1', slug: 'x', name: cc === 'FR' ? 'Le Havre' : 'Sneek', lat: null, lon: null, published: true, updated_at: null,
    place_facts: [
      fact('solar_yield_kwh_per_kwp', { value_num: 1150.4, note: 'db=PVGIS-SARAH3;tilt=36;azimuth=180;loss=14' }), ...monthlyFacts(),
      fact('owner_occupied_share_pct', { value_num: 47.5, period: cc === 'FR' ? '2023' : '2026-01-01' }),
      fact('house_share_pct', { value_num: 40.1 }),
      fact('pv_installations_cumulative', { value_num: 12345 }),
      fact('pv_capacity_mw_cumulative', { value_num: 77.23 }),
    ],
  }, { country: cc, code: 'R1', name: cc === 'FR' ? 'Normandie' : 'Fryslân', slug: 'r' });

  it('renders every section with a label, in the page language, with locale number formats', () => {
    for (const cc of ['FR', 'NL'] as const) {
      const v = mk(cc)!;
      expect(v).not.toBeNull();
      expect(v.lang).toBe(placeCountryByCode(cc)!.htmlLang);
      expect(v.sections.map((s) => s.id)).toEqual(['yield', 'ownership', 'dwellings', 'installs']);
      for (const s of v.sections) expect(s.heading).not.toBe('');
      expect(v.keyNumbers.items.length).toBeGreaterThanOrEqual(3);
    }
    const fr = mk('FR')!;
    expect(fr.h1).toBe('Panneaux solaires : Le Havre');
    expect(sp(fr.sections[1]!.lines[0]!.value)).toBe('47,5 %');
    expect(fr.sections[1]!.lines[0]!.note).toContain('2023');
    expect(fr.sections[3]!.lines.map((l) => sp(l.value))).toEqual(['12 345 installations', '77,2 MW']);
    expect(fr.keyNumbers.answer).toContain('plein sud');
    const nl = mk('NL')!;
    expect(nl.h1).toBe('Zonnepanelen Sneek');
    expect(sp(nl.sections[1]!.lines[0]!.value)).toBe('47,5%');
    expect(nl.sections[3]!.lines.map((l) => l.value)).toEqual(['12.345 installaties', '77,2 MW']);
  });

  it('has text for every section and fact label it can print', () => {
    for (const cc of ['FR', 'NL'] as const) for (const k of ALLOWED_KEYS[cc].filter((x) => x !== 'solar_yield_monthly_kwh_per_kwp' && !['price_cap_region', 'network_for_place', 'separate_houses_postal_area'].includes(x))) {
      expect(PLACE_TEXT[cc].labels[k], `${cc} ${k}`).toBeTruthy();
    }
    expect(PLACE_COUNTRIES.map((c) => c.code)).toEqual(expect.arrayContaining(['FR', 'NL']));
  });
});

describe('migration 0036', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0036_places_fr_nl.sql'), 'utf8');
  const sql0034 = readFileSync(join(process.cwd(), 'supabase/migrations/0034_places_europe.sql'), 'utf8');
  const regions = regionsFromMigration(sql);
  it('seeds FR and NL markets (no VAT, unpublished, pvgis) and does not repeat a country seeded by 0033 / 0034', () => {
    for (const [cc, name, locale, lang] of [['FR', 'France', 'fr-FR', 'fr'], ['NL', 'Netherlands', 'nl-NL', 'nl']] as const) {
      expect(sql).toMatch(new RegExp(`\\('${cc}',\\s+'${name}',\\s+'EUR', '${locale}', '${lang}', 'pvgis', 'N', null, false\\)`));
      expect(sql0034).not.toContain(`('${cc}',`);
    }
    expect(sql).not.toMatch(/vat_rate/);
    expect(sql).toMatch(/on conflict \(code\) do nothing/);
    expect(sql).toMatch(/on conflict \(country, code\) do nothing/);
  });
  it('has the 13 French regions and 12 Dutch provinces, unpublished, with unique codes and slugs', () => {
    expect(regions.filter((r) => r.country === 'FR')).toHaveLength(13);
    expect(regions.filter((r) => r.country === 'NL')).toHaveLength(12);
    expect(new Set(regions.map((r) => `${r.country}/${r.code}`)).size).toBe(regions.length);
    expect(new Set(regions.map((r) => `${r.country}/${r.slug}`)).size).toBe(regions.length);
    expect(sql.match(/, false\)/g)!.length).toBe(regions.length + 2);
    expect(regions.every((r) => /^[A-Z0-9-]{1,8}$/.test(r.code))).toBe(true);
    expect(regions.find((r) => r.slug === 'provence-alpes-cote-d-azur')).toMatchObject({ name: "Provence-Alpes-Côte d'Azur" });
    expect(regions.find((r) => r.country === 'NL' && r.slug === 'friesland')).toMatchObject({ code: 'FR', name: 'Fryslân' });
  });
});
