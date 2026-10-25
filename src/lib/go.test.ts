import { describe, expect, it } from 'vitest';
import { GO_FAQ_IDS, GO_PAGES, isGoPath } from './go';
import { faqItems } from './content/faq';

describe('/go landing pages', () => {
  it('are /go/fl and /go/ca', () => {
    expect(GO_PAGES.map((g) => g.path)).toEqual(['/go/fl', '/go/ca']);
    expect(isGoPath('/go/fl/')).toBe(true);
    expect(isGoPath('/calculator/florida')).toBe(false);
  });
  it('FAQ ids exist', () => {
    expect(faqItems(GO_FAQ_IDS)).toHaveLength(GO_FAQ_IDS.length);
  });
});
