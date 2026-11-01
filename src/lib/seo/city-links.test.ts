import { describe, it, expect } from 'vitest';
import { cityLinksFrom } from './city-links';
import type { City } from '../../data/schemas';

const city = (state: 'FL' | 'CA', slug: string, name: string, published: boolean, utility = 'fpl') =>
  ({ state, slug, name, published, default_utility_id: utility }) as unknown as City;

describe('cityLinksFrom', () => {
  it('links only published cities, sorted by state then name, at /solar/<state>/<slug>', () => {
    const links = cityLinksFrom([
      city('FL', 'tampa', 'Tampa', true, 'teco'),
      city('CA', 'fresno', 'Fresno', true, 'pge'),
      city('FL', 'miami', 'Miami', true),
      city('FL', 'brandon', 'Brandon', false),
    ]);
    expect(links.map((l) => l.href)).toEqual(['/solar/california/fresno', '/solar/florida/miami', '/solar/florida/tampa']);
    expect(links[2]).toMatchObject({ name: 'Tampa', utilityId: 'teco', state: 'FL' });
  });

  it('never links a city slug that is reserved for a utility page', () => {
    expect(cityLinksFrom([city('FL', 'fpl', 'FPL', true)])).toEqual([]);
  });
});
