/** Test fixtures for place pages (shared by the places tests). Values are made-up test data, never shown on the site. */
import type { PlaceFact, PlaceRegion, PlaceWithFacts } from './schema.ts';

export const fact = (key: string, over: Partial<PlaceFact> = {}): PlaceFact => ({
  key,
  value_num: 1,
  value_text: null,
  unit: '',
  period: '',
  scope: 'place',
  scope_label: null,
  source_url: 'https://example.org/source',
  publisher: 'Test Publisher',
  verified_on: '2026-11-22',
  confidence: 'primary',
  status: 'agent_sourced',
  note: null,
  ...over,
});

export const monthlyFacts = (): PlaceFact[] =>
  Array.from({ length: 12 }, (_, i) => fact('solar_yield_monthly_kwh_per_kwp', { value_num: 20 + i * 10, period: `m${String(i + 1).padStart(2, '0')}`, unit: 'kWh/kWp' }));

/** A GB place with all five sections. */
export const gbFacts = (): PlaceFact[] => [
  fact('solar_yield_kwh_per_kwp', { value_num: 955.77, unit: 'kWh/kWp/yr', note: 'db=PVGIS-SARAH3;tilt=43;azimuth=180;loss=14' }),
  ...monthlyFacts(),
  fact('price_cap_region', { value_num: null, value_text: 'North Eastern England', scope: 'region', scope_label: 'North Eastern England' }),
  fact('price_cap_unit_rate_dd', { value_num: 25.46, unit: 'p/kWh (no VAT)', period: '2026-10-01/2026-12-31', scope: 'region', scope_label: 'North Eastern England' }),
  fact('price_cap_unit_rate_dd', { value_num: 25.22, unit: 'p/kWh (incl. 5% VAT)', period: '2026-07-01/2026-09-30', scope: 'region', scope_label: 'North Eastern England' }),
  fact('pv_installations_cumulative', { value_num: 5523, unit: 'installations', period: '2025-12-31' }),
  fact('pv_installations_cumulative', { value_num: 4731, unit: 'installations', period: '2024-12-31' }),
  fact('homeownership_pct', { value_num: 49.2, unit: '% of households', period: '2021-03-21' }),
  fact('avg_install_cost_per_kw_4_10kw_mean', { value_num: 1540.15, unit: 'GBP/kW (TIC)', period: '2025-04-01/2026-03-31', scope: 'region', scope_label: 'North East' }),
];

export const place = (over: Partial<PlaceWithFacts> = {}): PlaceWithFacts => ({
  id: 'p1', country: 'GB', region_code: 'NE', slug: 'newcastle-upon-tyne', name: 'Newcastle upon Tyne', lat: 54.97, lon: -1.61, published: true, updated_at: '2026-11-20T00:00:00Z', place_facts: gbFacts(), ...over,
});

export const regions: PlaceRegion[] = [
  { country: 'GB', code: 'NE', name: 'North East', slug: 'north-east' },
  { country: 'DE', code: 'BY', name: 'Bayern', slug: 'bayern' },
  { country: 'AU', code: 'NSW', name: 'New South Wales', slug: 'nsw' },
];

export const dePlace = (over: Partial<PlaceWithFacts> = {}): PlaceWithFacts => place({
  id: 'd1', country: 'DE', region_code: 'BY', slug: 'muenchen', name: 'München',
  place_facts: [
    fact('solar_yield_kwh_per_kwp', { value_num: 1139.4, unit: 'kWh/kWp/yr', note: 'db=PVGIS-SARAH3;tilt=36;azimuth=180;loss=14' }),
    ...monthlyFacts(),
    fact('owner_occupier_rate_zensus2022', { value_num: 24.7, unit: '%', period: '2022-05-15' }),
    fact('heatpump_solar_heated_building_share', { value_num: 4.2, unit: '%', period: '2022-05-15' }),
    fact('mastr_pv_units_in_operation', { value_num: 29934, unit: 'units', period: '2026-11-22' }),
  ],
  ...over,
});
