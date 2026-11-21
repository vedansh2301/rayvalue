import { describe, expect, it } from 'vitest';
import { checkFact, parseNumberToken } from './factcheck';

const PAGE = 'Einspeisevergütung. Teileinspeisung bis 10 kW: 7,70 ct/kWh (Inbetriebnahme 01.08.-31.12.2026). Volleinspeisung bis 10 kW: 12,22 ct/kWh. Der Strompreis betrug 1.234,56 EUR im Jahr 2025. Insgesamt 40 Anträge.';

describe('parseNumberToken', () => {
  it('reads decimal commas, thousands separators and ambiguous groups', () => {
    expect(parseNumberToken('7,70')).toEqual([7.7]);
    expect(parseNumberToken('1.234,56')).toEqual([1234.56]);
    expect(parseNumberToken('1,234.56')).toEqual([1234.56]);
    expect(parseNumberToken('1 234')).toEqual([1234]);
    expect(parseNumberToken('1,234')).toEqual([1234, 1.234]);
    expect(parseNumberToken('1.234.567')).toEqual([1234567]);
  });
});

describe('checkFact', () => {
  it('match: excerpt verbatim', () => {
    expect(checkFact({ value: '7.70', unit: 'ct/kWh', excerpt: 'Teileinspeisung bis 10 kW: 7,70 ct/kWh' }, PAGE).verdict).toBe('match');
  });
  it('match: value (decimal comma in the page) next to its unit when the excerpt is paraphrased', () => {
    expect(checkFact({ value: '12.22', unit: 'ct/kWh', excerpt: 'full feed-in up to 10 kW pays 12.22' }, PAGE).verdict).toBe('match');
  });
  it('match: thousands separators', () => {
    expect(checkFact({ value: '1234.56', unit: 'EUR', excerpt: null }, PAGE).verdict).toBe('match');
  });
  it('mismatch: same wording, different number', () => {
    const r = checkFact({ value: '7.70', unit: 'ct/kWh', excerpt: 'Volleinspeisung bis 10 kW: 7,70 ct/kWh' }, PAGE);
    expect(r.verdict).toBe('mismatch');
    expect(r.reason).toContain('12,22');
  });
  it('not_found: number absent', () => {
    expect(checkFact({ value: '9.99', unit: 'ct/kWh', excerpt: 'Anderer Satz: 9,99 ct/kWh' }, PAGE).verdict).toBe('not_found');
    expect(checkFact({ value: '9.99', unit: 'ct/kWh', excerpt: 'Teileinspeisung bis 10 kW: 9,99 ct/kWh' }, PAGE).verdict).toBe('mismatch');
  });
  it('not_found: a bare number without unit context is not enough', () => {
    expect(checkFact({ value: '40', unit: 'kWp', excerpt: null }, PAGE).verdict).toBe('not_found');
    expect(checkFact({ value: '40', unit: null, excerpt: null }, PAGE).verdict).toBe('not_found');
  });
  it('ranges need every number', () => {
    expect(checkFact({ value: '7.7-12.22', unit: 'ct/kWh', excerpt: null }, PAGE).verdict).toBe('match');
    expect(checkFact({ value: '7.7-13', unit: 'ct/kWh', excerpt: null }, PAGE).verdict).toBe('not_found');
  });
  it('percent units match percent words', () => {
    expect(checkFact({ value: '60', unit: '% of STC factor', excerpt: null }, 'Batteries get 60 per cent of the factor').verdict).toBe('match');
  });
  it('dates need excerpt context; text values need excerpt or a long exact phrase', () => {
    expect(checkFact({ value: '2026-08-01', unit: 'date', excerpt: 'Inbetriebnahme 01.08.' }, 'Gilt ab 01.08.2026 fuer Neuanlagen').verdict).toBe('not_found');
    expect(checkFact({ value: '2026-08-01', unit: 'date', excerpt: 'Gilt ab 01.08.2026' }, 'Gilt ab 01.08.2026 fuer Neuanlagen').verdict).toBe('match');
    expect(checkFact({ value: 'closed', unit: 'status', excerpt: null }, 'The scheme is closed.').verdict).toBe('not_found');
    expect(checkFact({ value: 'closed', unit: 'status', excerpt: 'The scheme is closed' }, 'The scheme is closed.').verdict).toBe('match');
    expect(checkFact({ value: 'net billing with annual settlement', unit: 'text', excerpt: null }, 'We use Net Billing with annual settlement.').verdict).toBe('match');
  });
  it('empty value or empty text is not_found', () => {
    expect(checkFact({ value: null }, PAGE).verdict).toBe('not_found');
    expect(checkFact({ value: '1', unit: 'kWh' }, '').verdict).toBe('not_found');
  });
});
