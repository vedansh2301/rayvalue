import { describe, expect, it } from 'vitest';
import type { CalcSuccess } from '../calc/types';
import { estimateChip, estimateSnapshot } from './snapshot';
import { parseSnapshot } from './validate';

const r = {
  size: { low: 10.2, likely: 10.7, high: 11.3 },
  cost: { low: 26800, likely: 33300, high: 40300 },
  paybackYears: { low: 11.5, likely: 14, high: null },
  netSavings25: { low: -2500, likely: 37200, high: 52100 },
  analysisYears: 25,
} as unknown as CalcSuccess;

describe('estimateSnapshot', () => {
  it('copies the displayed values', () => {
    const s = estimateSnapshot(r);
    expect(s).toEqual({
      system_size: { likely: '10.7 kW', low: '10.2 kW', high: '11.3 kW' },
      upfront_cost: { likely: '$33,300', low: '$26,800', high: '$40,300' },
      payback: { likely: '14 years', low: '11.5 years', high: 'more than 25 years' },
      net_savings: { likely: '$37,200', low: '−$2,500', high: '$52,100' },
    });
    // survives the server's validation unchanged
    expect(parseSnapshot(JSON.stringify(s))).toEqual(s);
  });
});

describe('estimateChip', () => {
  it('summarizes the likely payback and net savings', () => {
    expect(estimateChip(estimateSnapshot(r))).toBe('Likely: 14 years payback \u00b7 $37,200 net savings');
    expect(estimateChip({ payback: { value: '7 years' }, net_savings: { value: '$9,000' } })).toBe('Likely: 7 years payback \u00b7 $9,000 net savings');
  });
  it('is null without a snapshot or when a value is missing', () => {
    expect(estimateChip(null)).toBeNull();
    expect(estimateChip({ payback: { value: '7 years' } })).toBeNull();
  });
});
