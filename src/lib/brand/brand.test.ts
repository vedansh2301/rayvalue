import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COUNTRY_OUTLINES } from './country-outlines';
import { REGION_BY_SEGMENT } from '../home/global-home';

describe('country outlines', () => {
  it('has a non-empty outline for every country the site covers', () => {
    for (const seg of Object.keys(REGION_BY_SEGMENT)) {
      const o = COUNTRY_OUTLINES[seg];
      expect(o, seg).toBeDefined();
      expect(o!.d.startsWith('M'), seg).toBe(true);
      expect(Math.max(o!.w, o!.h), seg).toBeLessThanOrEqual(100);
    }
  });
});

describe('credits', () => {
  it('credits Natural Earth for the outlines', () => {
    expect(readFileSync('./src/pages/credits.astro', 'utf8')).toMatch(/Natural Earth/);
  });
});
