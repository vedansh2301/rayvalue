import { describe, expect, it } from 'vitest';
import { guideCountries, guideTopic, roundRobin } from './guides-index';

const t = (slug: string, title = '') => guideTopic({ slug, title });
describe('guideTopic', () => {
  it('classifies by slug and title', () => {
    expect(t('solar-quote-red-flags')).toBe('scams');
    expect(t('home-battery-guide')).toBe('battery');
    expect(t('lohnt-sich-photovoltaik')).toBe('worth');
    expect(t('solar-panels-vat-deadline-2027')).toBe('money');
    expect(t('smart-export-guarantee-explained')).toBe('export');
    expect(t('right-size-your-system')).toBe('costs');
    expect(t('how-solar-works')).toBe('how');
  });
  it('scams win over batteries', () => expect(t('battery-scam-warning')).toBe('scams'));
});
describe('roundRobin', () => {
  it('interleaves countries and keeps each country in order', () => {
    const r = roundRobin([{ c: 'a', n: 1 }, { c: 'a', n: 2 }, { c: 'b', n: 3 }, { c: 'a', n: 4 }, { c: 'b', n: 5 }], (x) => x.c);
    expect(r.map((x) => x.n)).toEqual([1, 3, 2, 5, 4]);
  });
});
describe('guideCountries', () => {
  it('sorts by count then name', () => {
    expect(guideCountries([{ segment: 'de' }, { segment: 'uk' }, { segment: 'uk' }, { segment: 'at' }], (s) => s).map((c) => c.segment)).toEqual(['uk', 'at', 'de']);
  });
});
