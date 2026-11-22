import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import credits from '../../data/images/credits.json';
import { creditLine, creditsTableOrder, licenseCounts, needsVisibleCredit, pickPhoto, validateCredits, type PhotoCredit } from './library';

const mk = (o: Partial<PhotoCredit> & { id: string }): PhotoCredit => ({
  scope: 'country', country: 'de', file: 'de/de.jpg', alt: 'x', focus: 'center', title: 't', source_url: 'https://commons.wikimedia.org/wiki/File:T.jpg',
  author: 'A', license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution_required: true, width: 10, height: 5, verified_on: '2026-11-22', ...o,
});

describe('pickPhoto', () => {
  const list = [mk({ id: 'de' }), mk({ id: 'de-m', scope: 'city', place: 'muenchen', file: 'de/muenchen.jpg' }), mk({ id: 'us-florida', scope: 'state', country: 'us', place: 'florida', file: 'us/florida.jpg' }), mk({ id: 'us', country: 'us', file: 'us/us.jpg' })];
  it('prefers the exact place, then the country', () => {
    expect(pickPhoto(list, { country: 'de', place: 'muenchen' })?.id).toBe('de-m');
    expect(pickPhoto(list, { country: 'de', place: 'berlin' })?.id).toBe('de');
    expect(pickPhoto(list, { country: 'us', place: 'florida' })?.id).toBe('us-florida');
    expect(pickPhoto(list, { country: 'us' })?.id).toBe('us');
  });
  it('returns null for a country without photos', () => {
    expect(pickPhoto(list, { country: 'fr' })).toBeNull();
  });
  it('never uses a city photo as the country photo', () => {
    expect(pickPhoto([list[1]!], { country: 'de' })).toBeNull();
  });
  it('seed picks stably among several country photos', () => {
    const two = [mk({ id: 'a' }), mk({ id: 'b', file: 'de/de-2.jpg' })];
    expect(pickPhoto(two, { country: 'de' }, 'post-1')?.id).toBe(pickPhoto(two, { country: 'de' }, 'post-1')?.id);
    expect(pickPhoto(two, { country: 'de' })?.id).toBe('a');
  });
});

describe('credits helpers', () => {
  it('formats the visible credit and truncates long names', () => {
    expect(creditLine({ author: 'Diliff', license: 'CC BY-SA 3.0' })).toBe('Photo: Diliff, CC BY-SA 3.0');
    expect(creditLine({ author: 'x'.repeat(80), license: 'CC BY 4.0' }).length).toBeLessThan(80);
  });
  it('only CC BY and CC BY-SA need a visible credit', () => {
    expect(needsVisibleCredit(mk({ id: 'a' }))).toBe(true);
    expect(needsVisibleCredit(mk({ id: 'b', attribution_required: false }))).toBe(false);
  });
  it('counts licences and orders the table by country then scope', () => {
    const l = [mk({ id: 'c', scope: 'city', place: 'x', file: 'de/x.jpg' }), mk({ id: 'd' }), mk({ id: 'e', country: 'at', file: 'at/at.jpg', license: 'CC0 1.0', attribution_required: false, license_url: null })];
    expect(licenseCounts(l)).toEqual({ 'CC BY-SA 4.0': 2, 'CC0 1.0': 1 });
    expect(creditsTableOrder(l).map((p) => p.id)).toEqual(['e', 'd', 'c']);
  });
});

describe('validateCredits', () => {
  it('flags forbidden licences, missing sources and mismatched attribution flags', () => {
    expect(validateCredits([mk({ id: 'a', license: 'CC BY-NC 4.0' })])).toEqual(expect.arrayContaining([expect.stringContaining('licence not allowed')]));
    expect(validateCredits([mk({ id: 'a', source_url: 'http://x' })])).toEqual(expect.arrayContaining([expect.stringContaining('source_url')]));
    expect(validateCredits([mk({ id: 'a', attribution_required: false })])).toEqual(expect.arrayContaining([expect.stringContaining('attribution_required')]));
    expect(validateCredits([mk({ id: 'a' }), mk({ id: 'a' })])).toEqual(expect.arrayContaining([expect.stringContaining('duplicate')]));
    expect(validateCredits([mk({ id: 'a' })])).toEqual([]);
  });
});

describe('the shipped library (src/data/images/credits.json)', () => {
  const list = credits as PhotoCredit[];
  it('is valid', () => {
    expect(validateCredits(list)).toEqual([]);
  });
  it('has every file on disk and under the size budget', () => {
    let bytes = 0;
    for (const p of list) {
      const path = new URL(`../../assets/places/${p.file}`, import.meta.url);
      expect(existsSync(path), p.file).toBe(true);
      bytes += statSync(path).size;
    }
    expect(bytes).toBeLessThan(40 * 1024 * 1024);
  });
  it('covers every country that has content, plus Florida and California', () => {
    const segs = ['us', 'uk', 'ie', 'au', 'nl', 'de', 'es', 'it', 'fr', 'be', 'at', 'ch', 'ca', 'pt', 'in', 'jp', 'br', 'za', 'se', 'dk', 'no', 'fi', 'pl', 'cz', 'ro', 'cl', 'co', 'ar', 'pe', 'do', 'jm'];
    for (const s of segs) expect(pickPhoto(list, { country: s }), s).not.toBeNull();
    expect(pickPhoto(list, { country: 'uk' })?.id).toBe('d-uk-tower-bridge');
    expect(pickPhoto(list, { country: 'au' })?.id).toBe('d-au-opera-house');
    expect(pickPhoto(list, { country: 'us' })?.id).toBe('d-us-statue-of-liberty');
    expect(pickPhoto(list, { country: 'us', place: 'california' })?.id).toBe('d-us-california-golden-gate');
    expect(pickPhoto(list, { country: 'us', place: 'florida' })?.scope).toBe('state');
    expect(pickPhoto(list, { country: 'us', place: 'california' })?.scope).toBe('state');
  });
});
