import { describe, expect, it } from 'vitest';
import { OG_PAGES, ogImagePath } from './og';

describe('og cards', () => {
  it('each key page has its own title and image path', () => {
    const keys = Object.keys(OG_PAGES) as (keyof typeof OG_PAGES)[];
    expect(keys.length).toBe(5);
    expect(new Set(keys.map((k) => OG_PAGES[k].title)).size).toBe(keys.length);
    expect(new Set(keys.map(ogImagePath)).size).toBe(keys.length);
    expect(ogImagePath('quotes')).toBe('/og/quotes.png');
  });
});
