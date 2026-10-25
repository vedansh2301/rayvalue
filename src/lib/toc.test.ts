import { describe, expect, it } from 'vitest';
import { TOC_MIN_HEADINGS, tocItems } from './toc';

describe('tocItems', () => {
  it('keeps only h2 headings', () => {
    const out = tocItems([
      { depth: 1, slug: 'a', text: 'A' },
      { depth: 2, slug: 'b', text: 'B' },
      { depth: 3, slug: 'c', text: 'C' },
      { depth: 2, slug: 'd', text: 'D' },
    ]);
    expect(out.map((h) => h.slug)).toEqual(['b', 'd']);
  });
  it('threshold is 4', () => expect(TOC_MIN_HEADINGS).toBe(4));
});
