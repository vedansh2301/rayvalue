import { describe, expect, it } from 'vitest';
import { byPriority } from './place-priority';

const e = (slug: string, name: string) => ({ path: `/de/photovoltaik/x/${slug}`, name });
describe('byPriority', () => {
  const items = [e('aachen', 'Aachen'), e('koeln', 'Köln'), e('muenchen', 'München'), e('bonn', 'Bonn')];
  it('puts priority places first in editorial order, then alphabetical', () => {
    expect(byPriority('de', items).map((x) => x.name)).toEqual(['München', 'Köln', 'Aachen', 'Bonn']);
  });
  it('falls back to alphabetical for unlisted countries and does not mutate', () => {
    expect(byPriority('zz', items).map((x) => x.name)).toEqual(['Aachen', 'Bonn', 'Köln', 'München']);
    expect(items[0]!.name).toBe('Aachen');
  });
});
