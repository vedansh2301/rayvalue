/**
 * Schema behaviour on SYNTHETIC records (the real values live in Supabase; `npm run db:check`
 * validates those with these same schemas). Plus sanity checks of the bundled ZIP reference data.
 */
import { describe, expect, it } from 'vitest';
import { caFixture, clone, fixtureAssumptions, fixtureCosts, flMinimum, flSeasonal, flTwoTier } from '../lib/calc/test-fixtures';
import {
  AssumptionsSchema,
  CitiesFileSchema,
  CitiesSchema,
  CityProductionSchema,
  CitySchema,
  CostsSchema,
  OfferSchema,
  UtilitiesSchema,
  zipMeta,
  zips,
} from './index';

const utilities = () => clone([flTwoTier, flSeasonal, { ...flMinimum, minimum_bill_basis: null, minimum_monthly_bill: null }, caFixture]) as any[];

const city = (over: Record<string, unknown> = {}) => ({
  slug: 'fixture-town',
  name: 'Fixture Town',
  state: 'FL',
  lat: 25.5,
  lon: -80.5,
  coords_zcta: '33000',
  default_utility_id: 'fpl',
  utility_source_url: 'https://example.com/served',
  utility_source_note: 'synthetic',
  utility_confidence: 'city',
  published: false,
  ...over,
});

const production = (over: Record<string, unknown> = {}) => ({
  state: 'FL',
  slug: 'fixture-town',
  losses: 14,
  annual_kwh_per_kw: 1200,
  monthly_kwh_per_kw: Array(12).fill(100),
  fetched_on: '2026-01-01',
  source_url: 'https://example.com/docs',
  endpoint: 'https://example.com/api',
  params: { tilt: 20, dataset: 'x' },
  dataset_note: 'synthetic',
  key_kind: 'api_key',
  ...over,
});

describe('synthetic fixtures are valid', () => {
  it('parse', () => {
    expect(UtilitiesSchema.safeParse(utilities()).success).toBe(true);
    expect(CostsSchema.safeParse(fixtureCosts).success).toBe(true);
    expect(AssumptionsSchema.safeParse(fixtureAssumptions).success).toBe(true);
  });
  it('cities default local_notes to [] and intro_md to null', () => {
    expect(CitySchema.parse(city())).toMatchObject({ local_notes: [], intro_md: null });
    expect(CitySchema.parse(city({ local_notes: ['a'], intro_md: '# Hi' }))).toMatchObject({ local_notes: ['a'], intro_md: '# Hi' });
  });
});

