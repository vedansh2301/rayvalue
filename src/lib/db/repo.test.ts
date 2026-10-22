import { describe, expect, it, vi } from 'vitest';
import { fixtureAssumptions, fixtureCosts, fixtureUtilities } from '../calc/test-fixtures';
import { restUrl, selectRows } from './client';
import { createRepo, DB_PAGE_CACHE_HEADERS, UTILITY_SELECT } from './repo';
import {
  fixtureAssumptionRows,
  fixtureCitiesFile,
  fixtureCityRows,
  fixtureCostRows,
  fixtureOfferRows,
  fixtureProduction,
  fixtureProductionRows,
  fixtureUtilityRows,
} from './test-rows';

const ENV = { url: 'https://fixture.supabase.co/', key: 'sb_publishable_FIXTUREKEY' };

type Tables = Record<string, unknown[]>;
const defaultTables = (): Tables => ({
  utilities: fixtureUtilityRows(),
  cost_ranges: fixtureCostRows(),
  model_assumptions: fixtureAssumptionRows(),
  cities: fixtureCityRows(),
  pvwatts_city_production: fixtureProductionRows(),
  offers: fixtureOfferRows(),
});

/** A tiny fake PostgREST: supports eq./is. filters on top-level columns; ignores select/order. */
function fakeRest(tables: Tables = defaultTables(), override?: (table: string) => Response | Promise<Response> | undefined) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    expect(u.origin + '/').toBe(ENV.url);
    expect((init?.headers as Record<string, string>).apikey).toBe(ENV.key);
    const table = u.pathname.replace('/rest/v1/', '');
    const o = override?.(table);
    if (o) return o;
    let rows = (tables[table] ?? []) as Record<string, unknown>[];
    for (const [k, v] of u.searchParams) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      else if (v === 'is.true') rows = rows.filter((r) => r[k] === true);
      else if (v === 'is.null') rows = rows.filter((r) => r[k] === null);
      else throw new Error(`unsupported filter ${k}=${v}`);
    }
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

const repoWith = (f: ReturnType<typeof fakeRest>) => createRepo({ env: ENV, fetch: f as unknown as typeof fetch });

