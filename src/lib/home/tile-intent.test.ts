import { describe, expect, it } from 'vitest';
import { tileIntent, type HomeArticle } from './global-home';

const now = new Date('2026-11-22T00:00:00Z');
const art = (o: Partial<HomeArticle>): HomeArticle => ({ collection: 'guides', id: 'x', country: 'at', lang: 'de-AT', title: 'T', description: 'd', ...o });

describe('tileIntent', () => {
  it('a country with a calculator goes straight to it', () => {
    const i = tileIntent({ segment: 'de', href: '/de', name: 'Germany' }, [], [], now);
    expect(i.href).toBe('/de/photovoltaik-rechner');
    expect(i.action).toBe('Calculate your payback');
  });
  it('without a calculator, the worth-it guide is the destination and its title is the hint', () => {
    const a = art({ country: 'fr', id: 'fr/panneaux-solaires-rentables-ou-pas-2026', title: 'Panneaux solaires : rentables ?', lang: 'fr-FR' });
    const i = tileIntent({ segment: 'fr', href: '/fr', name: 'France' }, [a], [{ country: 'fr', slug: 'panneaux-solaires-rentables-ou-pas-2026' }], now);
    expect(i.href).toContain('/fr/');
    expect(i.action).toBe('Is solar worth it here?');
    expect(i.hint).toBe('Panneaux solaires : rentables ?');
    expect(i.hintKind).toBe('guide');
  });
  it('an upcoming dated deadline wins the hint; past deadlines and noindex articles are ignored', () => {
    const past = art({ title: 'Old', deadline: new Date('2026-01-01') });
    const hidden = art({ title: 'Hidden', deadline: new Date('2026-12-01'), noindex: true });
    const soon = art({ title: 'Grant closes', deadline: new Date('2027-03-31') });
    const i = tileIntent({ segment: 'at', href: '/at', name: 'Austria' }, [past, hidden, soon], [], now);
    expect(i.hint).toBe('Deadline 31 Mar 2027: Grant closes');
    expect(i.hintKind).toBe('deadline');
    expect(i.href).toBe('/at');
    expect(i.action).toBe('Grants, rates and costs');
  });
});
