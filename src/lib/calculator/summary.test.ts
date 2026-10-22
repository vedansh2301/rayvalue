import { describe, expect, it } from 'vitest';
import { answerSummaryParts, answerSummaryText, formatBillPerMonth } from './summary';

describe('formatBillPerMonth', () => {
  it('keeps whole dollars whole and keeps cents', () => {
    expect(formatBillPerMonth(200)).toBe('$200/mo');
    expect(formatBillPerMonth(1250)).toBe('$1,250/mo');
    expect(formatBillPerMonth(180.5)).toBe('$180.50/mo');
  });
});

describe('answerSummaryText', () => {
  it('builds the spec example', () => {
    expect(answerSummaryText({ zip: '33101', utilityName: 'Florida Power & Light (FPL)', bill: 200, battery: 0, shading: 'none' })).toBe(
      '33101 · Florida Power & Light (FPL) · $200/mo · No battery · Little or no shade',
    );
  });
  it('labels batteries and shade', () => {
    expect(answerSummaryParts({ zip: '94103', utilityName: 'San Diego Gas & Electric (SDG&E)', bill: 310.25, battery: 2, shading: 'heavy' })).toEqual([
      '94103',
      'San Diego Gas & Electric (SDG&E)',
      '$310.25/mo',
      '2 batteries',
      'Heavy shade',
    ]);
    expect(answerSummaryParts({ zip: '1', utilityName: 'X', bill: 1, battery: 1, shading: 'some' }).slice(3)).toEqual(['1 battery', 'Some shade']);
  });
  it('says "Utility not listed" for an unlisted or unknown utility', () => {
    expect(answerSummaryText({ zip: '33101', utilityName: null, bill: 200, battery: 0, shading: 'none' })).toBe(
      '33101 · Utility not listed · $200/mo · No battery · Little or no shade',
    );
    expect(answerSummaryParts({ zip: '33101', utilityName: '', bill: 200, battery: 0, shading: 'none' })[1]).toBe('Utility not listed');
  });
});
