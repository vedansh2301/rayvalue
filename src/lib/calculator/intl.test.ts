import { describe, expect, it } from 'vitest';
import { buildSavingsChart, chartSource } from '../calc/chart';
import { displayPayback } from './display';
import { dayAfter, dayBefore, formatKwLocale, installPeriods, parseKwhInput, parseMoneyInput, paybackText, periodLabel } from './intl';
import { AU_STRINGS, DE_STRINGS, GB_STRINGS, idPrefixFor, stringsFor } from './intl-strings';

const vat = (rate: number, validFrom: string | null, validTo: string | null, appliesTo: 'solar' | 'battery' = 'solar') => ({ appliesTo, rate, validFrom, validTo });

describe('installPeriods', () => {
  it('GB: two periods split at the 1 Apr 2027 VAT change (the original behaviour)', () => {
    const p = installPeriods({ vat: [vat(0, '2023-05-01', '2027-03-31'), vat(0.05, '2027-04-01', null)], today: '2026-11-22' });
    expect(p.map((x) => [x.startsOn, x.endsOn, x.solarVat])).toEqual([['2026-11-22', '2027-03-31', 0], ['2027-04-01', null, 0.05]]);
    expect(p.map((x, i) => periodLabel(x, i, GB_STRINGS, 'en-GB'))).toEqual(['Installed by 31 March 2027', 'Installed from 1 April 2027']);
  });
  it('splits at an incentive window and an export window; ignores windows that ended and cuts beyond the horizon', () => {
    const p = installPeriods({
      vat: [],
      incentives: [
        { validFrom: '2026-05-01', validTo: '2026-12-31', amountLikely: 270, perKwhStorage: true },
        { validFrom: '2027-01-01', validTo: '2027-06-30', amountLikely: 226, perKwhStorage: true },
        { validFrom: '2020-01-01', validTo: '2020-12-31', amountLikely: 999, perKwhStorage: true },
      ],
      exportRates: [{ validFrom: '2026-07-01', validTo: '2027-06-30' }],
      horizon: '2027-06-30',
      today: '2026-11-22',
    });
    expect(p.map((x) => [x.startsOn, x.endsOn, x.batteryRebatePerKwh, x.solarVat])).toEqual([['2026-11-22', '2026-12-31', 270, null], ['2027-01-01', '2027-06-30', 226, null]]);
    expect(p.map((x, i) => periodLabel(x, i, GB_STRINGS, 'en-AU'))).toEqual(['Installed by 31 December 2026', 'Installed 1 January 2027 to 30 June 2027']);
  });
  it('a middle period is "between", an open one "from"; nothing is offered after the horizon', () => {
    const p = installPeriods({ vat: [vat(0, null, '2026-12-31'), vat(0.07, '2027-01-01', '2027-12-31'), vat(0.1, '2028-01-01', null)], today: '2026-11-22' });
    expect(p.map((x, i) => periodLabel(x, i, DE_STRINGS, 'de-DE'))).toEqual(['Inbetriebnahme bis 31. Dezember 2026', 'Inbetriebnahme 1. Januar 2027 bis 31. Dezember 2027', 'Inbetriebnahme ab 1. Januar 2028']);
    expect(installPeriods({ vat: [], horizon: '2026-12-31', today: '2027-01-02' })).toEqual([]);
  });
  it('day arithmetic', () => {
    expect(dayAfter('2026-12-31')).toBe('2027-01-01');
    expect(dayBefore('2027-03-01')).toBe('2027-02-28');
  });
});

describe('money and kWh input', () => {
  it('English: symbols and thousands commas are fine, as the UK island always did', () => {
    expect(parseMoneyInput('£1,250.50', 'en-GB', 2000)).toEqual({ ok: true, value: 1250.5 });
    expect(parseMoneyInput('$180', 'en-AU', 1500)).toEqual({ ok: true, value: 180 });
    expect(parseMoneyInput('', 'en-GB', 1000)).toEqual({ ok: false, error: 'empty' });
    expect(parseMoneyInput('0', 'en-GB', 1000)).toEqual({ ok: false, error: 'too_low' });
    expect(parseMoneyInput('1200', 'en-GB', 1000)).toEqual({ ok: false, error: 'too_high' });
    expect(parseMoneyInput('abc', 'en-GB', 1000)).toEqual({ ok: false, error: 'not_number' });
  });
  it('German: comma is the decimal separator and a dot groups thousands', () => {
    expect(parseMoneyInput('90,50 €', 'de-DE', 1000)).toEqual({ ok: true, value: 90.5 });
    expect(parseMoneyInput('1.250,5', 'de-DE', 2000)).toEqual({ ok: true, value: 1250.5 });
    expect(parseMoneyInput('1.250', 'de-DE', 2000)).toEqual({ ok: true, value: 1250 });
    expect(parseMoneyInput('90', 'de-DE', 1000)).toEqual({ ok: true, value: 90 });
    expect(parseMoneyInput('90,555', 'de-DE', 1000)).toEqual({ ok: false, error: 'not_number' });
  });
  it('kWh', () => {
    expect(parseKwhInput('3,100', 'en-GB')).toBe(3100);
    expect(parseKwhInput('3.100', 'de-DE')).toBe(3100);
    expect(parseKwhInput('3.100,5', 'de-DE')).toBe(3100.5);
    expect(parseKwhInput('0', 'en-GB')).toBeNull();
    expect(parseKwhInput('x', 'de-DE')).toBeNull();
    expect(parseKwhInput('', 'de-DE')).toBeNull();
  });
});

