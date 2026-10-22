import { describe, expect, it } from 'vitest';
import { UNLISTED_UTILITY, inputsKey, joinNames, parseBill, resultsStale, utilityChoice } from './form';

describe('parseBill', () => {
  it('parses plain and formatted dollar amounts', () => {
    expect(parseBill('185', 5000)).toEqual({ ok: true, value: 185 });
    expect(parseBill(' $1,250.50 ', 5000)).toEqual({ ok: true, value: 1250.5 });
  });
  it('rejects empty and non-numeric input', () => {
    expect(parseBill('  ', 5000)).toEqual({ ok: false, error: 'empty' });
    expect(parseBill('abc', 5000)).toEqual({ ok: false, error: 'not_number' });
    expect(parseBill('-20', 5000)).toEqual({ ok: false, error: 'not_number' });
    expect(parseBill('1e3', 5000)).toEqual({ ok: false, error: 'not_number' });
    expect(parseBill('12.345', 5000)).toEqual({ ok: false, error: 'not_number' });
  });
  it('enforces bounds', () => {
    expect(parseBill('0', 5000)).toEqual({ ok: false, error: 'too_low' });
    expect(parseBill('5000', 5000)).toEqual({ ok: true, value: 5000 });
    expect(parseBill('5000.01', 5000)).toEqual({ ok: false, error: 'too_high' });
  });
});

describe('utilityChoice', () => {
  const ids = ['fpl', 'duke-fl', 'teco'];
  it('distinguishes listed, unlisted and no choice', () => {
    expect(utilityChoice('fpl', ids)).toEqual({ kind: 'listed', id: 'fpl' });
    expect(utilityChoice(UNLISTED_UTILITY, ids)).toEqual({ kind: 'unlisted' });
    expect(utilityChoice('', ids)).toEqual({ kind: 'none' });
    expect(utilityChoice('pge', ids)).toEqual({ kind: 'none' }); // another state's utility
  });
  it('the unlisted value can never collide with a utility id', () => {
    expect(ids).not.toContain(UNLISTED_UTILITY);
    expect(['fpl', 'duke-fl', 'teco', 'pge', 'sce', 'sdge']).not.toContain(UNLISTED_UTILITY);
  });
});

describe('joinNames', () => {
  it('joins with commas and "and"', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('resultsStale', () => {
  const base = { zip: '33101', utilityId: 'fpl', billRaw: '200', battery: 0, shading: 'none' };
  it('is false before any run and when answers match (ignoring cosmetic bill formatting)', () => {
    expect(resultsStale(null, base)).toBe(false);
    expect(resultsStale(inputsKey(base), base)).toBe(false);
    expect(resultsStale(inputsKey(base), { ...base, zip: ' 33101 ', billRaw: '$200' })).toBe(false);
  });
  it('is true when any answer changed', () => {
    const ran = inputsKey(base);
    for (const patch of [{ zip: '33102' }, { utilityId: 'teco' }, { billRaw: '210' }, { battery: 1 }, { shading: 'some' }]) {
      expect(resultsStale(ran, { ...base, ...patch }), JSON.stringify(patch)).toBe(true);
    }
  });
});
