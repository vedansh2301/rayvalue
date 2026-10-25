import { describe, expect, it } from 'vitest';
import { chartBars, formatKwhLabel, exampleBills, exportCreditSource, isHttpUrl, exampleRows, formatYears, introParagraphs, pickProduction, slugFromState, stateFromSlug, utilityRateRows } from './view';
import { fixtureAssumptions, fixtureCosts, fixtureUtilities, flTwoTier, caFixture } from '../calc/test-fixtures';
import { fixtureCitiesFile } from '../db/test-rows';
import type { CityProduction } from '../../data/schemas';

const city = fixtureCitiesFile.cities[0]!;
const prod = (losses: number): CityProduction => ({
  state: 'FL', slug: 'fx-a', losses, annual_kwh_per_kw: 1200, monthly_kwh_per_kw: Array(12).fill(100), fetched_on: '2026-01-01',
  source_url: 'https://example.com/p', endpoint: 'https://example.com/e', params: {}, dataset_note: 'synthetic', key_kind: 'api_key',
});

describe('state slugs', () => {
  it('maps both ways and rejects unknown', () => {
    expect(stateFromSlug('florida')).toBe('FL');
    expect(stateFromSlug('california')).toBe('CA');
    expect(stateFromSlug('texas')).toBeNull();
    expect(slugFromState('CA')).toBe('california');
  });
});

describe('introParagraphs', () => {
  it('returns [] for null/empty', () => {
    expect(introParagraphs(null)).toEqual([]);
    expect(introParagraphs('  \n\n ')).toEqual([]);
  });
  it('splits paragraphs and strips light markdown, keeping HTML as inert text', () => {
    expect(introParagraphs('# Hi\n\nSome **bold** and *it*\nline two\n\n<script>x</script>')).toEqual(['Hi', 'Some bold and it line two', '<script>x</script>']);
  });
});

describe('utilityRateRows', () => {
  it('lists tiers with nulls preserved', () => {
    const rows = utilityRateRows(flTwoTier);
    expect(rows.length).toBeGreaterThan(2);
    expect(rows[0]!.label).toMatch(/^First \d+ kWh\/month$/);
    expect(rows.at(-1)!.label).toBe('Fixed monthly charge');
  });
  it('prints the fixed charge to the cent', () => {
    expect(utilityRateRows({ ...flTwoTier, fixed_monthly_charge: 10.52 }).at(-1)!.value).toBe('$10.52');
    expect(utilityRateRows({ ...flTwoTier, fixed_monthly_charge: 14 }).at(-1)!.value).toBe('$14.00');
    expect(utilityRateRows({ ...flTwoTier, fixed_monthly_charge: null }).at(-1)!.value).toBeNull();
  });
  it('shows CA export credit', () => {
    expect(utilityRateRows(caFixture).map((r) => r.label)).toContain('Average export credit');
  });
  it('null rate -> null value', () => {
    const u = { ...flTwoTier, tier_sets: flTwoTier.tier_sets!.map((s) => ({ ...s, tiers: s.tiers.map((t) => ({ ...t, rate_per_kwh: null, base_rate_per_kwh: null })) })) };
    expect(utilityRateRows(u)[0]!.value).toBeNull();
  });
});

