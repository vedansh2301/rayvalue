// Uses the synthetic calc fixtures; no network.
import { describe, expect, it } from 'vitest';
import type { City, CityProduction, Offer } from '../../data/schemas';
import type { Result } from '../db/client';
import type { CalcConfig } from '../db/repo';
import { fixtureAssumptions, fixtureCosts, flTwoTier } from '../calc/test-fixtures';
import { loadCalculatorPageData, visibleOffer, type CalculatorRepo } from './page-data';

const months = (v: number) => Array.from({ length: 12 }, () => v);
const city = (state: 'FL' | 'CA', slug: string): City => ({
  slug,
  name: `City ${slug}`,
  state,
  lat: state === 'FL' ? 27 : 36,
  lon: state === 'FL' ? -81 : -120,
  coords_zcta: '00000',
  default_utility_id: state === 'FL' ? 'fpl' : 'pge',
  utility_source_url: 'https://example.com/x',
  utility_source_note: 'synthetic',
  utility_confidence: 'city',
  published: false,
  local_notes: [],
  intro_md: null,
});
const prod = (slug: string, losses: number): CityProduction => ({
  state: 'FL',
  slug,
  losses,
  annual_kwh_per_kw: 120,
  monthly_kwh_per_kw: months(10),
  fetched_on: '2026-01-01',
  source_url: 'https://example.com/p',
  endpoint: 'https://example.com/pvwatts/v8.json',
  params: { lat: 27, lon: -81 },
  dataset_note: 'synthetic',
  key_kind: 'DEMO_KEY',
});
const activeOffer: Offer = { state: 'FL', partner_name: 'Partner', url: 'https://example.com/go', cta_text: 'Get quotes', active: true };

function repo(over: Partial<{ config: Result<CalcConfig>; cities: Result<City[]>; production: Result<CityProduction[]> }> = {}): CalculatorRepo {
  const config: Result<CalcConfig> = over.config ?? { ok: true, value: { state: 'FL', utilities: [flTwoTier], costs: fixtureCosts, assumptions: fixtureAssumptions, offer: activeOffer } };
  return {
    loadCalcConfig: async () => config,
    loadCities: async () => over.cities ?? { ok: true, value: [city('FL', 'a'), city('CA', 'b')] },
    loadProduction: async () => over.production ?? { ok: true, value: [prod('a', 10), prod('a', 20)] },
  };
}

describe('loadCalculatorPageData', () => {
  it('maps config, slim cities and production into island props', async () => {
    const r = await loadCalculatorPageData('FL', repo());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.props.state).toBe('FL');
    expect(r.props.utilities.map((u) => u.id)).toEqual(['fpl']);
    expect(r.props.fallbackCities).toEqual([{ state: 'FL', slug: 'a', name: 'City a', lat: 27, lon: -81 }]);
    expect(r.props.fallbackProduction).toEqual([
      { slug: 'a', losses: 10, annualKwhPerKw: 120, monthlyKwhPerKw: months(10) },
      { slug: 'a', losses: 20, annualKwhPerKw: 120, monthlyKwhPerKw: months(10) },
    ]);
    expect(r.offer).toEqual(activeOffer);
    expect(r.warnings).toEqual([]);
  });
  it('fails when the config cannot be loaded', async () => {
    const r = await loadCalculatorPageData('FL', repo({ config: { ok: false, error: { kind: 'invalid', message: 'bad' } } }));
    expect(r).toEqual({ ok: false, error: { kind: 'invalid', message: 'bad' } });
  });
  it('still works without fallback data, reporting a warning', async () => {
    const r = await loadCalculatorPageData('FL', repo({ production: { ok: false, error: { kind: 'network', message: 'down' } } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.props.fallbackCities).toEqual([]);
    expect(r.props.fallbackProduction).toEqual([]);
    expect(r.warnings).toEqual([{ kind: 'network', message: 'down' }]);
  });
});

describe('visibleOffer', () => {
  it('hides missing, inactive or URL-less offers', () => {
    expect(visibleOffer(null)).toBeNull();
    expect(visibleOffer({ ...activeOffer, active: false })).toBeNull();
    expect(visibleOffer({ ...activeOffer, url: null })).toBeNull();
    expect(visibleOffer(activeOffer)).toEqual(activeOffer);
  });
});