describe('display', () => {
  it('payback text with the English words equals displayPayback exactly', () => {
    for (const r of [
      { low: 5, likely: 7.5, high: 11.5 },
      { low: 8, likely: 11, high: null },
      { low: null, likely: null, high: null },
      { low: 1, likely: 1, high: 1 },
    ]) expect(paybackText(r, 25, GB_STRINGS.years, 'en-GB')).toEqual(displayPayback(r, 25));
  });
  it('German payback words and decimals', () => {
    expect(paybackText({ low: 5, likely: 7.5, high: null }, 20, DE_STRINGS.years, 'de-DE')).toEqual({ kind: 'range', likely: '7,5 Jahre', low: '5 Jahre', high: 'mehr als 20 Jahre' });
    expect(paybackText({ low: 1, likely: 1, high: 1 }, 20, DE_STRINGS.years, 'de-DE')).toEqual({ kind: 'single', value: '1 Jahr' });
  });
  it('kW per locale', () => {
    expect(formatKwLocale(3.1, 'en-GB')).toBe('3.1 kW');
    expect(formatKwLocale(3.1, 'de-DE')).toBe('3,1 kW');
  });
  it('strings are chosen by market and every set has the same shape', () => {
    expect(stringsFor('GB')).toBe(GB_STRINGS);
    expect(stringsFor('DE')).toBe(DE_STRINGS);
    expect(stringsFor('AU')).toBe(AU_STRINGS);
    expect(stringsFor('XX')).toBe(GB_STRINGS);
    expect([idPrefixFor('GB'), idPrefixFor('DE'), idPrefixFor('AU')]).toEqual(['uk', 'de', 'au']);
    const keys = (o: object) => Object.keys(o).filter((k) => k !== 'regionHelpUrl').sort();
    expect(keys(DE_STRINGS)).toEqual(keys(GB_STRINGS));
    expect(keys(AU_STRINGS)).toEqual(keys(GB_STRINGS));
  });
});

describe('chartSource', () => {
  const base = {
    cost: { low: 9000, likely: 12000, high: 15000 },
    paybackYears: { low: 5, likely: 7, high: 10 },
    analysisYears: 25,
    yearlySavings: Array.from({ length: 25 }, () => 1700),
    yearlySavingsLow: Array.from({ length: 25 }, () => 1200),
    yearlySavingsHigh: Array.from({ length: 25 }, () => 2200),
  };
  it('subtracts the likely upfront incentive from the cost line (never below 0) and is the identity with none', () => {
    expect(chartSource({ ...base, upfrontIncentive: { likely: 2700 } }).cost).toEqual({ low: 9000, likely: 9300, high: 15000 });
    expect(chartSource({ ...base, upfrontIncentive: { likely: 99999 } }).cost.likely).toBe(0);
    expect(chartSource({ ...base, upfrontIncentive: { likely: 0 } }).cost).toEqual(base.cost);
  });
  it('the chart cost line follows the net cost', () => {
    const gross = buildSavingsChart(base, '$')!;
    const net = buildSavingsChart(chartSource({ ...base, upfrontIncentive: { likely: 2700 } }), '$')!;
    expect(gross.costLabel).toBe('Upfront cost $12,000');
    expect(net.costLabel).toBe('Upfront cost $9,300');
  });
  it('German labels', () => {
    const c = buildSavingsChart(base, '€', DE_STRINGS.chart)!;
    expect(c.costLabel).toContain('Anschaffungskosten');
    expect(c.crossing?.label).toMatch(/^Amortisiert ~Jahr 7/);
    expect(c.title).toContain('Kumulierte Ersparnis');
  });
});
