import { describe, expect, it } from 'vitest';
import { placeArticleLinks, type ArticleEntry } from './articles';

const e = (id: string, collection: 'guides' | 'blog', over: Partial<ArticleEntry['data']> = {}): ArticleEntry => ({ id, collection, data: { title: id, country: 'gb', updated: new Date('2026-10-01'), noindex: false, ...over } });

describe('placeArticleLinks', () => {
  it('links only live, indexable articles of that country, newest first, under /<cc>/', () => {
    const links = placeArticleLinks([
      e('gb/old', 'guides', { updated: new Date('2026-01-01') }),
      e('gb/new', 'blog', { updated: new Date('2026-11-01') }),
      e('gb/draft', 'guides', { draft: true }),
      e('gb/hidden', 'guides', { noindex: true }),
      e('de/other', 'guides', { country: 'de' }),
    ], 'gb');
    expect(links.map((l) => l.href)).toEqual(['/uk/blog/new', '/uk/guides/old']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 10 }, (_, i) => e(`gb/a${i}`, 'guides'));
    expect(placeArticleLinks(many, 'gb', 4)).toHaveLength(4);
  });
});
