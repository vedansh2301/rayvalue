import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { articleEntries, staticEntries, type ArticleInput } from './static-entries';
import { countryOf, pageTypeOf, SITEMAP_FILE_RE } from './site-index';
import { llmsPageUrls, renderCountryLlms, renderRootLlms } from './llms';
import { renderSitemaps } from './sitemaps';
import { articleIndexPath, articlePath, articleSlug, countrySegment } from '../content/paths';
import { pickOffers } from '../offers/load';
import type { AffiliateOfferRow } from '../offers/offers';

const gbGuide: ArticleInput = { collection: 'guides', id: 'gb/solar-for-uk-homes', country: 'gb', title: 'UK guide', description: 'A UK guide.', updated: '2026-11-02', draft: false, noindex: false };
const gbPost: ArticleInput = { collection: 'blog', id: 'gb/uk-post', country: 'gb', title: 'UK post', description: 'A UK post.', published: '2026-11-03', draft: false, noindex: false };
const usGuide: ArticleInput = { collection: 'guides', id: 'solar-lease-vs-buy', title: 'US guide', description: 'A US guide.', updated: '2026-10-01', draft: false, noindex: false };
const gbDraft: ArticleInput = { ...gbGuide, id: 'gb/draft', draft: true };
const gbNoindex: ArticleInput = { ...gbGuide, id: 'gb/hidden', noindex: true };
const deHidden: ArticleInput = { collection: 'blog', id: 'de/x', country: 'de', title: 'DE', description: 'DE', published: '2026-11-01', noindex: true };

const all = (a: ArticleInput[]) => [...staticEntries(a), ...articleEntries(a)];

describe('article routes', () => {
  it('maps country to URL segment (GB is /uk/)', () => {
    expect(countrySegment('gb')).toBe('uk');
    expect(countrySegment('de')).toBe('de');
    expect(articleSlug('gb/foo', 'gb')).toBe('foo');
    expect(articlePath('guides', 'gb/foo', undefined, 'gb')).toBe('/uk/guides/foo');
    expect(articlePath('blog', 'de/bar', '/ignored', 'de')).toBe('/de/blog/bar');
    expect(articleIndexPath('blog', 'gb')).toBe('/uk/blog');
  });

  it('US URLs are unchanged, including keyword routes', () => {
    expect(articlePath('guides', 'solar-lease-vs-buy')).toBe('/guides/solar-lease-vs-buy');
    expect(articlePath('guides', 'x', '/us/solar-tax-benefits/florida', 'us')).toBe('/us/solar-tax-benefits/florida');
    expect(articleIndexPath('guides')).toBe('/guides');
  });

  it('classifies non-US article paths by country and type', () => {
    expect(countryOf('/uk/guides/foo')).toBe('uk');
    expect(pageTypeOf('/uk/blog/foo')).toBe('articles');
    expect(pageTypeOf('/uk/guides')).toBe('articles');
    expect(countryOf('/guides/foo')).toBe('global');
    expect(SITEMAP_FILE_RE.test('sitemap-uk-articles.xml')).toBe(true);
  });
});

describe('sitemap and llms inclusion', () => {
  const entries = all([gbGuide, gbPost, usGuide, gbDraft, gbNoindex, deHidden]);
  const sm = renderSitemaps(entries);

  it('lists sitemap-uk-articles.xml with the indexable entries and index pages only', () => {
    expect(sm.index).toContain('/sitemap-uk-articles.xml');
    const body = sm.files.get('sitemap-uk-articles.xml')!;
    for (const p of ['/uk/guides/solar-for-uk-homes', '/uk/blog/uk-post', '/uk/guides', '/uk/blog']) expect(body).toContain(`https://rayvalue.com${p}<`);
    expect(body).not.toContain('draft');
    expect(body).not.toContain('hidden');
  });

  it('adds no file for a country whose articles are all noindex or draft', () => {
    expect(sm.index).not.toContain('sitemap-de-');
    expect(sm.files.has('sitemap-de-articles.xml')).toBe(false);
    expect(renderSitemaps(all([usGuide, gbDraft, gbNoindex])).index).not.toContain('sitemap-uk-articles.xml');
  });

  it('US /guides index does not list non-US entries in its lastmod or paths', () => {
    expect(entries.filter((e) => e.path === '/guides')).toHaveLength(1);
    expect(entries.find((e) => e.path === '/guides')!.lastmod).toBe('2026-10-01');
  });

  it('root llms links /uk/llms.txt; /uk/llms.txt lists its articles; every sitemap URL is in llms', () => {
    const root = renderRootLlms(entries);
    expect(root).toContain('https://rayvalue.com/uk/llms.txt');
    expect(root).not.toContain('/de/llms.txt');
    const uk = renderCountryLlms(entries, 'uk');
    expect(uk).toContain('https://rayvalue.com/uk/guides/solar-for-uk-homes');
    expect(uk).toContain('https://rayvalue.com/uk/blog/uk-post');
    expect(uk).not.toContain('draft');
    expect(llmsPageUrls(root)).not.toContain('https://rayvalue.com/uk/llms.txt');
  });
});

describe('fixture non-US content is never published', () => {
  for (const f of ['src/content/guides/gb/intl-fixture.mdx', 'src/content/blog/gb/intl-fixture.mdx']) {
    it(`${f} is draft and noindex, country gb`, () => {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/^draft: true$/m);
      expect(src).toMatch(/^noindex: true$/m);
      expect(src).toMatch(/^country: gb$/m);
    });
  }
});

describe('offers are filtered by article country', () => {
  const row = (o: Partial<AffiliateOfferRow>): AffiliateOfferRow => ({
    id: 'i', slug: 's', brand: 'B', program: null, network: null, country: 'US', category: 'battery',
    destination_url_template: 'https://example.com/?a=1', cta_text: 'See', headline: null, description: null, price_text: null,
    price_source_url: null, price_verified_on: null, disclosure_key: 'affiliate_standard', active: true, starts_at: null, ends_at: null, ...o,
  });
  const now = new Date('2026-11-22T12:00:00Z');
  const rows = [row({ id: '1', slug: 'us-only', brand: 'UsOnly' }), row({ id: '2', slug: 'gb-only', brand: 'GbOnly', country: 'GB' }), row({ id: '3', slug: 'global', brand: 'Global', country: null })];

  it('US pages never show GB offers and non-US pages never show US-only offers', () => {
    expect(pickOffers(rows, ['battery'], 5, now).map((o) => o.brand)).toEqual(['Global', 'UsOnly']);
    expect(pickOffers(rows, ['battery'], 5, now, 'gb').map((o) => o.brand)).toEqual(['GbOnly', 'Global']);
    expect(pickOffers(rows, ['battery'], 5, now, 'de').map((o) => o.brand)).toEqual(['Global']);
  });
});
