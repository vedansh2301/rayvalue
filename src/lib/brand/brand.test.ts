import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COUNTRY_OUTLINES } from './country-outlines';
import { RAY_POSES, rayMarkSvg } from './ray';
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

describe('Ray the mascot', () => {
  const src = readFileSync('./src/components/brand/Ray.astro', 'utf8');
  it('is pure inline SVG: no style attribute, no script, no external reference', () => {
    expect(src.split('---')[2]).not.toMatch(/\sstyle=|<script|<image|href=/);
  });
  it('draws every pose', () => {
    for (const p of RAY_POSES.filter((x) => x !== 'mark')) expect(src, p).toContain(`pose === '${p}'`);
  });
  it('the OG card face is a valid standalone svg', () => {
    expect(rayMarkSvg()).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  });
});

describe('credits', () => {
  it('credits Natural Earth for the outlines', () => {
    expect(readFileSync('./src/pages/credits.astro', 'utf8')).toMatch(/Natural Earth/);
  });
});
