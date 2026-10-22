import { describe, it, expect } from 'vitest';
import { guideFlags, excludedGuideUrls, hasPublishedGuides } from './guide-flags';

describe('guide flags', () => {
  it('defaults noindex true, draft false', () => {
    expect(guideFlags('---\ntitle: x\n---\nbody')).toEqual({ noindex: true, draft: false });
  });
  it('reads explicit values', () => {
    expect(guideFlags('---\nnoindex: false\ndraft: true\n---\n')).toEqual({ noindex: false, draft: true });
  });
  it('excludes noindex and draft guides only', () => {
    const s = excludedGuideUrls([
      { id: 'a', noindex: true, draft: false },
      { id: 'b', noindex: false, draft: true },
      { id: 'c', noindex: false, draft: false },
    ]);
    expect([...s].sort()).toEqual(['/guides/a', '/guides/b']);
  });
  it('excludes /guides itself while every guide is a draft', () => {
    const all = [{ id: 'a', noindex: true, draft: true }, { id: 'b', noindex: false, draft: true }];
    expect(hasPublishedGuides(all)).toBe(false);
    expect([...excludedGuideUrls(all)].sort()).toEqual(['/guides', '/guides/a', '/guides/b']);
    expect(hasPublishedGuides([...all, { id: 'c', noindex: true, draft: false }])).toBe(true);
    expect(excludedGuideUrls([{ id: 'c', noindex: true, draft: false }]).has('/guides')).toBe(false);
  });
});
