import { describe, expect, it } from 'vitest';
import { MIN_HUB_PLACES, MIN_SECTIONS, evaluatePlace, hubRenders, isSourcedFact, renderablePlaces, sectionsPresent } from './gate';
import { dePlace, fact, gbFacts, place } from './test-fixtures';

describe('isSourcedFact', () => {
  it('accepts a primary fact with a value, http source and check date', () => expect(isSourcedFact(fact('x'))).toBe(true));
  it.each([
    ['no source_url', { source_url: null }],
    ['non-http source', { source_url: 'ftp://x' }],
    ['no verified_on', { verified_on: null }],
    ['unverified status', { status: 'unverified' as const }],
    ['secondary confidence', { confidence: 'secondary' as const }],
    ['no value', { value_num: null, value_text: null }],
    ['blank text value', { value_num: null, value_text: '  ' }],
  ])('rejects %s', (_n, over) => expect(isSourcedFact(fact('x', over))).toBe(false));
});

describe('sectionsPresent / evaluatePlace', () => {
  it('GB with all facts has five distinct sections', () => {
    expect(sectionsPresent('GB', gbFacts())).toEqual(['yield', 'tariff', 'installs', 'housing', 'cost']);
  });

  it('counts distinct sections, not facts: many facts in one section stay one section', () => {
    const facts = [fact('homeownership_pct'), fact('houses_pct'), fact('homeownership_pct', { period: '2011-03-27' })];
    expect(sectionsPresent('GB', facts)).toEqual(['housing']);
  });

  it('a published place with exactly 3 sourced sections renders; with 2 it does not', () => {
    const three = place({ place_facts: [fact('solar_yield_kwh_per_kwp'), fact('homeownership_pct'), fact('pv_installations_cumulative')] });
    const two = place({ place_facts: [fact('solar_yield_kwh_per_kwp'), fact('homeownership_pct')] });
    expect(MIN_SECTIONS).toBe(3);
    expect(evaluatePlace('GB', three)).toMatchObject({ renders: true, sections: ['yield', 'installs', 'housing'] });
    expect(evaluatePlace('GB', two).renders).toBe(false);
  });

  it('an unpublished place never renders, however complete', () => {
    const g = evaluatePlace('GB', place({ published: false }));
    expect(g.sections).toHaveLength(5);
    expect(g.renders).toBe(false);
  });

  it('unsourced, unverified and secondary facts do not count toward the gate', () => {
    const p = place({
      place_facts: [
        fact('solar_yield_kwh_per_kwp'),
        fact('homeownership_pct', { source_url: null }),
        fact('pv_installations_cumulative', { status: 'unverified' }),
        fact('avg_install_cost_per_kw_4_10kw_mean', { confidence: 'secondary' }),
      ],
    });
    expect(evaluatePlace('GB', p)).toMatchObject({ sections: ['yield'], renders: false });
  });

  it('a label-only support fact (price_cap_region) does not make the tariff section', () => {
    expect(sectionsPresent('GB', [fact('price_cap_region', { value_num: null, value_text: 'London' })])).toEqual([]);
  });

  it('uses each country own section keys (DE has no tariff or cost section)', () => {
    expect(sectionsPresent('DE', dePlace().place_facts)).toEqual(['yield', 'housing', 'heating', 'installs']);
    expect(sectionsPresent('DE', [fact('price_cap_unit_rate_dd')])).toEqual([]);
  });
});

describe('lists and hubs', () => {
  it('renderablePlaces keeps only published places with >= 3 sections', () => {
    const list = [place({ slug: 'a' }), place({ slug: 'b', published: false }), place({ slug: 'c', place_facts: [fact('solar_yield_kwh_per_kwp')] })];
    expect(renderablePlaces(list).map((p) => p.slug)).toEqual(['a']);
  });

  it('a hub needs MIN_HUB_PLACES renderable places', () => {
    expect(hubRenders(MIN_HUB_PLACES - 1)).toBe(false);
    expect(hubRenders(MIN_HUB_PLACES)).toBe(true);
  });
});
