import { describe, expect, it } from 'vitest';
import { NAV_MIN_PUBLISHED, headerLinks, showInNav } from './nav';

describe('header nav', () => {
  it('hides a collection below the threshold and shows it at the threshold', () => {
    expect(NAV_MIN_PUBLISHED).toBe(3);
    expect(showInNav(0)).toBe(false);
    expect(showInNav(2)).toBe(false);
    expect(showInNav(3)).toBe(true);
  });
  it('always keeps the two calculators; guides and blog are independent', () => {
    expect(headerLinks({ guides: 0, blog: 0 }).map((l) => l.href)).toEqual(['/calculator/florida', '/calculator/california']);
    expect(headerLinks({ guides: 3, blog: 1 }).map((l) => l.href)).toEqual(['/calculator/florida', '/calculator/california', '/guides']);
    expect(headerLinks({ guides: 5, blog: 4 }).map((l) => l.href)).toContain('/blog');
    expect(headerLinks({ guides: 1, blog: 1 }, 1).map((l) => l.href)).toContain('/guides');
  });
});
