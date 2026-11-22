import { describe, expect, it } from 'vitest';
import { pickCountryOffers } from './load';
import type { AffiliateOfferRow } from './offers';

const row = (o: Partial<AffiliateOfferRow> = {}): AffiliateOfferRow => ({
  id: 'id-1', slug: 'brand-a', brand: 'Brand A', program: null, network: null, country: 'GB', category: 'solar_marketplace',
  destination_url_template: 'https://example.com/?sub={slug}', cta_text: 'See it', headline: null, description: null, price_text: null,
  price_source_url: null, price_verified_on: null, disclosure_key: 'affiliate_standard', active: true, starts_at: null, ends_at: null, ...o,
});
const NOW = new Date('2026-11-22T12:00:00Z');

describe('pickCountryOffers (UK calculator slot)', () => {
  it('shows only live offers that name the country, in any category', () => {
    const rows = [row({ id: 'a', slug: 'a', brand: 'A' }), row({ id: 'b', slug: 'b', brand: 'B', category: 'battery' }), row({ id: 'c', slug: 'c', brand: 'C', country: 'US' }), row({ id: 'd', slug: 'd', brand: 'D', country: null }), row({ id: 'e', slug: 'e', brand: 'E', active: false })];
    expect(pickCountryOffers(rows, 'gb', 3, NOW).map((o) => o.brand)).toEqual(['A', 'B']);
  });
  it('renders nothing when no GB offer exists (the slot then shows no heading or disclosure)', () => {
    expect(pickCountryOffers([row({ country: 'US' }), row({ country: null })], 'GB', 3, NOW)).toEqual([]);
    expect(pickCountryOffers([], 'GB', 3, NOW)).toEqual([]);
  });
  it('caps the number shown', () => {
    const rows = ['a', 'b', 'c', 'd'].map((s) => row({ id: s, slug: s, brand: s.toUpperCase() }));
    expect(pickCountryOffers(rows, 'GB', 2, NOW)).toHaveLength(2);
  });
});
