import { describe, expect, it } from 'vitest';
import { captureAttribution, parseAttribution, readAttribution, sanitizeAttribution, STORAGE_KEY } from './attribution';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m } as unknown as Storage & { m: Map<string, string> };
};
const win = (search: string, href: string, referrer: string, s: Storage = store()) =>
  ({ location: { search, href }, document: { referrer }, sessionStorage: s }) as unknown as Window;

describe('parseAttribution', () => {
  it('reads UTMs and click ids; landing page and referrer drop query strings', () => {
    const a = parseAttribution('?utm_source=google&utm_medium=cpc&utm_campaign=fl&utm_term=solar+cost&utm_content=a&gclid=G1&fbclid=F1&zip=33101', 'https://rayvalue.com/calculator/florida?zip=33101', 'https://www.google.com/search?q=x');
    expect(a).toEqual({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'fl', utm_term: 'solar cost', utm_content: 'a', gclid: 'G1', fbclid: 'F1', landing_page: 'https://rayvalue.com/calculator/florida', referrer: 'https://www.google.com/search' });
  });
  it('omits an own-site or missing referrer and absent params', () => {
    expect(parseAttribution('', 'https://rayvalue.com/', 'https://rayvalue.com/guides')).toEqual({ landing_page: 'https://rayvalue.com/' });
    expect(parseAttribution('', 'https://rayvalue.com/', '')).toEqual({ landing_page: 'https://rayvalue.com/' });
  });
  it('strips control characters and markup, caps length', () => {
    const a = parseAttribution(`?utm_source=${encodeURIComponent('a<script>"x"\n')}&utm_term=${'z'.repeat(500)}`, 'https://rayvalue.com/', '');
    expect(a.utm_source).toBe('ascriptx');
    expect(a.utm_term).toHaveLength(200);
  });
});

describe('sanitizeAttribution', () => {
  it('keeps known keys only and ignores non-objects', () => {
    expect(sanitizeAttribution({ gclid: 'a', evil: 'b', utm_source: 5 })).toEqual({ gclid: 'a' });
    for (const bad of [null, 'x', [1], 3, undefined]) expect(sanitizeAttribution(bad)).toEqual({});
  });
});

describe('sessionStorage capture', () => {
  it('captures once on the first page view and never overwrites', () => {
    const s = store();
    captureAttribution(win('?utm_source=fb', 'https://rayvalue.com/', '', s));
    captureAttribution(win('?utm_source=other', 'https://rayvalue.com/quotes', '', s));
    expect(readAttribution(win('', '', '', s))).toMatchObject({ utm_source: 'fb', landing_page: 'https://rayvalue.com/' });
    expect(s.m.has(STORAGE_KEY)).toBe(true);
  });
  it('is safe when storage throws', () => {
    const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(() => captureAttribution(win('', 'https://rayvalue.com/', '', boom))).not.toThrow();
    expect(readAttribution(win('', '', '', boom))).toEqual({});
  });
});
