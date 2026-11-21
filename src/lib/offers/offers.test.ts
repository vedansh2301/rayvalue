import { describe, expect, it } from 'vitest';
import { batteryRelevant, placementFor } from './placement';
import { disclosureText } from './disclosure';
import { pickOffers } from './load';
import {
  classifyUa,
  cleanCountry,
  cleanPagePath,
  isLive,
  livePublicOffers,
  outHref,
  resolveDestination,
  summariseClicks,
  toPublicOffer,
  type AffiliateOfferRow,
} from './offers';

const row = (o: Partial<AffiliateOfferRow> = {}): AffiliateOfferRow => ({
  id: 'id-1',
  slug: 'brand-a',
  brand: 'Brand A',
  program: null,
  network: null,
  country: 'US',
  category: 'battery',
  destination_url_template: 'https://example.com/?aff=XYZ&sub={slug}',
  cta_text: 'See it',
  headline: null,
  description: null,
  price_text: null,
  price_source_url: null,
  price_verified_on: null,
  disclosure_key: 'affiliate_standard',
  active: true,
  starts_at: null,
  ends_at: null,
  ...o,
});
const NOW = new Date('2026-11-22T12:00:00Z');

describe('isLive', () => {
  it('needs active and a destination', () => {
    expect(isLive(row(), NOW)).toBe(true);
    expect(isLive(row({ active: false }), NOW)).toBe(false);
    expect(isLive(row({ destination_url_template: null }), NOW)).toBe(false);
  });
  it('respects the window and fails closed on a bad date', () => {
    expect(isLive(row({ starts_at: '2026-12-01T00:00:00Z' }), NOW)).toBe(false);
    expect(isLive(row({ ends_at: '2026-11-22T12:00:00Z' }), NOW)).toBe(false);
    expect(isLive(row({ starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' }), NOW)).toBe(true);
    expect(isLive(row({ ends_at: 'not a date' }), NOW)).toBe(false);
  });
});

describe('public offers', () => {
  it('never exposes the destination or affiliate id', () => {
    const p = toPublicOffer(row());
    expect(JSON.stringify(p)).not.toContain('XYZ');
    expect(JSON.stringify(p)).not.toContain('example.com');
  });
  it('shows a price only with source and check date', () => {
    expect(toPublicOffer(row({ price_text: '$99' })).priceText).toBeNull();
    expect(toPublicOffer(row({ price_text: '$99', price_source_url: 'https://x.test', price_verified_on: '2026-11-01' })).priceText).toBe('$99');
  });
  it('filters by category and country, sorted by brand; no live offers gives an empty list', () => {
    const rows = [row({ id: '2', slug: 'z', brand: 'Zed' }), row({ id: '3', slug: 'a', brand: 'Alpha' }), row({ id: '4', slug: 'p', category: 'solar_marketplace' }), row({ id: '5', slug: 'q', active: false }), row({ id: '6', slug: 'r', country: 'GB' })];
    expect(livePublicOffers(rows, NOW, { categories: ['battery'], country: 'US' }).map((o) => o.brand)).toEqual(['Alpha', 'Zed']);
    expect(pickOffers([], ['battery'], 3, NOW)).toEqual([]);
    expect(pickOffers(rows, ['battery'], 1, NOW)).toHaveLength(1);
  });
});

describe('paths and destination', () => {
  it('cleans page paths', () => {
    expect(cleanPagePath('/guides/x?utm=1#h')).toBe('/guides/x');
    expect(cleanPagePath('//evil.com')).toBeNull();
    expect(cleanPagePath('https://evil.com/x')).toBeNull();
    expect(cleanPagePath('/a b')).toBeNull();
    expect(cleanPagePath('/' + 'a'.repeat(250))).toBeNull();
    expect(cleanPagePath(null)).toBeNull();
  });
  it('builds the click href', () => {
    expect(outHref('brand-a', '/guides/x')).toBe('/go/out/brand-a?p=%2Fguides%2Fx');
    expect(outHref('brand-a', 'bad')).toBe('/go/out/brand-a');
  });
  it('fills placeholders and only returns https', () => {
    expect(resolveDestination('https://e.com/?s={slug}&p={page}', 'a-b', '/g/x')).toBe('https://e.com/?s=a-b&p=%2Fg%2Fx');
    expect(resolveDestination('https://e.com/?p={page}', 'a', null)).toBe('https://e.com/?p=');
    expect(resolveDestination('https://e.com/?x={unknown}', 'a', null)).toBeNull();
    expect(resolveDestination('http://e.com/', 'a', null)).toBeNull();
    expect(resolveDestination('javascript:alert(1)', 'a', null)).toBeNull();
    expect(resolveDestination(null, 'a', null)).toBeNull();
  });
});

describe('click helpers', () => {
  it('classifies the user agent coarsely', () => {
    expect(classifyUa('Googlebot/2.1')).toBe('bot');
    expect(classifyUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17) Mobile Safari')).toBe('mobile');
    expect(classifyUa('Mozilla/5.0 (iPad; CPU OS 17)')).toBe('tablet');
    expect(classifyUa('Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari')).toBe('desktop');
    expect(classifyUa(null)).toBe('other');
  });
  it('validates country', () => {
    expect(cleanCountry('us')).toBe('US');
    expect(cleanCountry('USA')).toBeNull();
    expect(cleanCountry(null)).toBeNull();
  });
  it('summarises human clicks per offer and page, bots apart, empty offers listed', () => {
    const offers = [{ id: 'a', slug: 'a', brand: 'A' }, { id: 'b', slug: 'b', brand: 'B' }];
    const c = (offer_id: string, page_path: string | null, ua_class: 'mobile' | 'bot' = 'mobile') => ({ offer_id, page_path, ua_class, clicked_at: '2026-11-22T00:00:00Z' });
    const s = summariseClicks(offers, [c('a', '/g/1'), c('a', '/g/1'), c('a', '/g/2'), c('a', '/g/1', 'bot'), c('a', null), c('zzz', '/x')]);
    expect(s.byOffer).toEqual([
      { offerId: 'a', slug: 'a', brand: 'A', clicks: 4, botClicks: 1 },
      { offerId: 'b', slug: 'b', brand: 'B', clicks: 0, botClicks: 0 },
    ]);
    expect(s.byPage[0]).toEqual({ offerId: 'a', slug: 'a', page: '/g/1', clicks: 2 });
    expect(s.byPage.map((p) => p.page)).toContain('(unknown)');
  });
});

describe('placement', () => {
  it('shows on battery pages and results pages only', () => {
    expect(batteryRelevant({ kind: 'guide', id: 'california-nem-3-batteries' })).toBe(true);
    expect(batteryRelevant({ kind: 'blog', id: 'home-battery-costs-and-backup', tags: ['batteries'] })).toBe(true);
    expect(batteryRelevant({ kind: 'blog', id: 'x', tags: ['Backup-Power'] })).toBe(true);
    expect(batteryRelevant({ kind: 'guide', id: 'x', topic: 'battery' })).toBe(true);
    expect(batteryRelevant({ kind: 'guide', id: 'solar-lease-vs-buy' })).toBe(false);
    expect(batteryRelevant({ kind: 'results', id: 'FL' })).toBe(true);
    expect(placementFor({ kind: 'guide', id: 'solar-lease-vs-buy' })).toEqual({ show: false, categories: [], max: 0 });
    expect(placementFor({ kind: 'results', id: 'CA' }).show).toBe(true);
  });
});

describe('disclosure text', () => {
  it('falls back to the standard wording for an unknown key', () => {
    expect(disclosureText('nope')).toBe(disclosureText('affiliate_standard'));
    expect(disclosureText(undefined)).toContain('affiliate links');
  });
});
