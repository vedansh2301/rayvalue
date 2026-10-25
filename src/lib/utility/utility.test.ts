import { describe, expect, it } from 'vitest';
import { UTILITY_PAGES, RESERVED_CITY_SLUGS, utilityPagePath, utilityPageByPath } from './pages';
import { buildUtilityPage, exportRules, isIndexable, pickRepresentativeCity, utilityExampleBills } from './view';
import { getIndexableUtilityUrls } from './sitemap';
import { fixtureAssumptions, fixtureCosts, fixtureUtilities, flTwoTier, caFixture, clone } from '../calc/test-fixtures';
import { fixtureCitiesFile } from '../db/test-rows';
import { faqJsonLd } from '../seo/jsonld';
import { parseUtilityParam } from '../share';
import type { CityProduction, Assumptions } from '../../data/schemas';

describe('utility page metadata', () => {
  it('has the six guide URLs', () => {
    expect(UTILITY_PAGES.map(utilityPagePath)).toEqual([
      '/solar/florida/fpl', '/solar/florida/duke-energy-florida', '/solar/florida/teco',
      '/solar/california/pge', '/solar/california/sce', '/solar/california/sdge',
    ]);
  });
  it('full title is 50-60 chars and description 150-160 chars', () => {
    for (const p of UTILITY_PAGES) {
      const full = `${p.title} | RayValue`;
      expect(full.length, p.slug).toBeGreaterThanOrEqual(50);
      expect(full.length, p.slug).toBeLessThanOrEqual(60);
      expect(p.description.length, p.slug).toBeGreaterThanOrEqual(150);
      expect(p.description.length, p.slug).toBeLessThanOrEqual(160);
    }
  });
  it('titles and descriptions are unique; slugs are reserved from city pages', () => {
    expect(new Set(UTILITY_PAGES.map((p) => p.title)).size).toBe(6);
    expect(new Set(UTILITY_PAGES.map((p) => p.description)).size).toBe(6);
    expect(RESERVED_CITY_SLUGS.has('fpl')).toBe(true);
    expect(utilityPageByPath('CA', 'fpl')).toBeNull();
  });
});

const a: Assumptions = { ...clone(fixtureAssumptions), utility_example_bills: { kind: 'assumption', rationale: 'synthetic fixture value', value: [150, 250, 350] } };
const prod = (slug: string, state: 'FL' | 'CA'): CityProduction => ({
  state, slug, losses: 20, annual_kwh_per_kw: 1200, monthly_kwh_per_kw: Array(12).fill(100), fetched_on: '2026-01-01',
  source_url: 'https://example.com/p', endpoint: 'https://example.com/e', params: {}, dataset_note: 'synthetic', key_kind: 'api_key',
});
const lookupZip = () => ({ state: 'FL' as const });
const input = (utilityId: 'fpl' | 'pge', over: Partial<Parameters<typeof buildUtilityPage>[0]> = {}) => ({
  meta: UTILITY_PAGES.find((p) => p.utilityId === utilityId)!,
  utilities: fixtureUtilities, costs: fixtureCosts, assumptions: a,
  cities: fixtureCitiesFile.cities, production: [prod('fx-a', 'FL'), prod('fx-c', 'CA')], lookupZip, ...over,
});

