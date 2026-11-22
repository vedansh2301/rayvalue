import { describe, expect, it } from 'vitest';
import { mapPackFacts, networkDisplayName, packFactsFromCsv, parsePackPlaces, periodOf, placeLocator, regionsFromMigration, slugify, type PackFact } from './pack';
import { coordsFromCsv, planCountry } from './import-plan';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pf = (over: Partial<PackFact>): PackFact => ({ key: 'homeownership_pct', region: 'newcastle-upon-tyne', value: '49.2', unit: '% of households', valid_from: '2021-03-21', valid_to: '', source_url: 'https://example.org/s', publisher: 'ONS', retrieved_on: '2026-11-22', excerpt: 'text', confidence: 'primary', ...over });

const PAGES = `url,page_type,language,title,target_query,intent,tone,unique_data_sections,data_status,priority,notes
/uk/solar-panels/north-east,region,en-GB,x,x,x,x,x,ready,P1,
/uk/solar-panels/north-east/newcastle-upon-tyne,city,en-GB,Are solar panels worth it in Newcastle upon Tyne?,x,x,x,x,ready,P2,
/uk/solar-panels/north-east/sunderland,city,en-GB,Are solar panels worth it in Sunderland?,x,x,x,x,ready,P2,
`;

describe('parsePackPlaces', () => {
  it('reads city rows only, with region slug, slug and the name from the title', () => {
    expect(parsePackPlaces('GB', PAGES)).toEqual([
      { country: 'GB', regionSlug: 'north-east', slug: 'newcastle-upon-tyne', name: 'Newcastle upon Tyne' },
      { country: 'GB', regionSlug: 'north-east', slug: 'sunderland', name: 'Sunderland' },
    ]);
  });

  it('parses the German and Australian title patterns and falls back to the slug', () => {
    const de = 'url,page_type,title\n/de/photovoltaik/bayern/muenchen,city,"Photovoltaik in München: lohnt sich eine Solaranlage?"\n/de/photovoltaik/bayern/hof,city,Irgendwas\n';
    expect(parsePackPlaces('DE', de).map((p) => p.name)).toEqual(['München', 'Hof']);
    const au = 'url,page_type,title\n/au/solar-payback/nsw/sydney,city,"Solar payback in Sydney: yield, uptake and local numbers"\n';
    expect(parsePackPlaces('AU', au)[0]!.name).toBe('Sydney');
  });
});

describe('locators and small helpers', () => {
  it('files city facts where each pack does', () => {
    const p = { regionSlug: 'nsw', slug: 'sydney', name: 'Sydney' };
    expect(placeLocator({ country: 'AU', ...p })).toBe('nsw/sydney');
    expect(placeLocator({ country: 'GB', ...p })).toBe('sydney');
    expect(placeLocator({ country: 'DE', ...p })).toBe('city:sydney');
  });
  it('slugify / periodOf / networkDisplayName', () => {
    expect(slugify('Merseyside and Northern Wales')).toBe('merseyside-and-northern-wales');
    expect(slugify('Yorkshire')).toBe('yorkshire');
    expect(periodOf('', '')).toBe('');
    expect(periodOf('2021-03-21', '')).toBe('2021-03-21');
    expect(periodOf('2021-03-21', '2021-03-21')).toBe('2021-03-21');
    expect(periodOf('2026-10-01', '2026-12-31')).toBe('2026-10-01/2026-12-31');
    expect(networkDisplayName('sa-power-networks')).toBe('SA Power Networks');
    expect(networkDisplayName('some-new-network')).toBe('Some New Network');
  });
});

