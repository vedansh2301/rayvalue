import { describe, it, expect } from 'vitest';
import { guideFlags, excludedGuideUrls } from './guide-flags';

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
});
