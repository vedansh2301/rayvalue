import { describe, expect, it } from 'vitest';
import { UK_REGION_DOTS, answeredCount, rateBarPct, regionDot, sliderPosition, zeroVatDaysLeft, zeroVatEnd } from './design';

const solar = (rate: number, from: string | null, to: string | null) => ({ applies_to: 'solar' as const, rate, valid_from: from, valid_to: to });

describe('zeroVatDaysLeft', () => {
  const vat = [solar(0, null, '2027-03-31'), solar(0.05, '2027-04-01', null), { applies_to: 'battery' as const, rate: 0, valid_from: null, valid_to: '2027-03-31' }];
  it('counts whole days to the end of the 0% window', () => {
    expect(zeroVatDaysLeft(vat, '2026-11-22')).toBe(129);
    expect(zeroVatDaysLeft(vat, '2027-03-31')).toBe(0);
  });
  it('is null when the window has ended or never ends', () => {
    expect(zeroVatDaysLeft(vat, '2027-04-01')).toBeNull();
    expect(zeroVatDaysLeft([solar(0, null, null)], '2026-11-22')).toBeNull();
    expect(zeroVatEnd(vat, '2026-11-22')).toBe('2027-03-31');
  });
});
describe('answeredCount', () => {
  it('counts the six UK questions, or five when there is no install question', () => {
    expect(answeredCount({ region: true, usage: false, roof: true, shade: false, install: false, offer: false })).toEqual({ done: 2, total: 6 });
    expect(answeredCount({ region: true, usage: true, roof: true, shade: true, install: null, offer: true })).toEqual({ done: 5, total: 5 });
  });
});
describe('rateBarPct / sliderPosition / regionDot', () => {
  it('bars are a share of the top rate', () => {
    expect(rateBarPct(6, 12)).toBe(50);
    expect(rateBarPct(null, 12)).toBe(0);
    expect(rateBarPct(5, 0)).toBe(0);
  });
  it('slider thumb is clamped', () => {
    expect(sliderPosition('bill', 90)).toBe(90);
    expect(sliderPosition('bill', 999)).toBe(400);
    expect(sliderPosition('kwh', null)).toBe(500);
  });
  it('maps all 14 regions and ignores the DB suffix', () => {
    expect(Object.keys(UK_REGION_DOTS)).toHaveLength(14);
    expect(regionDot('London (Ofgem price cap region)')).toEqual([48, 82]);
    expect(regionDot('Bayern')).toBeNull();
  });
});