describe('mapPackFacts', () => {
  const places = [{ country: 'GB' as const, regionSlug: 'north-east', slug: 'newcastle-upon-tyne', name: 'Newcastle upon Tyne' }];
  const opts = { regionNames: { 'north-east': 'North East' } };

  it('imports only facts with a source_url, a value and a date; counts what it skips', () => {
    const r = mapPackFacts('GB', places, [pf({}), pf({ source_url: '' }), pf({ value: '' }), pf({ retrieved_on: '' }), pf({ key: 'not_a_page_key' })], [], opts);
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0]).toMatchObject({ place: 'GB/north-east/newcastle-upon-tyne', key: 'homeownership_pct', value_num: 49.2, value_text: null, period: '2021-03-21', scope: 'place', confidence: 'primary', status: 'agent_sourced', verified_on: '2026-11-22' });
    expect(r.skipped).toMatchObject({ 'no source_url': 1, 'no value': 1, 'no retrieved_on date': 1, 'key not shown on place pages': 1 });
  });

  it('keeps secondary confidence flagged', () => {
    const r = mapPackFacts('GB', places, [pf({ confidence: 'secondary' })], [], opts);
    expect(r.facts[0]!.confidence).toBe('secondary');
  });

  it('stores non-numeric values as text and de-duplicates', () => {
    const r = mapPackFacts('GB', places, [pf({ key: 'price_cap_region', value: 'North Eastern England', unit: 'Ofgem cap region' }), pf({}), pf({})], [], opts);
    expect(r.facts.find((f) => f.key === 'price_cap_region')).toMatchObject({ value_num: null, value_text: 'North Eastern England' });
    expect(r.facts.filter((f) => f.key === 'homeownership_pct')).toHaveLength(1);
    expect(r.skipped.duplicate).toBe(1);
  });

  it('GB: copies the price-cap region rates and the regional install cost onto the place, with scope + label', () => {
    const rows = [
      pf({ key: 'price_cap_region', value: 'North Eastern England', unit: 'x' }),
      pf({ key: 'price_cap_unit_rate_dd', region: 'cap-north-eastern-england', value: '25.46', unit: 'p/kWh (no VAT)', valid_from: '2026-10-01', valid_to: '2026-12-31' }),
      pf({ key: 'price_cap_unit_rate_dd', region: 'newcastle-upon-tyne', value: '25.46', unit: 'p/kWh (no VAT)', valid_from: '2026-10-01', valid_to: '2026-12-31' }),
      pf({ key: 'avg_install_cost_per_kw_4_10kw_mean', region: 'north-east', value: '1540.15', unit: 'GBP/kW (TIC)', valid_from: '2025-04-01', valid_to: '2026-03-31' }),
    ];
    const r = mapPackFacts('GB', places, rows, [], opts);
    const cap = r.facts.filter((f) => f.key === 'price_cap_unit_rate_dd');
    expect(cap).toHaveLength(1);
    expect(cap[0]).toMatchObject({ scope: 'region', scope_label: 'North Eastern England', period: '2026-10-01/2026-12-31' });
    expect(r.facts.find((f) => f.key === 'avg_install_cost_per_kw_4_10kw_mean')).toMatchObject({ scope: 'region', scope_label: 'North East', value_num: 1540.15 });
  });

  it('AU: attaches the network tariff to the place with the network name as label', () => {
    const au = [{ country: 'AU' as const, regionSlug: 'nsw', slug: 'sydney', name: 'Sydney' }];
    const rows = [
      pf({ key: 'network_for_place', region: 'nsw/sydney', value: 'ausgrid', unit: 'DMO distribution zone' }),
      pf({ key: 'dmo_annual_price_flat', region: 'nsw/ausgrid', value: '1899', unit: 'AUD/yr incl GST', valid_from: '2026-07-01', valid_to: '2027-06-30' }),
    ];
    const r = mapPackFacts('AU', au, rows, [], { regionNames: {} });
    expect(r.facts.find((f) => f.key === 'network_for_place')).toMatchObject({ value_text: 'Ausgrid' });
    expect(r.facts.find((f) => f.key === 'dmo_annual_price_flat')).toMatchObject({ scope: 'network', scope_label: 'Ausgrid', value_num: 1899 });
  });

  it('fetched PVGIS rows replace the pack yield rows (annual and monthly, period m01..m12)', () => {
    const own = pf({ key: 'solar_yield_kwh_per_kwp', value: '900', unit: 'kWh/kWp/yr', valid_from: '' });
    const fetched = [
      pf({ key: 'solar_yield_kwh_per_kwp', value: '955.8', unit: 'kWh/kWp/yr', valid_from: '' }),
      pf({ key: 'solar_yield_monthly_kwh_per_kwp', value: '42.7', unit: 'kWh/kWp (month 1)', valid_from: '' }),
      pf({ key: 'solar_yield_monthly_kwh_per_kwp', value: '99', unit: 'kWh/kWp (month 12)', valid_from: '' }),
    ];
    const r = mapPackFacts('GB', places, [own], fetched, opts);
    expect(r.facts.filter((f) => f.key === 'solar_yield_kwh_per_kwp').map((f) => f.value_num)).toEqual([955.8]);
    expect(r.facts.filter((f) => f.key === 'solar_yield_monthly_kwh_per_kwp').map((f) => f.period)).toEqual(['m01', 'm12']);
    expect(r.skipped['replaced by fetched rows']).toBe(1);
  });
});

