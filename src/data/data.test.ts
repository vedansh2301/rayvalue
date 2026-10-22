import { describe, expect, it } from 'vitest';
import { generateTodoVerify } from '../../scripts/todo-verify.mjs';
import {
  AssumptionsSchema,
  CitiesFileSchema,
  CostsSchema,
  UtilitiesSchema,
  assumptions,
  cities,
  costs,
  getCitiesByState,
  getCity,
  getUtilitiesByState,
  getUtility,
  utilities,
  zipMeta,
  zips,
} from './index';
import utilitiesJson from './utilities.json';
import costsJson from './costs.json';
import citiesJson from './cities.json';
import assumptionsJson from './assumptions.json';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const clone = (v: unknown): any => JSON.parse(JSON.stringify(v));

describe('data invariants', () => {
  it('has six utilities, three per state', () => {
    expect(utilities).toHaveLength(6);
    expect(getUtilitiesByState('FL').map((u) => u.id).sort()).toEqual(['duke-fl', 'fpl', 'teco']);
    expect(getUtilitiesByState('CA').map((u) => u.id).sort()).toEqual(['pge', 'sce', 'sdge']);
  });

  it('uses the right metering type per state', () => {
    for (const u of utilities) {
      expect(u.metering_type).toBe(u.state === 'FL' ? 'retail_net_metering' : 'nem3_net_billing');
    }
  });

  it('tiers are ascending and end open-ended', () => {
    for (const u of utilities) {
      for (const tiers of [u.tiers, u.winter_tiers]) {
        if (!tiers) continue;
        const ceilings = tiers.slice(0, -1).map((t) => t.up_to_kwh as number);
        expect([...ceilings].sort((a, b) => a - b)).toEqual(ceilings);
        expect(new Set(ceilings).size).toBe(ceilings.length);
        expect(tiers.at(-1)!.up_to_kwh).toBeNull();
      }
    }
  });

  it('every sourced number has a source and date', () => {
    for (const u of utilities) {
      expect(u.source_url, u.id).toBeTruthy();
      expect(u.verified_on, u.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(u.verification, u.id).not.toBe('unverified');
    }
    for (const state of ['FL', 'CA'] as const) {
      for (const [name, line] of Object.entries(costs[state])) {
        const hasNumber = [line.low, line.likely, line.high].some((v) => v !== null);
        if (hasNumber) {
          expect(line.source_url, `${state}.${name}`).toBeTruthy();
          expect(line.verified_on, `${state}.${name}`).toBeTruthy();
        } else {
          expect(line.source_url, `${state}.${name}`).toBeNull();
        }
      }
    }
  });

  it('only the owner can mark values human_verified (none yet)', () => {
    expect(utilities.every((u) => u.verification !== 'human_verified')).toBe(true);
  });

  it('has 10 cities per state, all unpublished, with a matching default utility', () => {
    for (const state of ['FL', 'CA'] as const) expect(getCitiesByState(state)).toHaveLength(10);
    for (const c of cities) {
      const u = getUtility(c.default_utility_id);
      expect(u, `${c.state}/${c.slug}`).toBeDefined();
      expect(u!.state).toBe(c.state);
      expect(c.published).toBe(false);
    }
  });

  it('every utility is the default for at least one city', () => {
    for (const u of utilities) {
      expect(cities.some((c) => c.default_utility_id === u.id), u.id).toBe(true);
    }
  });

  it('city coordinates sit inside their state and match their ZCTA entry', () => {
    for (const c of cities) {
      const hit = zips[c.state][c.coords_zcta];
      expect(hit, `${c.slug} ${c.coords_zcta}`).toBeDefined();
      expect([c.lat, c.lon]).toEqual([...hit!]);
    }
  });

  it('looks cities up by state and slug', () => {
    expect(getCity('FL', 'miami')?.default_utility_id).toBe('fpl');
    expect(getCity('CA', 'miami')).toBeUndefined();
    expect(getCity('CA', 'san-diego')?.default_utility_id).toBe('sdge');
    expect(getUtility('nope')).toBeUndefined();
  });

  it('zip maps look sane', () => {
    expect(Object.keys(zips.FL).length).toBeGreaterThan(900);
    expect(Object.keys(zips.CA).length).toBeGreaterThan(1500);
    expect(zipMeta.fl_count).toBe(Object.keys(zips.FL).length);
    expect(zipMeta.ca_count).toBe(Object.keys(zips.CA).length);
    expect(Object.keys(zips.FL).every((z) => /^3[2-4]\d{3}$/.test(z))).toBe(true);
    expect(Object.keys(zips.CA).every((z) => /^(9[0-5]\d{3}|96[01]\d{2})$/.test(z))).toBe(true);
  });

  it('has the model assumptions with rationales', () => {
    for (const [key, a] of Object.entries(assumptions)) {
      expect(a.kind, key).toBe('assumption');
      expect(a.rationale.length, key).toBeGreaterThan(10);
    }
    expect(assumptions.analysis_years.value).toBe(25);
  });
});

describe('schemas reject bad data', () => {
  it('rejects descending tiers', () => {
    const bad = clone(utilitiesJson);
    bad[0].tiers = [
      { up_to_kwh: 1500, rate_per_kwh: 0.12 },
      { up_to_kwh: 1000, rate_per_kwh: 0.13 },
      { up_to_kwh: null, rate_per_kwh: 0.14 },
    ];
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a last tier with a ceiling', () => {
    const bad = clone(utilitiesJson);
    bad[0].tiers = [{ up_to_kwh: 1000, rate_per_kwh: 0.12 }];
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects numbers without a source', () => {
    const bad = clone(utilitiesJson);
    bad[0].source_url = null;
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unverified records that hold numbers', () => {
    const bad = clone(utilitiesJson);
    bad[0].verification = 'unverified';
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed date', () => {
    const bad = clone(utilitiesJson);
    bad[0].verified_on = '22/10/2026';
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an FL utility with an export credit', () => {
    const bad = clone(utilitiesJson);
    bad[0].avg_export_credit_per_kwh = 0.05;
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects duplicate utility ids', () => {
    const bad = clone(utilitiesJson);
    bad[1].id = 'fpl';
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a cost range out of order and a sourced-looking null record', () => {
    const bad = clone(costsJson);
    bad.FL.installed_cost_per_watt.low = 6;
    expect(CostsSchema.safeParse(bad).success).toBe(false);
    const bad2 = clone(costsJson);
    bad2.FL.battery_installed_cost.source_url = 'https://example.com';
    expect(CostsSchema.safeParse(bad2).success).toBe(false);
  });

  it('rejects an assumption without a rationale or with a stray source_url', () => {
    const bad = clone(assumptionsJson);
    delete bad.analysis_years.rationale;
    expect(AssumptionsSchema.safeParse(bad).success).toBe(false);
    const bad2 = clone(assumptionsJson);
    bad2.analysis_years.source_url = 'https://example.com';
    expect(AssumptionsSchema.safeParse(bad2).success).toBe(false);
  });

  it('rejects a city pointing at a missing utility or duplicating a slug', () => {
    const bad = clone(citiesJson);
    bad.cities[0].default_utility_id = 'nope';
    expect(CitiesFileSchema.safeParse(bad).success).toBe(false);
    const dup = clone(citiesJson);
    dup.cities[1].slug = dup.cities[0].slug;
    expect(CitiesFileSchema.safeParse(dup).success).toBe(false);
  });
});

describe('docs/TODO-VERIFY.md', () => {
  it('is up to date (run `npm run todo:verify` after editing data)', () => {
    const file = fileURLToPath(new URL('../../docs/TODO-VERIFY.md', import.meta.url));
    expect(readFileSync(file, 'utf8')).toBe(generateTodoVerify());
  });
});