describe('schemas reject bad data', () => {
  it('rejects descending tiers', () => {
    const bad = utilities();
    bad[0].tier_sets[0].tiers = [
      { up_to_kwh: 1500, rate_per_kwh: 0.12, base_rate_per_kwh: null },
      { up_to_kwh: 1000, rate_per_kwh: 0.13, base_rate_per_kwh: null },
      { up_to_kwh: null, rate_per_kwh: 0.14, base_rate_per_kwh: null },
    ];
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a last tier with a ceiling', () => {
    const bad = utilities();
    bad[0].tier_sets[0].tiers = [{ up_to_kwh: 1000, rate_per_kwh: 0.12, base_rate_per_kwh: null }];
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects numbers without a source, unverified numbers and malformed dates', () => {
    for (const patch of [{ source_url: null }, { verification: 'unverified' }, { verified_on: '22/10/2026' }]) {
      const bad = utilities();
      Object.assign(bad[0], patch);
      expect(UtilitiesSchema.safeParse(bad).success, JSON.stringify(patch)).toBe(false);
    }
  });

  it('rejects an FL utility with an export credit', () => {
    const bad = utilities();
    bad[0].avg_export_credit_per_kwh = 0.05;
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects inconsistent minimum-bill fields', () => {
    const caMin = utilities();
    caMin[3].minimum_bill_basis = 'none';
    expect(UtilitiesSchema.safeParse(caMin).success).toBe(false);
    const amountWithoutBasis = utilities();
    amountWithoutBasis[2].minimum_monthly_bill = 30; // basis is null
    expect(UtilitiesSchema.safeParse(amountWithoutBasis).success).toBe(false);
    const baseAboveAllIn = utilities();
    baseAboveAllIn[0].tier_sets[0].tiers[0].base_rate_per_kwh = 0.5;
    expect(UtilitiesSchema.safeParse(baseAboveAllIn).success).toBe(false);
  });

  it('rejects duplicate utility ids', () => {
    const bad = utilities();
    bad[1].id = bad[0].id;
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects tier sets that leave a month uncovered or double-covered', () => {
    const gap = utilities();
    gap[1].tier_sets[1].months = [12, 1];
    expect(UtilitiesSchema.safeParse(gap).success).toBe(false);
    const overlap = utilities();
    overlap[1].tier_sets[1].months = [12, 1, 2, 3];
    expect(UtilitiesSchema.safeParse(overlap).success).toBe(false);
  });

  it('rejects a tiered utility with no tier sets and a TOU utility without its average-rate record', () => {
    const noSets = utilities();
    noSets[0].tier_sets = null;
    expect(UtilitiesSchema.safeParse(noSets).success).toBe(false);
    const noAvg = utilities();
    noAvg[3].avg_rate_per_kwh = null;
    expect(UtilitiesSchema.safeParse(noAvg).success).toBe(false);
  });

  it('rejects a TOU rate with an unknown period or an avg_rate record without a source', () => {
    const badPeriod = utilities();
    badPeriod[3].tou_rates[0].period = 'sunrise';
    expect(UtilitiesSchema.safeParse(badPeriod).success).toBe(false);
    const noSrc = utilities();
    noSrc[3].avg_rate_per_kwh.source_url = null;
    expect(UtilitiesSchema.safeParse(noSrc).success).toBe(false);
  });

  it('rejects a cost range out of order and a record with no numbers that still claims a source', () => {
    const bad = clone(fixtureCosts) as any;
    bad.FL.installed_cost_per_watt.low = 6;
    expect(CostsSchema.safeParse(bad).success).toBe(false);
    const bad2 = clone(fixtureCosts) as any;
    Object.assign(bad2.FL.battery_installed_cost, { low: null, likely: null, high: null });
    expect(CostsSchema.safeParse(bad2).success).toBe(false);
    const missing = clone(fixtureCosts) as any;
    delete missing.CA.battery_installed_cost;
    expect(CostsSchema.safeParse(missing).success).toBe(false);
  });

  it('rejects an assumption without a rationale, with a stray source_url, or missing entirely', () => {
    const bad = clone(fixtureAssumptions) as any;
    delete bad.analysis_years.rationale;
    expect(AssumptionsSchema.safeParse(bad).success).toBe(false);
    const bad2 = clone(fixtureAssumptions) as any;
    bad2.analysis_years.source_url = 'https://example.com';
    expect(AssumptionsSchema.safeParse(bad2).success).toBe(false);
    const bad3 = clone(fixtureAssumptions) as any;
    delete bad3.max_monthly_bill;
    expect(AssumptionsSchema.safeParse(bad3).success).toBe(false);
  });

  it('rejects bad cities and duplicate slugs', () => {
    expect(CitySchema.safeParse(city({ utility_confidence: 'maybe' })).success).toBe(false);
    expect(CitySchema.safeParse(city({ default_utility_id: 'nope' })).success).toBe(false);
    expect(CitySchema.safeParse(city({ slug: 'Not Kebab' })).success).toBe(false);
    expect(CitiesSchema.safeParse([city(), city()]).success).toBe(false);
    expect(CitiesSchema.safeParse([city(), city({ state: 'CA', default_utility_id: 'pge' })]).success).toBe(true);
    const file = { coordinates_source: { description: 'x', source_url: 'https://example.com', verified_on: '2026-01-01' }, cities: [city(), city()] };
    expect(CitiesFileSchema.safeParse(file).success).toBe(false);
  });

  it('validates production rows', () => {
    expect(CityProductionSchema.safeParse(production()).success).toBe(true);
    expect(CityProductionSchema.safeParse(production({ monthly_kwh_per_kw: Array(11).fill(100) })).success).toBe(false);
    expect(CityProductionSchema.safeParse(production({ annual_kwh_per_kw: 1500 })).success).toBe(false); // months sum to 1200
    expect(CityProductionSchema.safeParse(production({ key_kind: 'other' })).success).toBe(false);
  });

  it('validates offers: an active offer needs an https url', () => {
    const o = { state: 'FL', partner_name: 'Fixture Partner', url: null, cta_text: 'Get quotes', active: false };
    expect(OfferSchema.safeParse(o).success).toBe(true);
    expect(OfferSchema.safeParse({ ...o, active: true }).success).toBe(false);
    expect(OfferSchema.safeParse({ ...o, active: true, url: 'http://example.com' }).success).toBe(false);
    expect(OfferSchema.safeParse({ ...o, active: true, url: 'https://example.com/x' }).success).toBe(true);
  });
});

describe('bundled ZIP reference data', () => {
  it('zip maps look sane', () => {
    expect(Object.keys(zips.FL).length).toBeGreaterThan(900);
    expect(Object.keys(zips.CA).length).toBeGreaterThan(1500);
    expect(zipMeta.fl_count).toBe(Object.keys(zips.FL).length);
    expect(zipMeta.ca_count).toBe(Object.keys(zips.CA).length);
    expect(Object.keys(zips.FL).every((z) => /^3[2-4]\d{3}$/.test(z))).toBe(true);
    expect(Object.keys(zips.CA).every((z) => /^(9[0-5]\d{3}|96[01]\d{2})$/.test(z))).toBe(true);
  });
});
