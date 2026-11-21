import { describe, expect, it } from 'vitest';
import { cityKeyNumbers } from '../city/key-numbers';
import { utilityKeyNumbers } from '../utility/key-numbers';
import { finishBlock, type KeyNumber } from './key-numbers';
import { fixtureCosts, fixtureUtilities, caFixture, flTwoTier } from '../calc/test-fixtures';
import type { CityProduction } from '../../data/schemas';
import type { ExampleRow } from '../city/view';

const production: CityProduction = {
  state: 'FL', slug: 'x', losses: 14, annual_kwh_per_kw: 1523.6, monthly_kwh_per_kw: Array(12).fill(1523.6 / 12), fetched_on: '2026-07-30',
  source_url: 'https://example.com/pvwatts', endpoint: 'https://example.com/e', params: {}, dataset_note: 'n', key_kind: 'api_key',
};
const examples: ExampleRow[] = [
  { bill: 100, result: null },
  { bill: 150, result: { size: { low: 5, likely: 6, high: 7 }, cost: { low: 10000, likely: 12000, high: 14000 }, paybackYears: { low: 7.5, likely: 9, high: 11.5 } } as never },
  { bill: 250, result: null },
];
const input = (over = {}) => ({ city: { name: 'Miami' }, utility: flTwoTier, utilityShort: 'FPL', production, costs: fixtureCosts.FL, examples, analysisYears: 25, ...over });

describe('cityKeyNumbers', () => {
  it('gives 3-5 lines, each with a source link or our-data fallback, and a one-sentence answer', () => {
    const b = cityKeyNumbers(input());
    expect(b.items.length).toBeGreaterThanOrEqual(3);
    expect(b.items.length).toBeLessThanOrEqual(5);
    expect(b.answer).toBe('In Miami, an example $150/month home on FPL rates pays back solar in about 7.5–11.5 years (likely 9), with no federal tax credit.');
    expect(b.items[0]!.value).toBe('7.5–11.5 years (likely 9)');
    expect(b.items.some((i) => i.value === 'Not available for 2026+ installs')).toBe(true);
    expect(b.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('drops lines whose input is null and never shows a placeholder number', () => {
    const b = cityKeyNumbers(input({ production: null, costs: null, examples: null }));
    expect(b.answer).toBeNull();
    for (const i of b.items) expect(i.value).not.toMatch(/\b0 kWh|\$0(?![.\d])|null|undefined/);
    expect(b.items.some((i) => i.label === 'Solar output')).toBe(false);
  });
  it('is hidden when fewer than 3 lines survive', () => {
    expect(cityKeyNumbers(input({ utility: null, production: null, costs: null, examples: null })).items).toEqual([]);
  });
  it('every number in the output comes from the inputs (no invented figures)', () => {
    const b = cityKeyNumbers(input());
    const txt = [b.answer ?? '', ...b.items.flatMap((i) => [i.label, i.value])].join(' ');
    const allowed = new Set(['150', '7.5', '11.5', '9', '2026', '1,524', '25']);
    const rateNums = JSON.stringify(flTwoTier) + JSON.stringify(fixtureCosts.FL);
    for (const n of txt.match(/\d[\d,]*(\.\d+)?/g) ?? []) {
      const bare = n.replace(/\.?0+$/, '');
      expect(allowed.has(n) || rateNums.includes(bare) || rateNums.includes(String(Number(n))), n).toBe(true);
    }
  });
  it('uses "more than N" when payback exceeds the analysis period', () => {
    const rows = [{ bill: 150, result: { ...examples[1]!.result, paybackYears: { low: null, likely: null, high: null } } as never }];
    expect(cityKeyNumbers(input({ examples: rows })).answer).toContain('takes more than 25 years');
  });
  it('shows the export credit only for California', () => {
    const ca = cityKeyNumbers(input({ utility: caFixture, utilityShort: 'SCE' }));
    expect(ca.items.some((i) => i.label.includes('export credit'))).toBe(caFixture.avg_export_credit_per_kwh !== null);
    expect(cityKeyNumbers(input()).items.some((i) => i.label.includes('export credit'))).toBe(false);
  });
  it('does not borrow a date for the utility line', () => {
    const u = { ...flTwoTier, verified_on: null };
    expect(cityKeyNumbers(input({ utility: u })).items.find((i) => i.label.startsWith(u.name))!.checkedOn).toBeNull();
  });
});

describe('utilityKeyNumbers', () => {
  it('builds rate, fixed charge and the 25D line', () => {
    const b = utilityKeyNumbers(fixtureUtilities[0]!, 'X');
    expect(b.items.length).toBeGreaterThanOrEqual(3);
    expect(b.answer).toContain('25D');
  });
});

describe('finishBlock', () => {
  it('caps at 5 lines', () => {
    const k: KeyNumber = { label: 'a', value: 'b', source: null, checkedOn: '2026-01-01' };
    expect(finishBlock(null, [k, k, k, k, k, k, k]).items).toHaveLength(5);
  });
});
