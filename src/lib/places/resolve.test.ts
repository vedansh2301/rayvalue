import { describe, expect, it } from 'vitest';
import { PLACE_COUNTRIES, PLACE_PATH_RE, placeCountryForRoute, placePath, regionHubPath } from './config';
import { resolvePlaceRoute } from './resolve';
import { loadPlaceRoute } from './page-data';
import { fact, place, regions } from './test-fixtures';

const three = (slug: string, over = {}) => place({ id: slug, slug, name: slug.toUpperCase(), ...over });
const data = { regions, places: [three('a'), three('b'), three('c'), three('draft', { published: false }), three('thin', { place_facts: [fact('solar_yield_kwh_per_kwp')] })] };

describe('URL patterns', () => {
  it('match the packs: /uk/solar-panels, /de/photovoltaik, /au/solar-payback', () => {
    const [gb, de, au] = PLACE_COUNTRIES;
    expect(placePath(gb!, 'north-east', 'newcastle-upon-tyne')).toBe('/uk/solar-panels/north-east/newcastle-upon-tyne');
    expect(placePath(de!, 'bayern', 'muenchen')).toBe('/de/photovoltaik/bayern/muenchen');
    expect(placePath(au!, 'nsw', 'sydney')).toBe('/au/solar-payback/nsw/sydney');
    expect(regionHubPath(au!, 'nsw')).toBe('/au/solar-payback/nsw');
  });

  it('only the right topic word belongs to each country', () => {
    expect(placeCountryForRoute('uk', 'solar-panels')?.code).toBe('GB');
    expect(placeCountryForRoute('uk', 'photovoltaik')).toBeNull();
    expect(placeCountryForRoute('us', 'solar-payback')).toBeNull();
    expect(PLACE_PATH_RE.test('/au/solar-payback/nsw/sydney')).toBe(true);
    expect(PLACE_PATH_RE.test('/au/solar-panels/nsw')).toBe(false);
    expect(PLACE_PATH_RE.test('/us/solar-payback/florida')).toBe(false);
    expect(PLACE_PATH_RE.test('/uk/guides/x')).toBe(false);
  });
});

describe('resolvePlaceRoute', () => {
  const p = { cc: 'uk', topic: 'solar-panels', region: 'north-east' };

  it('renders a published, gated place', () => {
    const r = resolvePlaceRoute({ ...p, city: 'a' }, data);
    expect(r.kind).toBe('place');
  });

  it('404s an unpublished place, an under-sourced place, an unknown place, region, topic and country', () => {
    for (const params of [
      { ...p, city: 'draft' },
      { ...p, city: 'thin' },
      { ...p, city: 'zzz' },
      { ...p, region: 'nowhere', city: 'a' },
      { cc: 'uk', topic: 'photovoltaik', region: 'north-east', city: 'a' },
      { cc: 'fr', topic: 'solar-panels', region: 'north-east', city: 'a' },
    ]) expect(resolvePlaceRoute(params, data).kind).toBe('not_found');
  });

  it('does not find a place under another country or region', () => {
    expect(resolvePlaceRoute({ cc: 'de', topic: 'photovoltaik', region: 'bayern', city: 'a' }, data).kind).toBe('not_found');
  });

  it('a hub lists only renderable places, sorted, and needs 3 of them', () => {
    const r = resolvePlaceRoute(p, data);
    expect(r.kind).toBe('hub');
    if (r.kind === 'hub') expect(r.hub.places.map((x) => x.href)).toEqual(['/uk/solar-panels/north-east/a', '/uk/solar-panels/north-east/b', '/uk/solar-panels/north-east/c']);
    expect(resolvePlaceRoute(p, { regions, places: data.places.slice(0, 2) }).kind).toBe('not_found');
  });
});

describe('loadPlaceRoute (database reads)', () => {
  const rows = (places: unknown) => (async (input: RequestInfo | URL) => {
    const table = new URL(String(input)).pathname.split('/').pop();
    if (table === 'regions') return new Response(JSON.stringify(regions), { status: 200 });
    return places instanceof Response ? places : new Response(JSON.stringify(places), { status: 200 });
  }) as typeof fetch;
  const env = { url: 'https://db.example', key: 'k' };

  it('resolves a place and lists its renderable siblings and the hub', async () => {
    const res = await loadPlaceRoute({ cc: 'uk', topic: 'solar-panels', region: 'north-east', city: 'a' }, { env, fetch: rows(data.places) });
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.route.kind).toBe('place');
      expect(res.others.map((o) => o.name)).toEqual(['B', 'C']);
      expect(res.hubHref).toBe('/uk/solar-panels/north-east');
    }
  });

  it('even if the database returned an unpublished row, it is not rendered', async () => {
    const res = await loadPlaceRoute({ cc: 'uk', topic: 'solar-panels', region: 'north-east', city: 'draft' }, { env, fetch: rows(data.places) });
    expect(res.status === 'ok' && res.route.kind).toBe('not_found');
  });

  it('a database failure is "unavailable" (503), never a 404; missing tables mean not found', async () => {
    const fail = await loadPlaceRoute({ cc: 'uk', topic: 'solar-panels', region: 'north-east', city: 'a' }, { env, fetch: rows(new Response('x', { status: 500 })) });
    expect(fail.status).toBe('unavailable');
    const missing = await loadPlaceRoute({ cc: 'uk', topic: 'solar-panels', region: 'north-east', city: 'a' }, { env, fetch: rows(new Response('{}', { status: 404 })) });
    expect(missing.status === 'ok' && missing.route.kind).toBe('not_found');
  });

  it('an unknown country needs no database call', async () => {
    const res = await loadPlaceRoute({ cc: 'zz', topic: 'solar-panels', region: 'x' }, { env: null });
    expect(res.status === 'ok' && res.route.kind).toBe('not_found');
  });
});
