import { describe, expect, it } from 'vitest';
import { fixtureAssumptions, fixtureCosts, fixtureUtilities, clone } from '../calc/test-fixtures';
import { AssumptionsSchema, CitiesFileSchema, CitiesSchema, CityProductionListSchema, CostsSchema, UtilitiesSchema } from '../../data/schemas';
import {
  assumptionsFromRows,
  citiesFileFromRows,
  citiesFromRows,
  costsFromRows,
  offerFromRow,
  productionFromRow,
  toProductionInput,
  utilitiesFromRows,
  utilityFromRow,
} from './map';
import {
  fixtureAssumptionRows,
  fixtureCitiesFile,
  fixtureCityRows,
  fixtureCostRows,
  fixtureOfferRows,
  fixtureProduction,
  fixtureProductionRows,
  fixtureUtilityRows,
} from './test-rows';

describe('utilities', () => {
  it('round-trips the synthetic fixtures (domain -> rows -> domain) exactly', () => {
    expect(UtilitiesSchema.parse(utilitiesFromRows(fixtureUtilityRows()))).toEqual(fixtureUtilities);
  });

  it('orders by display_order, and children by position regardless of row order', () => {
    const rows = fixtureUtilityRows().reverse();
    for (const r of rows) {
      r.utility_tier_sets?.reverse();
      r.utility_tier_sets?.forEach((s) => s.utility_tiers?.reverse());
      r.utility_tou_rates?.reverse();
    }
    expect(UtilitiesSchema.parse(utilitiesFromRows(rows))).toEqual(fixtureUtilities);
  });

  it('maps empty child lists to null and an absent avg-rate record to null, so the schema decides', () => {
    const [fl] = fixtureUtilityRows();
    const noSets = utilityFromRow({ ...fl!, utility_tier_sets: [] });
    expect(noSets.tier_sets).toBeNull();
    expect(noSets.tou_rates).toBeNull();
    expect(UtilitiesSchema.safeParse([noSets]).success).toBe(false);
    expect(utilityFromRow({ ...fl!, utility_tier_sets: undefined, utility_tou_rates: undefined }).tier_sets).toBeNull();
  });

  it('builds the avg-rate record from the avg_rate_* columns with its own provenance', () => {
    const ca = fixtureUtilityRows().find((u) => u.state === 'CA')!;
    expect(utilityFromRow({ ...ca, avg_rate_likely: 0.25, avg_rate_source_url: 'https://example.com/avg' }).avg_rate_per_kwh).toMatchObject({
      likely: 0.25,
      source_url: 'https://example.com/avg',
    });
    // A tou utility whose record is missing fails validation (it must exist even with null values).
    const noRecord = utilityFromRow({ ...ca, avg_rate_unit: null });
    expect(noRecord.avg_rate_per_kwh).toBeNull();
    expect(UtilitiesSchema.safeParse([noRecord]).success).toBe(false);
  });

  it('a numeric value without provenance fails validation after mapping', () => {
    const [fl] = fixtureUtilityRows();
    expect(UtilitiesSchema.safeParse([utilityFromRow({ ...fl!, source_url: null })]).success).toBe(false);
  });
});

describe('costs', () => {
  it('round-trips', () => {
    expect(CostsSchema.parse(costsFromRows(fixtureCostRows()))).toEqual(fixtureCosts);
  });
  it('a missing row fails validation', () => {
    expect(CostsSchema.safeParse(costsFromRows(fixtureCostRows().slice(1))).success).toBe(false);
  });
});

describe('assumptions', () => {
  it('round-trips (kind is added, value spread back)', () => {
    expect(AssumptionsSchema.parse(assumptionsFromRows(fixtureAssumptionRows()))).toEqual(fixtureAssumptions);
  });

  it('a state row overrides the all-states row only for that state', () => {
    const rows = fixtureAssumptionRows();
    const override = { key: 'analysis_years', state: 'CA', value: { value: 20 }, unit: null, rationale: 'synthetic CA override' };
    for (const order of [[...rows, override], [override, ...rows]]) {
      expect(AssumptionsSchema.parse(assumptionsFromRows(order, 'CA')).analysis_years).toEqual({ kind: 'assumption', rationale: 'synthetic CA override', value: 20 });
      expect(AssumptionsSchema.parse(assumptionsFromRows(order, 'FL')).analysis_years.value).toBe(fixtureAssumptions.analysis_years.value);
      expect(AssumptionsSchema.parse(assumptionsFromRows(order)).analysis_years.value).toBe(fixtureAssumptions.analysis_years.value);
    }
  });

  it('a missing key or a bad value fails validation', () => {
    expect(AssumptionsSchema.safeParse(assumptionsFromRows(fixtureAssumptionRows().filter((r) => r.key !== 'analysis_years'))).success).toBe(false);
    const bad = fixtureAssumptionRows().map((r) => (r.key === 'analysis_years' ? { ...r, value: { value: 'twenty' } } : r));
    expect(AssumptionsSchema.safeParse(assumptionsFromRows(bad)).success).toBe(false);
  });
});

describe('cities', () => {
  it('round-trips, including the shared coordinates source', () => {
    expect(CitiesFileSchema.parse(citiesFileFromRows(fixtureCityRows()))).toEqual(fixtureCitiesFile);
    expect(CitiesSchema.parse(citiesFromRows(clone(fixtureCityRows()).reverse()))).toEqual(fixtureCitiesFile.cities);
    expect(citiesFileFromRows([])).toBeNull();
  });
});

describe('production and offers', () => {
  it('round-trips production and converts it to the calc input', () => {
    const list = CityProductionListSchema.parse(fixtureProductionRows().map(productionFromRow));
    expect(list).toEqual(fixtureProduction);
    expect(toProductionInput(list[0]!)).toEqual({ annualKwhPerKw: 1440, monthlyKwhPerKw: Array(12).fill(120) });
  });
  it('rejects duplicate production rows', () => {
    const rows = fixtureProductionRows();
    expect(CityProductionListSchema.safeParse([...rows, rows[0]!].map(productionFromRow)).success).toBe(false);
  });
  it('maps offers', () => {
    expect(offerFromRow(fixtureOfferRows()[0]!)).toEqual({ state: 'FL', partner_name: 'Fixture Partner', url: 'https://example.com/go', cta_text: 'Get quotes', active: true });
  });
});