describe('buildUtilityPage', () => {
  it('runs the engine for each bill with and without a battery', () => {
    const vm = buildUtilityPage(input('fpl'))!;
    expect(vm.examples.map((r) => [r.bill, r.battery])).toEqual([[150, 0], [150, 1], [250, 0], [250, 1], [350, 0], [350, 1]]);
    expect(vm.examples.every((r) => r.result)).toBe(true);
    expect(vm.indexable).toBe(true);
    const [solar, batt] = [vm.examples[0]!.result!, vm.examples[1]!.result!];
    expect(batt.cost.likely).toBeGreaterThan(solar.cost.likely);
    expect(vm.calcHref).toBe('/calculator/florida?utility=fpl');
    expect(vm.quotesHref).toBe('/quotes?state=FL&source=utility:fpl');
    expect(vm.otherPages.map((p) => p.slug)).toEqual(['duke-energy-florida', 'teco']);
  });
  it('no example bills row -> no examples and not indexable', () => {
    const { utility_example_bills: _x, ...rest } = a;
    const vm = buildUtilityPage(input('fpl', { assumptions: rest as Assumptions }))!;
    expect(vm.examples).toEqual([]);
    expect(vm.indexable).toBe(false);
  });
  it('no production -> rows are null (being verified), not invented', () => {
    const vm = buildUtilityPage(input('fpl', { production: [] }))!;
    expect(vm.examples.every((r) => r.result === null)).toBe(true);
    expect(isIndexable(vm.examples)).toBe(false);
  });
  it('returns null when the utility row is missing', () => {
    expect(buildUtilityPage(input('fpl', { utilities: fixtureUtilities.filter((u) => u.id !== 'fpl') }))).toBeNull();
  });
  it('FAQ has 3-5 items and never offers the federal credit', () => {
    for (const id of ['fpl', 'pge'] as const) {
      const vm = buildUtilityPage(input(id))!;
      expect(vm.faq.length).toBeGreaterThanOrEqual(3);
      expect(vm.faq.length).toBeLessThanOrEqual(5);
      expect(faqJsonLd(vm.faq).mainEntity).toHaveLength(vm.faq.length);
      expect(vm.faq.find((f) => f.id === 'credit')!.answer).toMatch(/^No\./);
    }
  });
  it('utilityExampleBills reads the assumption', () => {
    expect(utilityExampleBills(a)).toEqual([150, 250, 350]);
    expect(utilityExampleBills(null)).toBeNull();
  });
});

describe('pickRepresentativeCity / exportRules', () => {
  it('prefers city-level confidence, then order', () => {
    const cs = fixtureCitiesFile.cities.map((c) => ({ ...c, default_utility_id: 'fpl' as const }));
    cs[0]!.utility_confidence = 'indirect';
    cs[1]!.utility_confidence = 'city';
    expect(pickRepresentativeCity(cs, 'fpl')!.slug).toBe('fx-b');
    expect(pickRepresentativeCity(cs, 'teco')).toBeNull();
  });
  it('FL names the minimum bill only when stored', () => {
    expect(exportRules({ ...flTwoTier, minimum_monthly_bill: null, minimum_bill_basis: null }, 'X').paragraphs.join(' ')).toContain('still being verified');
  });
  it('CA shows the stored export credit, or says it is being verified', () => {
    expect(exportRules({ ...caFixture, avg_export_credit_per_kwh: 0.05 }, 'X').paragraphs[0]).toContain('$0.05/kWh');
    expect(exportRules({ ...caFixture, avg_export_credit_per_kwh: null }, 'X').paragraphs[0]).toContain('being verified');
  });
});

describe('getIndexableUtilityUrls', () => {
  it('lists only pages whose loader says indexable; survives failures', async () => {
    const urls = await getIndexableUtilityUrls('https://rayvalue.com', async (slug) => {
      if (slug === 'sce') throw new Error('x');
      const vm = buildUtilityPage(input('fpl'))!;
      return slug === 'fpl' ? { kind: 'ok', vm } : slug === 'teco' ? { kind: 'ok', vm: { ...vm, indexable: false } } : { kind: 'unavailable', meta: vm.meta, error: null };
    });
    expect(urls).toEqual(['https://rayvalue.com/solar/florida/fpl']);
  });
});

describe('parseUtilityParam', () => {
  it('accepts well-formed ids only', () => {
    expect(parseUtilityParam('?utility=fpl')).toBe('fpl');
    expect(parseUtilityParam('?utility=')).toBeNull();
    expect(parseUtilityParam('?utility=<x>')).toBeNull();
    expect(parseUtilityParam('')).toBeNull();
  });
});
