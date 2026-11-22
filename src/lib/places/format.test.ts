import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, formatNumber, formatPercent, formatPeriod, monthLabels } from './format';

describe('number and currency formats follow the country locale', () => {
  it('en-GB / en-AU use a comma for thousands and a point for decimals', () => {
    expect(formatNumber(5523, 'en-GB')).toBe('5,523');
    expect(formatNumber(25.4, 'en-AU', 2, 2)).toBe('25.40');
    expect(formatMoney(1540.15, 'GBP', 'en-GB')).toBe('£1,540');
    expect(formatMoney(1899, 'AUD', 'en-AU')).toMatch(/^\$1,899$/);
  });

  it('de-DE uses a point for thousands, a comma for decimals and a spaced percent sign', () => {
    expect(formatNumber(29934, 'de-DE')).toBe('29.934');
    expect(formatNumber(1139.4, 'de-DE', 1, 1)).toBe('1.139,4');
    expect(formatPercent(24.7, 'de-DE')).toBe('24,7 %');
    expect(formatPercent(49.2, 'en-GB')).toBe('49.2%');
    expect(formatMoney(1540, 'EUR', 'de-DE')).toBe('1.540 €');
  });
});

describe('dates and periods', () => {
  it('formats ISO dates per locale, in UTC', () => {
    expect(formatDate('2026-11-22', 'en-GB')).toBe('22 November 2026');
    expect(formatDate('2026-11-22', 'de-DE')).toBe('22. November 2026');
    expect(formatDate('2026-09', 'en-AU')).toBe('September 2026');
    expect(formatDate('2001', 'en-AU')).toBe('2001');
    expect(formatDate('not a date', 'en-GB')).toBe('not a date');
  });

  it('formats periods: none and months are hidden, a date is a date, an interval has a joiner', () => {
    expect(formatPeriod('', 'en-GB', 'to')).toBeNull();
    expect(formatPeriod('m03', 'en-GB', 'to')).toBeNull();
    expect(formatPeriod('2021-03-21', 'en-GB', 'to')).toBe('21 March 2021');
    expect(formatPeriod('2026-10-01/2026-12-31', 'de-DE', 'bis')).toBe('1. Oktober 2026 bis 31. Dezember 2026');
  });

  it('gives 12 short month labels per locale', () => {
    expect(monthLabels('en-GB')).toHaveLength(12);
    expect(monthLabels('en-GB')[0]).toBe('Jan');
    expect(monthLabels('en-GB')[8]).toBe('Sep');
    expect(monthLabels('en-AU')[5]).toBe('Jun');
    expect(monthLabels('de-DE')[2]).toMatch(/^M(ä|a)r/);
    expect(monthLabels('de-DE').every((m) => !m.endsWith('.'))).toBe(true);
  });
});
