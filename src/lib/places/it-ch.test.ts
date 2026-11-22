import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { placeCountryByCode, placePath } from './config';
import { ALLOWED_KEYS, evaluatePlace } from './gate';
import { PLACE_TEXT } from './i18n';
import { parsePackPlaces, regionsFromMigration } from './pack';
import { fact, monthlyFacts } from './test-fixtures';
import { buildPlaceView } from './view';

const sp = (t: string): string => t.replace(/[\s  ]/g, ' ');
const place = (cc: 'IT' | 'CH', facts: ReturnType<typeof fact>[]) => ({ id: 'p', country: cc, region_code: 'R1', slug: 'x', name: cc === 'IT' ? 'Torino' : 'Zürich', lat: null, lon: null, published: true, updated_at: null, place_facts: facts });
const region = (cc: 'IT' | 'CH') => ({ country: cc, code: 'R1', name: cc === 'IT' ? 'Piemonte' : 'Zürich', slug: 'r' });
const yieldFacts = [fact('solar_yield_kwh_per_kwp', { value_num: 1180, note: 'db=PVGIS-SARAH3;tilt=35;azimuth=180;loss=14' }), ...monthlyFacts()];
const SKIP = ['solar_yield_monthly_kwh_per_kwp', 'price_cap_region', 'network_for_place', 'separate_houses_postal_area'];

describe('Italy and Switzerland config', () => {
  it('URL patterns and locales', () => {
    expect(placePath(placeCountryByCode('IT')!, 'piemonte', 'torino')).toBe('/it/fotovoltaico/piemonte/torino');
    expect(placePath(placeCountryByCode('CH')!, 'zuerich', 'zuerich')).toBe('/ch/photovoltaik/zuerich/zuerich');
    expect(placeCountryByCode('CH')).toMatchObject({ currency: 'CHF', locale: 'de-CH', articleCountry: 'ch' });
  });
  it('parses pack names; French and Italian CH pages (6 segments) are not places', () => {
    const csv = 'url,page_type,title\n/ch/photovoltaik/zuerich/zuerich,city,Photovoltaik in Zuerich\n/ch/photovoltaik/st-gallen/st-gallen,city,Photovoltaik in St Gallen\n/ch/fr/photovoltaique/geneve/geneve,city,Photovoltaïque à Geneve\n';
    expect(parsePackPlaces('CH', csv).map((p) => p.name)).toEqual(['Zürich', 'St. Gallen']);
    expect(parsePackPlaces('IT', 'url,page_type,title\n/it/fotovoltaico/piemonte/torino,city,"Fotovoltaico a Torino: quanto rende e quando si ripaga"\n')[0]).toMatchObject({ slug: 'torino', name: 'Torino' });
  });
});

describe('Italy gate and page', () => {
  const owner = fact('owner_occupied_share_pct', { value_num: 69.1, period: '2019' });
  const house = fact('house_share_pct', { value_num: 11.8, period: '2021' });
  it('needs yield + ownership + dwellings (installs are not an Italian section)', () => {
    expect(evaluatePlace('IT', place('IT', [...yieldFacts, owner, house])).renders).toBe(true);
    expect(evaluatePlace('IT', place('IT', [...yieldFacts, owner])).renders).toBe(false);
    expect(evaluatePlace('IT', place('IT', [...yieldFacts, owner, fact('pv_installations_cumulative', { value_num: 5 })])).renders).toBe(false);
  });
  it('renders in Italian with locale formats', () => {
    const v = buildPlaceView(place('IT', [...yieldFacts, owner, house]), region('IT'))!;
    expect(v.sections.map((s) => s.id)).toEqual(['yield', 'ownership', 'dwellings']);
    expect(v.h1).toBe('Fotovoltaico a Torino');
    expect(sp(v.sections[1]!.lines[0]!.value)).toBe('69,1%');
  });
});

describe('Switzerland gate and page', () => {
  const tariff = fact('electricity_price_h4_rp_per_kwh', { value_num: 24.632, unit: 'Rp./kWh', period: '2027-01-01/2027-12-31' });
  const n = fact('pv_installations_cumulative', { value_num: 2597 });
  const mw = fact('pv_capacity_mw_cumulative', { value_num: 102.9 });
  it('needs yield + tariff + installs', () => {
    expect(evaluatePlace('CH', place('CH', [...yieldFacts, tariff, n, mw])).renders).toBe(true);
    expect(evaluatePlace('CH', place('CH', [...yieldFacts, tariff])).renders).toBe(false);
  });
  it('renders the ElCom tariff with its unit and has labels for every allowed key', () => {
    const v = buildPlaceView(place('CH', [...yieldFacts, tariff, n, mw]), region('CH'))!;
    expect(v.sections.map((s) => s.id)).toEqual(['yield', 'tariff', 'installs']);
    expect(v.sections[1]!.lines[0]!.value).toMatch(/24[.,]63 Rp\.\/kWh/);
    expect(sp(v.sections[2]!.lines[0]!.value)).toMatch(/2.?597 Anlagen/);
    for (const cc of ['CH', 'IT'] as const) for (const k of ALLOWED_KEYS[cc].filter((x) => !SKIP.includes(x))) expect(PLACE_TEXT[cc].labels[k], `${cc} ${k}`).toBeTruthy();
  });
});

describe('migration 0038', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0038_places_it_ch.sql'), 'utf8');
  const regions = regionsFromMigration(sql);
  it('seeds IT and CH markets (no VAT, unpublished) and 20 + 9 unpublished regions with unique codes and slugs', () => {
    expect(sql).toMatch(/\('IT',\s+'Italy',\s+'EUR', 'it-IT', 'it', 'pvgis', 'N', null, false\)/);
    expect(sql).toMatch(/\('CH',\s+'Switzerland',\s+'CHF', 'de-CH', 'de', 'pvgis', 'N', null, false\)/);
    expect(sql).not.toMatch(/vat_rate/);
    expect(regions.filter((r) => r.country === 'IT')).toHaveLength(20);
    expect(regions.filter((r) => r.country === 'CH')).toHaveLength(9);
    expect(new Set(regions.map((r) => `${r.country}/${r.code}`)).size).toBe(regions.length);
    expect(new Set(regions.map((r) => `${r.country}/${r.slug}`)).size).toBe(regions.length);
    expect(sql.match(/, false\)/g)!.length).toBe(regions.length + 2);
  });
});
