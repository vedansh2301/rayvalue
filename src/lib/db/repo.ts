/**
 * Calculator data repository: loads rows from Supabase, maps them to the domain types
 * (map.ts) and validates them with the Zod schemas. Every function returns a Result and
 * never throws: invalid or missing data is an error the caller shows as "being verified".
 * SERVER-ONLY (called from on-demand pages / endpoints and admin scripts).
 */
import { z } from 'zod';
import {
  AssumptionsSchema,
  CitiesSchema,
  CityProductionListSchema,
  CitySchema,
  CostsSchema,
  OfferSchema,
  UtilitiesSchema,
  type Assumptions,
  type City,
  type CityProduction,
  type Costs,
  type Offer,
  type State,
  type Utility,
} from '../../data/schemas.ts';
import { err, ok, selectRows, siteDbEnv, type DbEnv, type Result } from './client.ts';
import {
  assumptionsFromRows,
  citiesFromRows,
  cityFromRow,
  costsFromRows,
  offerFromRow,
  productionFromRow,
  utilitiesFromRows,
  type CityRow,
  type CostRangeRow,
  type ModelAssumptionRow,
  type OfferRow,
  type ProductionRow,
  type UtilityRow,
} from './map.ts';

export type { DbError, DbErrorKind, Result } from './client.ts';
export { toProductionInput } from './map.ts';

/** Everything calculate() needs except production, for one state. */
export interface CalcConfig {
  state: State;
  /** Utilities of this state, in display order (at least one). */
  utilities: Utility[];
  /** Both states' cost lines (the Costs domain type holds FL and CA). */
  costs: Costs;
  /** Assumptions with this state's overrides applied. */
  assumptions: Assumptions;
  /** The active offer for this state, or null. */
  offer: Offer | null;
}

export interface RepoDeps {
  /** Defaults to the site env (SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY). */
  env?: DbEnv | null;
  fetch?: typeof fetch;
}

export const UTILITY_SELECT = '*,utility_tier_sets(*,utility_tiers(*)),utility_tou_rates(*)';

function validate<S extends z.ZodType>(schema: S, value: unknown, what: string): Result<z.infer<S>> {
  const r = schema.safeParse(value);
  if (r.success) return ok(r.data);
  const issues = r.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  return err('invalid', `${what} failed validation`, issues);
}

const STATES = ['FL', 'CA'] as const;
const isState = (s: unknown): s is State => (STATES as readonly unknown[]).includes(s);

export function createRepo(deps: RepoDeps = {}) {
  const env = deps.env === undefined ? siteDbEnv() : deps.env;
  const f = deps.fetch ?? fetch;
  const rows = <T>(table: string, params: Record<string, string>) => selectRows<T>(env, table, params, f);

  async function loadUtilities(state?: State): Promise<Result<Utility[]>> {
    const params: Record<string, string> = { select: UTILITY_SELECT, order: 'display_order.asc,id.asc' };
    if (state) params.state = `eq.${state}`;
    const r = await rows<UtilityRow>('utilities', params);
    if (!r.ok) return r;
    if (r.value.length === 0) return err('not_found', `no utilities${state ? ` for ${state}` : ''}`);
    return validate(UtilitiesSchema, utilitiesFromRows(r.value), 'utilities');
  }

  async function loadCosts(): Promise<Result<Costs>> {
    const r = await rows<CostRangeRow>('cost_ranges', { select: '*' });
    if (!r.ok) return r;
    return validate(CostsSchema, costsFromRows(r.value), 'cost_ranges');
  }

  async function loadAssumptions(state?: State): Promise<Result<Assumptions>> {
    const r = await rows<ModelAssumptionRow>('model_assumptions', { select: 'key,state,value,unit,rationale' });
    if (!r.ok) return r;
    return validate(AssumptionsSchema, assumptionsFromRows(r.value, state), `model_assumptions${state ? ` (${state})` : ''}`);
  }

  /** Active offer for `state` (null if none). An invalid row is an error, not silently hidden. */
  async function loadOffer(state: State): Promise<Result<Offer | null>> {
    const r = await rows<OfferRow>('offers', { select: '*', state: `eq.${state}`, active: 'is.true' });
    if (!r.ok) return r;
    const row = r.value[0];
    if (!row) return ok(null);
    return validate(OfferSchema, offerFromRow(row), 'offers');
  }

  async function loadCalcConfig(state: State): Promise<Result<CalcConfig>> {
    if (!isState(state)) return err('not_found', 'unknown state');
    const [u, c, a, o] = await Promise.all([loadUtilities(state), loadCosts(), loadAssumptions(state), loadOffer(state)]);
    if (!u.ok) return u;
    if (!c.ok) return c;
    if (!a.ok) return a;
    if (!o.ok) return o;
    return ok({ state, utilities: u.value, costs: c.value, assumptions: a.value, offer: o.value });
  }

  async function loadCities(state?: State): Promise<Result<City[]>> {
    const params: Record<string, string> = { select: '*', order: 'display_order.asc,state.asc,slug.asc' };
    if (state) params.state = `eq.${state}`;
    const r = await rows<CityRow>('cities', params);
    if (!r.ok) return r;
    return validate(CitiesSchema, citiesFromRows(r.value), 'cities');
  }

  async function loadCity(state: State, slug: string): Promise<Result<City>> {
    if (!isState(state) || !CitySchema.shape.slug.safeParse(slug).success) return err('not_found', 'no such city');
    const r = await rows<CityRow>('cities', { select: '*', state: `eq.${state}`, slug: `eq.${slug}` });
    if (!r.ok) return r;
    const row = r.value[0];
    if (!row) return err('not_found', `no city ${state}/${slug}`);
    return validate(CitySchema, cityFromRow(row), `cities ${state}/${slug}`);
  }

  /** Precomputed production rows for a state (optionally one city), ordered by city then losses. */
  async function loadProduction(state: State, slug?: string): Promise<Result<CityProduction[]>> {
    if (!isState(state)) return err('not_found', 'unknown state');
    const params: Record<string, string> = { select: '*', state: `eq.${state}`, order: 'slug.asc,losses.asc' };
    if (slug !== undefined) params.slug = `eq.${slug}`;
    const r = await rows<ProductionRow>('pvwatts_city_production', params);
    if (!r.ok) return r;
    return validate(CityProductionListSchema, r.value.map(productionFromRow), 'pvwatts_city_production');
  }

  return { loadCalcConfig, loadUtilities, loadCosts, loadAssumptions, loadOffer, loadCities, loadCity, loadProduction };
}

export type Repo = ReturnType<typeof createRepo>;

// Convenience functions bound to the site env (publishable key).
export const loadCalcConfig = (state: State, deps?: RepoDeps) => createRepo(deps).loadCalcConfig(state);
export const loadUtilities = (state?: State, deps?: RepoDeps) => createRepo(deps).loadUtilities(state);
export const loadCities = (state?: State, deps?: RepoDeps) => createRepo(deps).loadCities(state);
export const loadCity = (state: State, slug: string, deps?: RepoDeps) => createRepo(deps).loadCity(state, slug);
export const loadProduction = (state: State, slug?: string, deps?: RepoDeps) => createRepo(deps).loadProduction(state, slug);

/** CDN caching for on-demand pages that read the DB: owner edits show up within ~5 minutes. */
export const DB_PAGE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0',
  'CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
} as const;
