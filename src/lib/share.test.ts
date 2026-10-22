import { describe, expect, it } from 'vitest';
import { parseShareParams, serializeShareParams, type ShareParams } from './share';

const sample: ShareParams = { zip: '33101', utility: 'fpl', bill: 185.5, battery: 1, shading: 'some' };

describe('serializeShareParams', () => {
  it('writes all five params in a fixed order', () => {
    expect(serializeShareParams(sample)).toBe('?zip=33101&utility=fpl&bill=185.5&battery=1&shading=some');
  });
  it('round-trips through parseShareParams', () => {
    expect(parseShareParams(serializeShareParams(sample))).toEqual(sample);
    const whole: ShareParams = { zip: '94103', utility: 'pge', bill: 200, battery: 0, shading: 'none' };
    expect(parseShareParams(serializeShareParams(whole))).toEqual(whole);
  });
});

describe('parseShareParams', () => {
  it('accepts a query string with or without "?" and URLSearchParams', () => {
    expect(parseShareParams('zip=33101&utility=fpl&bill=185.5&battery=1&shading=some')).toEqual(sample);
    expect(parseShareParams(new URLSearchParams('?shading=some&battery=1&bill=185.5&utility=fpl&zip=33101'))).toEqual(sample);
  });
  it('returns null when any param is missing', () => {
    for (const drop of ['zip', 'utility', 'bill', 'battery', 'shading']) {
      const q = new URLSearchParams(serializeShareParams(sample));
      q.delete(drop);
      expect(parseShareParams(q), drop).toBeNull();
    }
    expect(parseShareParams('')).toBeNull();
  });
  it('rejects malformed values', () => {
    const bad = (k: string, v: string) => {
      const q = new URLSearchParams(serializeShareParams(sample));
      q.set(k, v);
      return parseShareParams(q);
    };
    expect(bad('zip', '3310')).toBeNull();
    expect(bad('zip', '33101-1234')).toBeNull();
    expect(bad('utility', 'FPL<script>')).toBeNull();
    expect(bad('utility', '')).toBeNull();
    expect(bad('bill', '0')).toBeNull();
    expect(bad('bill', '-5')).toBeNull();
    expect(bad('bill', '1e3')).toBeNull();
    expect(bad('bill', '12.345')).toBeNull();
    expect(bad('bill', 'abc')).toBeNull();
    expect(bad('battery', '3')).toBeNull();
    expect(bad('battery', 'one')).toBeNull();
    expect(bad('shading', 'partial')).toBeNull();
  });
  it('trims whitespace', () => {
    expect(parseShareParams('zip=%2033101%20&utility=fpl&bill=185.5&battery=1&shading=some')).toEqual(sample);
  });
});
