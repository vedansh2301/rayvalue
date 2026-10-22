import { describe, expect, it } from 'vitest';
import { formatUsd } from '../format';
import { displayPayback, displayRange, formatKw, formatSignedUsd, formatYears, rangeText } from './display';

describe('formatters', () => {
  it('formats kW to one decimal', () => {
    expect(formatKw(7)).toBe('7.0 kW');
    expect(formatKw(6.5)).toBe('6.5 kW');
  });
  it('formats years', () => {
    expect(formatYears(1)).toBe('1 year');
    expect(formatYears(7.5)).toBe('7.5 years');
    expect(formatYears(12)).toBe('12 years');
  });
  it('uses a true minus sign for negative money', () => {
    expect(formatSignedUsd(-2500)).toBe('−$2,500');
    expect(formatSignedUsd(2500)).toBe('$2,500');
    expect(formatSignedUsd(0)).toBe('$0');
  });
});

describe('displayRange', () => {
  it('shows likely plus low–high', () => {
    expect(displayRange({ low: 10000, likely: 12000, high: 15000 }, formatUsd)).toEqual({ kind: 'range', likely: '$12,000', low: '$10,000', high: '$15,000' });
  });
  it('collapses to a single value when all ends are equal', () => {
    expect(displayRange({ low: 7, likely: 7, high: 7 }, formatKw)).toEqual({ kind: 'single', value: '7.0 kW' });
  });
});

describe('displayPayback', () => {
  it('formats a numeric range (best case first)', () => {
    expect(displayPayback({ low: 7, likely: 9.5, high: 12 }, 25)).toEqual({ kind: 'range', likely: '9.5 years', low: '7 years', high: '12 years' });
  });
  it('shows "more than N years" for null ends', () => {
    expect(displayPayback({ low: 18, likely: null, high: null }, 25)).toEqual({ kind: 'range', likely: 'More than 25 years', low: '18 years', high: 'more than 25 years' });
    expect(displayPayback({ low: null, likely: null, high: null }, 25)).toEqual({ kind: 'single', value: 'More than 25 years' });
  });
  it('collapses equal values', () => {
    expect(displayPayback({ low: 10, likely: 10, high: 10 }, 25)).toEqual({ kind: 'single', value: '10 years' });
  });
});

describe('rangeText', () => {
  it('reads naturally', () => {
    expect(rangeText({ kind: 'range', likely: '$2', low: '$1', high: '$3' })).toBe('$1 to $3, likely $2');
    expect(rangeText({ kind: 'single', value: '$2' })).toBe('$2');
  });
});
