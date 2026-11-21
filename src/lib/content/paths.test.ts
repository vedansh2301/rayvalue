import { describe, expect, it } from 'vitest';
import { articlePath, routeRedirects } from './paths';

describe('articlePath', () => {
  it('uses the keyword route when set', () => {
    expect(articlePath('guides', 'florida-solar-tax-benefits-2026', '/us/solar-tax-benefits/florida')).toBe('/us/solar-tax-benefits/florida');
  });
  it('falls back to /<collection>/<id>', () => {
    expect(articlePath('blog', 'solar-and-ev-charging')).toBe('/blog/solar-and-ev-charging');
  });
});

describe('routeRedirects', () => {
  it('maps only routed entries', () => {
    expect(routeRedirects([
      { collection: 'guides', id: 'solar-tax-benefits-2026', route: '/us/solar-tax-benefits' },
      { collection: 'guides', id: 'solar-lease-vs-buy' },
    ])).toEqual({ '/guides/solar-tax-benefits-2026': '/us/solar-tax-benefits' });
  });
});