describe('chartBars', () => {
  it('scales the tallest month to full plot height', () => {
    const bars = chartBars([10, 20, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0], 600, 220);
    expect(bars).toHaveLength(12);
    expect(bars[1]!.h).toBeCloseTo(220 - 22 - 28);
    expect(bars[0]!.h).toBeCloseTo((220 - 50) / 2);
    expect(bars[3]!.h).toBe(0);
  });
  it('handles all zeros', () => {
    expect(chartBars(Array(12).fill(0)).every((b) => b.h === 0)).toBe(true);
  });
  it('labels each bar with whole kWh, 4 units above the bar top', () => {
    const bars = chartBars([152.4, 160.6, 0, 1234.5, 0, 0, 0, 0, 0, 0, 0, 0], 600, 220);
    expect(bars.map((b) => b.label).slice(0, 4)).toEqual(['152', '161', '0', '1,235']);
    for (const b of bars) expect(b.labelY).toBeCloseTo(b.y - 4);
    // the tallest bar's label still sits above it, inside the top padding
    expect(bars[3]!.labelY).toBeCloseTo(22 - 4);
    // a zero-height bar's label sits just above the baseline
    expect(bars[2]!.labelY).toBeCloseTo(220 - 28 - 4);
  });
  it('keeps the raw kWh value unchanged', () => {
    expect(chartBars([152.4, ...Array(11).fill(0)])[0]!.kwh).toBe(152.4);
  });
});

describe('formatKwhLabel', () => {
  it('rounds to whole kWh with separators', () => {
    expect(formatKwhLabel(99.5)).toBe('100');
    expect(formatKwhLabel(1523.4)).toBe('1,523');
  });
});

describe('pickProduction', () => {
  it('matches the "some" loss or returns null', () => {
    const loss = fixtureAssumptions.pvwatts_system_loss_pct.some;
    expect(pickProduction([prod(loss + 5), prod(loss)], fixtureAssumptions)?.losses).toBe(loss);
    expect(pickProduction([prod(loss + 5)], fixtureAssumptions)).toBeNull();
  });
});

describe('exampleRows', () => {
  const ctx = { utilities: fixtureUtilities, costs: fixtureCosts, assumptions: fixtureAssumptions };
  it('is null without production or config', () => {
    expect(exampleRows(city, [100], ctx, null).every((r) => r.result === null)).toBe(true);
    expect(exampleRows(city, [100], null, prod(14))[0]!.result).toBeNull();
  });
  it('computes a range for each bill', () => {
    const rows = exampleRows(city, [100, 200], ctx, prod(14), '33101');
    expect(rows.map((r) => r.bill)).toEqual([100, 200]);
    for (const r of rows) if (r.result) expect(r.result.cost.low).toBeLessThanOrEqual(r.result.cost.high);
  });
  it('unknown utility becomes null, not a throw', () => {
    expect(exampleRows({ ...city, default_utility_id: 'sce' }, [100], ctx, prod(14))[0]!.result).toBeNull();
  });
});

describe('formatYears', () => {
  it('formats null as more than N', () => {
    expect(formatYears(null, 25)).toBe('more than 25');
    expect(formatYears(7.5, 25)).toBe('7.5');
  });
});

describe('exampleBills', () => {
  it('reads city_example_bills from the assumptions, null when missing or unavailable', () => {
    expect(exampleBills(null)).toBeNull();
    expect(exampleBills(fixtureAssumptions)).toBeNull();
    const a = { ...fixtureAssumptions, city_example_bills: { kind: 'assumption' as const, rationale: 'synthetic test rationale', value: [11, 22] } };
    expect(exampleBills(a)).toEqual([11, 22]);
  });
});

describe('isHttpUrl', () => {
  it('accepts only http(s) URLs', () => {
    expect(isHttpUrl('https://example.com/x')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    for (const u of ['javascript:alert(1)', 'data:text/html,x', '//example.com', '', null, undefined]) expect(isHttpUrl(u)).toBe(false);
  });
});

describe('exportCreditSource', () => {
  it('uses the export credit provenance, only for http(s) links and a non-null credit', () => {
    expect(exportCreditSource(caFixture)).toEqual({ url: 'https://example.com/synthetic-export-credit', date: '2026-01-02', note: 'synthetic export credit note' });
    expect(exportCreditSource({ ...caFixture, export_credit_source_url: 'javascript:alert(1)' })).toBeNull();
    expect(exportCreditSource({ ...caFixture, avg_export_credit_per_kwh: null })).toBeNull();
    expect(exportCreditSource(flTwoTier)).toBeNull();
  });
});