describe('planCountry (dry-run gate report)', () => {
  const regions = [{ country: 'GB', code: 'NE', name: 'North East', slug: 'north-east' }];
  const facts = [
    pf({ key: 'solar_yield_kwh_per_kwp', unit: 'kWh/kWp/yr', value: '955', valid_from: '' }),
    pf({ key: 'homeownership_pct' }),
    pf({ key: 'pv_installations_cumulative', value: '5523', unit: 'installations' }),
    pf({ key: 'homeownership_pct', region: 'sunderland' }),
  ];
  it('counts a place as passing only with >= 3 sourced sections; reports coordinates and unknown regions', () => {
    const plan = planCountry('GB', parsePackPlaces('GB', PAGES), regions, facts, [], coordsFromCsv('region,slug,lat,lon,source_url\nnorth-east,newcastle-upon-tyne,54.97,-1.61,https://en.wikipedia.org/wiki/Newcastle\n'));
    expect(plan.gate).toMatchObject({ places: 2, pass: 1, fail: 1 });
    expect(plan.places[0]).toMatchObject({ region_code: 'NE', lat: 54.97, lon: -1.61, coord_source_url: 'https://en.wikipedia.org/wiki/Newcastle' });
    expect(plan.places[1]).toMatchObject({ lat: null, lon: null, coord_source_url: null });
    expect(planCountry('GB', parsePackPlaces('GB', PAGES), [], facts, [], []).unknownRegion).toHaveLength(2);
  });

  it('coordinates without an http source are dropped (the table requires a source)', () => {
    const plan = planCountry('GB', parsePackPlaces('GB', PAGES), regions, [], [], coordsFromCsv('region,slug,lat,lon,source_url\nnorth-east,sunderland,54.9,-1.4,\n'));
    expect(plan.places[1]).toMatchObject({ lat: null, coord_source_url: null });
  });
});

describe('packFactsFromCsv / regionsFromMigration', () => {
  it('reads facts.csv columns', () => {
    const csv = 'key,region,value,unit,valid_from,valid_to,source_url,publisher,retrieved_on,excerpt,confidence\nk,r,1,u,,,https://x.org,P,2026-11-22,e,primary\n';
    expect(packFactsFromCsv(csv)[0]).toMatchObject({ key: 'k', region: 'r', value: '1', source_url: 'https://x.org', confidence: 'primary' });
  });

  it('migration 0033 seeds the regions the packs use (GB 12, DE 16, AU 8)', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0033_places.sql'), 'utf8');
    const r = regionsFromMigration(sql);
    expect(r.filter((x) => x.country === 'GB')).toHaveLength(12);
    expect(r.filter((x) => x.country === 'DE')).toHaveLength(16);
    expect(r.filter((x) => x.country === 'AU')).toHaveLength(8);
    expect(r.find((x) => x.slug === 'baden-wuerttemberg')).toMatchObject({ country: 'DE', code: 'BW', name: 'Baden-Württemberg' });
    expect(new Set(r.map((x) => `${x.country}/${x.code}`)).size).toBe(r.length);
  });
});