describe('client', () => {
  it('builds PostgREST URLs and sends only the apikey header', async () => {
    expect(restUrl(ENV, 'cities', { select: '*', state: 'eq.FL' })).toBe('https://fixture.supabase.co/rest/v1/cities?select=*&state=eq.FL');
    const f = fakeRest();
    await selectRows(ENV, 'offers', { select: '*' }, f as unknown as typeof fetch);
    const init = f.mock.calls[0]![1]!;
    expect(Object.keys(init.headers as object).sort()).toEqual(['Accept', 'apikey']);
    expect(init.method ?? 'GET').toBe('GET');
  });
  it('reports a missing env without calling fetch', async () => {
    const f = fakeRest();
    expect(await selectRows(null, 'cities', {}, f as unknown as typeof fetch)).toEqual({ ok: false, error: { kind: 'not_configured', message: expect.any(String) } });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('loadCalcConfig', () => {
  it('returns validated domain objects for the state', async () => {
    const f = fakeRest();
    const r = await repoWith(f).loadCalcConfig('FL');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.utilities).toEqual(fixtureUtilities.filter((u) => u.state === 'FL'));
    expect(r.value.costs).toEqual(fixtureCosts);
    expect(r.value.assumptions).toEqual(fixtureAssumptions);
    expect(r.value.offer).toMatchObject({ partner_name: 'Fixture Partner', active: true });
    const utilCall = f.mock.calls.map((c) => new URL(String(c[0]))).find((u) => u.pathname.endsWith('/utilities'))!;
    expect(utilCall.searchParams.get('select')).toBe(UTILITY_SELECT);
    expect(utilCall.searchParams.get('state')).toBe('eq.FL');
  });

  it('inactive offers are not returned', async () => {
    const r = await repoWith(fakeRest()).loadCalcConfig('CA');
    expect(r.ok && r.value.offer).toBeNull();
  });

  it('invalid data is an `invalid` error with issue paths, never a throw', async () => {
    const tables = defaultTables();
    (tables.cost_ranges as { low: number | null }[])[0]!.low = 99; // low > likely
    const r = await repoWith(fakeRest(tables)).loadCalcConfig('FL');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('invalid');
    expect(r.error.message).toContain('cost_ranges');
    expect(r.error.issues!.length).toBeGreaterThan(0);
  });

  it('no utilities for the state is not_found', async () => {
    const tables = defaultTables();
    tables.utilities = (tables.utilities as { state: string }[]).filter((u) => u.state !== 'CA');
    const r = await repoWith(fakeRest(tables)).loadCalcConfig('CA');
    expect(r).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });

  it('HTTP errors, network failures and non-array bodies become errors that never contain the key', async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => new Response('nope', { status: 500 }), 'http'],
      [() => Promise.reject(new TypeError(`fetch failed for ${ENV.key}`)), 'network'],
      [() => new Response('{"a":1}', { status: 200 }), 'bad_response'],
      [() => new Response('not json', { status: 200 }), 'bad_response'],
    ];
    for (const [make, kind] of cases) {
      const r = await repoWith(fakeRest(defaultTables(), (t) => (t === 'model_assumptions' ? (make() as Response) : undefined))).loadCalcConfig('FL');
      expect(r, kind).toMatchObject({ ok: false, error: { kind } });
      expect(JSON.stringify(r)).not.toContain(ENV.key);
    }
  });

  it('missing env is not_configured', async () => {
    expect(await createRepo({ env: null }).loadCalcConfig('FL')).toMatchObject({ ok: false, error: { kind: 'not_configured' } });
  });

  it('rejects an unknown state without a request', async () => {
    const f = fakeRest();
    expect(await repoWith(f).loadCalcConfig('TX' as 'FL')).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('cities and production', () => {
  it('loadCities (all / by state) and loadCity', async () => {
    const repo = repoWith(fakeRest());
    expect(await repo.loadCities()).toEqual({ ok: true, value: fixtureCitiesFile.cities });
    expect(await repo.loadCities('CA')).toEqual({ ok: true, value: fixtureCitiesFile.cities.filter((c) => c.state === 'CA') });
    expect(await repo.loadCity('FL', 'fx-b')).toEqual({ ok: true, value: fixtureCitiesFile.cities[1] });
    expect(await repo.loadCity('FL', 'nope')).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });

  it('loadCity rejects malformed slugs without a request', async () => {
    const f = fakeRest();
    expect(await repoWith(f).loadCity('FL', 'Bad Slug,or=1')).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    expect(f).not.toHaveBeenCalled();
  });

  it('loadProduction by state and city', async () => {
    const repo = repoWith(fakeRest());
    expect(await repo.loadProduction('FL')).toEqual({ ok: true, value: fixtureProduction.filter((p) => p.state === 'FL') });
    expect(await repo.loadProduction('FL', 'fx-b')).toEqual({ ok: true, value: fixtureProduction.filter((p) => p.slug === 'fx-b') });
    expect(await repo.loadProduction('CA', 'fx-a')).toEqual({ ok: true, value: [] });
  });

  it('a production row that does not validate fails the whole load', async () => {
    const tables = defaultTables();
    (tables.pvwatts_city_production as { monthly_kwh_per_kw: number[] }[])[0]!.monthly_kwh_per_kw = [1, 2, 3];
    expect(await repoWith(fakeRest(tables)).loadProduction('FL')).toMatchObject({ ok: false, error: { kind: 'invalid' } });
  });
});

it('page cache headers: CDN 5 minutes, stale-while-revalidate 1 day', () => {
  expect(DB_PAGE_CACHE_HEADERS['CDN-Cache-Control']).toBe('public, s-maxage=300, stale-while-revalidate=86400');
});
