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

  it('tiers are ascending and end open-ended, and seasons cover every month once', () => {
    for (const u of utilities) {
      if (u.rate_type !== 'tiered') continue;
      const months = u.tier_sets!.flatMap((set) => set.months).sort((a, b) => a - b);
      expect(months, u.id).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      for (const set of u.tier_sets!) {
        const ceilings = set.tiers.slice(0, -1).map((t) => t.up_to_kwh as number);
        expect([...ceilings].sort((a, b) => a - b)).toEqual(ceilings);
        expect(new Set(ceilings).size).toBe(ceilings.length);
        expect(set.tiers.at(-1)!.up_to_kwh).toBeNull();
      }
    }
  });

  it('uses explicit seasons: FPL/TECO one all-year set, Duke summer + winter', () => {
    expect(getUtility('fpl')!.tier_sets!.map((s) => s.season)).toEqual(['all_year']);
    expect(getUtility('teco')!.tier_sets!.map((s) => s.season)).toEqual(['all_year']);
    const duke = getUtility('duke-fl')!.tier_sets!;
    expect(duke.find((s) => s.season === 'summer')!.months).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(duke.find((s) => s.season === 'winter')!.months).toEqual([12, 1, 2]);
  });

  it('TOU rates carry structured season / period / day type', () => {
    for (const u of utilities) {
      if (u.rate_type !== 'tou_summary') continue;
      expect(u.tou_rates!.length, u.id).toBeGreaterThan(0);
      for (const t of u.tou_rates!) {
        expect(['summer', 'winter']).toContain(t.season);
        if (t.months) expect(t.months.every((m) => m >= 1 && m <= 12)).toBe(true);
      }
    }
    // PG&E states its seasons; SDG&E's table does not.
    expect(getUtility('pge')!.tou_rates!.find((t) => t.season === 'summer')!.months).toEqual([6, 7, 8, 9]);
    expect(getUtility('sdge')!.tou_rates!.every((t) => t.months === null)).toBe(true);
  });

  it('CA utilities carry a published residential average rate with its own source', () => {
    for (const u of getUtilitiesByState('CA')) {
      expect(u.avg_rate_per_kwh!.likely, u.id).toBeGreaterThan(0.2);
      expect(u.avg_rate_per_kwh!.source_url, u.id).toMatch(/^https:\/\//);
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

  it('every city carries a utility confidence, and non-city ones are listed in TODO-VERIFY', () => {
    const todo = readFileSync(fileURLToPath(new URL('../../docs/TODO-VERIFY.md', import.meta.url)), 'utf8');
    for (const c of cities) {
      expect(['city', 'county', 'indirect']).toContain(c.utility_confidence);
      expect(todo.includes(`\`${c.state}/${c.slug}\``), c.slug).toBe(c.utility_confidence !== 'city');
    }
    expect(getCity('CA', 'san-diego')!.utility_confidence).toBe('indirect');
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
    for (const st of ['FL', 'CA'] as const) {
      const r = assumptions.annual_rate_escalation[st];
      expect(r.low <= r.likely && r.likely <= r.high).toBe(true);
    }
  });
});

describe('schemas reject bad data', () => {
  it('rejects descending tiers', () => {
    const bad = clone(utilitiesJson);
    bad[0].tier_sets[0].tiers = [
      { up_to_kwh: 1500, rate_per_kwh: 0.12 },
      { up_to_kwh: 1000, rate_per_kwh: 0.13 },
      { up_to_kwh: null, rate_per_kwh: 0.14 },
    ];
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a last tier with a ceiling', () => {
    const bad = clone(utilitiesJson);
    bad[0].tier_sets[0].tiers = [{ up_to_kwh: 1000, rate_per_kwh: 0.12 }];
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

  it('rejects inconsistent minimum-bill fields', () => {
    const caMin = clone(utilitiesJson);
    caMin[3].minimum_bill_basis = 'none';
    expect(UtilitiesSchema.safeParse(caMin).success).toBe(false);
    const amountWithoutBasis = clone(utilitiesJson);
    amountWithoutBasis[2].minimum_monthly_bill = 30; // TECO basis is null
    expect(UtilitiesSchema.safeParse(amountWithoutBasis).success).toBe(false);
    const baseAboveAllIn = clone(utilitiesJson);
    baseAboveAllIn[0].tier_sets[0].tiers[0].base_rate_per_kwh = 0.5;
    expect(UtilitiesSchema.safeParse(baseAboveAllIn).success).toBe(false);
  });

  it('rejects duplicate utility ids', () => {
    const bad = clone(utilitiesJson);
    bad[1].id = 'fpl';
    expect(UtilitiesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects tier sets that leave a month uncovered or double-covered', () => {
    const gap = clone(utilitiesJson);
    gap[1].tier_sets[1].months = [12, 1]; // Duke winter loses February
    expect(UtilitiesSchema.safeParse(gap).success).toBe(false);
    const overlap = clone(utilitiesJson);
    overlap[1].tier_sets[1].months = [12, 1, 2, 3];
    expect(UtilitiesSchema.safeParse(overlap).success).toBe(false);
  });

  it('rejects a TOU rate with an unknown period or an avg_rate record without a source', () => {
    const badPeriod = clone(utilitiesJson);
    badPeriod[3].tou_rates[0].period = 'sunrise';
    expect(UtilitiesSchema.safeParse(badPeriod).success).toBe(false);
    const noSrc = clone(utilitiesJson);
    noSrc[3].avg_rate_per_kwh.source_url = null;
    expect(UtilitiesSchema.safeParse(noSrc).success).toBe(false);
  });

  it('rejects a city without a valid utility_confidence', () => {
    const bad = clone(citiesJson);
    bad.cities[0].utility_confidence = 'maybe';
    expect(CitiesFileSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a cost range out of order and a record with no numbers that still claims a source', () => {
    const bad = clone(costsJson);
    bad.FL.installed_cost_per_watt.low = 6;
    expect(CostsSchema.safeParse(bad).success).toBe(false);
    const bad2 = clone(costsJson);
    Object.assign(bad2.FL.battery_installed_cost, { low: null, likely: null, high: null }); // still carries a source
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

describe('pvwatts-cities.json', () => {
  it('parses, covers every city x configured loss value, and non-null entries are plausible', async () => {
    const { pvwattsMeta, getPvwattsForCity, cities, assumptions } = await import('./index');
    expect(pvwattsMeta.endpoint).toContain('pvwatts/v8');
    const losses = [...new Set(Object.values(assumptions.pvwatts_system_loss_pct).filter((v): v is number => typeof v === 'number'))];
    for (const c of cities) {
      for (const l of losses) {
        const e = getPvwattsForCity(c.state, c.slug, l);
        if (e === null) continue;
        expect(e.annual, `${c.state}/${c.slug}@${l}`).toBeGreaterThan(900);
        expect(e.annual).toBeLessThan(2300);
        expect(Math.abs(e.monthly.reduce((a, b) => a + b, 0) - e.annual)).toBeLessThan(2);
      }
    }
  });
});
