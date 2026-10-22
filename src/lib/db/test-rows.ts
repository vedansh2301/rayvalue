/**
 * SYNTHETIC database rows for the db tests, built from the synthetic calc fixtures
 * (src/lib/calc/test-fixtures.ts). Never real values.
 */
import { fixtureAssumptions, fixtureCosts, fixtureUtilities } from '../calc/test-fixtures';
import type { CitiesFile, CityProduction } from '../../data/schemas';
import {
  assumptionsToRows,
  citiesFileToRows,
  costsToRows,
  productionToRow,
  utilityToRows,
  type CityRow,
  type CostRangeRow,
  type ModelAssumptionRow,
  type OfferRow,
  type ProductionRow,
  type UtilityRow,
} from './map';

/** Utility rows shaped like the PostgREST embed (utilities + nested tier sets/tiers + TOU rates). */
export function fixtureUtilityRows(): UtilityRow[] {
  return fixtureUtilities.map((u, i) => {
    const { utility, tierSets, touRates } = utilityToRows(u, i);
    return {
      ...utility,
      utility_tier_sets: tierSets.map((s) => ({ ...s.row, utility_tiers: s.tiers })),
      utility_tou_rates: touRates,
    };
  });
}

export const fixtureCostRows = (): CostRangeRow[] => costsToRows(fixtureCosts);
export const fixtureAssumptionRows = (): ModelAssumptionRow[] => assumptionsToRows(fixtureAssumptions);

export const fixtureCitiesFile: CitiesFile = {
  coordinates_source: { description: 'synthetic coordinates', source_url: 'https://example.com/coords', verified_on: '2026-01-01' },
  cities: [
    { slug: 'fx-a', name: 'Fixture A', state: 'FL', lat: 25.5, lon: -80.5, coords_zcta: '33001', default_utility_id: 'fpl', utility_source_url: 'https://example.com/a', utility_source_note: 'synthetic', utility_confidence: 'city', published: false, local_notes: [], intro_md: null },
    { slug: 'fx-b', name: 'Fixture B', state: 'FL', lat: 28.5, lon: -81.5, coords_zcta: '32001', default_utility_id: 'duke-fl', utility_source_url: 'https://example.com/b', utility_source_note: 'synthetic', utility_confidence: 'county', published: true, local_notes: ['note one'], intro_md: 'Intro **md**' },
    { slug: 'fx-c', name: 'Fixture C', state: 'CA', lat: 37.5, lon: -122.1, coords_zcta: '94001', default_utility_id: 'pge', utility_source_url: 'https://example.com/c', utility_source_note: 'synthetic', utility_confidence: 'indirect', published: false, local_notes: [], intro_md: null },
  ],
};
export const fixtureCityRows = (): CityRow[] => citiesFileToRows(fixtureCitiesFile);

const prod = (state: 'FL' | 'CA', slug: string, losses: number, perMonth: number): CityProduction => ({
  state,
  slug,
  losses,
  annual_kwh_per_kw: perMonth * 12,
  monthly_kwh_per_kw: Array(12).fill(perMonth),
  fetched_on: '2026-01-01',
  source_url: 'https://example.com/pvwatts-docs',
  endpoint: 'https://example.com/pvwatts.json',
  params: { tilt: 20, dataset: 'synthetic' },
  dataset_note: 'synthetic',
  key_kind: 'api_key',
});
export const fixtureProduction: CityProduction[] = [prod('FL', 'fx-a', 14, 120), prod('FL', 'fx-a', 20, 110), prod('FL', 'fx-b', 14, 115), prod('CA', 'fx-c', 14, 130)];
export const fixtureProductionRows = (): ProductionRow[] => fixtureProduction.map(productionToRow);

export const fixtureOfferRows = (): OfferRow[] => [
  { state: 'FL', partner_name: 'Fixture Partner', url: 'https://example.com/go', cta_text: 'Get quotes', active: true },
  { state: 'CA', partner_name: 'Inactive Partner', url: null, cta_text: 'Soon', active: false },
];
