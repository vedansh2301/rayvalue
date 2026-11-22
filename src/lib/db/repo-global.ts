/**
 * Multi-country data repository (markets, regions, export policies, incentives, non-US utilities / costs /
 * assumptions, inventory tables). Same rules as repo.ts: reads rows from Supabase (publishable key, SELECT only),
 * validates every load with Zod, returns a Result and never throws. SERVER-ONLY.
 *
 * The existing US loaders in repo.ts are untouched and keep working. Every loader here takes the country (and
 * optionally the region) explicitly, so a US request never sees a non-US row and vice versa.
 */
import { z } from 'zod';
import {
  CalcLocationsSchema,
  ExportPoliciesSchema,
  VatRatesSchema,
  type CalcLocation,
  type VatRate,
  GlobalAssumptionsSchema,
  GlobalCostsSchema,
  GlobalUtilitiesSchema,
  INVENTORY_SCHEMAS,
  IncentivesSchema,
  MarketSchema,
  MarketsSchema,
  RegionsSchema,
  type ExportPolicyRecord,
  type GlobalAssumptionsRecord,
  type GlobalCosts,
  type GlobalUtility,
  type IncentiveRecord,
  type InventoryRows,
  type InventoryTable,
  type Market,
  type Region,
} from '../../data/schemas-global.ts';
import type { GlobalCalcContext } from '../calc/global-types.ts';
import type { ProductionInput } from '../calc/types.ts';
import { err, ok, selectRows, siteDbEnv, type DbEnv, type Result } from './client.ts';
import { UTILITY_SELECT } from './repo.ts';
import { batteryUsableKwh, calcAssumptions, calcCostLine, calcExportPolicy, calcIncentive, globalAssumptionsFromRows, marketInfo } from './map-global.ts';
import { utilitiesFromRows, type UtilityRow } from './map.ts';

export interface GlobalRepoDeps {
  env?: DbEnv | null;
  fetch?: typeof fetch;
}

/** Everything calculateGlobal() needs except production. */
export interface GlobalCalcConfig {
  market: Market;
  region: Region;
  utilities: GlobalUtility[];
  exportPolicies: ExportPolicyRecord[];
  incentives: IncentiveRecord[];
  costs: GlobalCosts;
  assumptions: GlobalAssumptionsRecord;
}

export const EXPORT_POLICY_SELECT = '*,export_policy_rates(*)';

function validate<S extends z.ZodType>(schema: S, value: unknown, what: string): Result<z.infer<S>> {
  const r = schema.safeParse(value);
  if (r.success) return ok(r.data);
  const issues = r.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  return err('invalid', `${what} failed validation`, issues);
}

const COUNTRY = /^[A-Z]{2}$/;
const REGION = /^[A-Z0-9-]{1,8}$/;
const SLUGLIKE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function createGlobalRepo(deps: GlobalRepoDeps = {}) {
  const env = deps.env === undefined ? siteDbEnv() : deps.env;
  const f = deps.fetch ?? fetch;
  const rows = <T>(table: string, params: Record<string, string>) => selectRows<T>(env, table, params, f);

  async function loadMarkets(): Promise<Result<Market[]>> {
    const r = await rows<Record<string, unknown>>('markets', { select: '*', order: 'code.asc' });
    return r.ok ? validate(MarketsSchema, r.value, 'markets') : r;
  }

  async function loadMarket(country: string): Promise<Result<Market>> {
    if (!COUNTRY.test(country)) return err('not_found', 'unknown market');
    const r = await rows<Record<string, unknown>>('markets', { select: '*', code: `eq.${country}` });
    if (!r.ok) return r;
    if (!r.value[0]) return err('not_found', `no market ${country}`);
    return validate(MarketSchema, r.value[0], `markets ${country}`);
  }

  async function loadRegions(country: string): Promise<Result<Region[]>> {
    if (!COUNTRY.test(country)) return err('not_found', 'unknown market');
    const r = await rows<Record<string, unknown>>('regions', { select: '*', country: `eq.${country}`, order: 'code.asc' });
    return r.ok ? validate(RegionsSchema, r.value, `regions ${country}`) : r;
  }

  /** Export policies of a country (region policies and country-wide ones), each with its date-effective rates. */
  async function loadExportPolicies(country: string, region?: string): Promise<Result<ExportPolicyRecord[]>> {
    if (!COUNTRY.test(country) || (region !== undefined && !REGION.test(region))) return err('not_found', 'unknown market or region');
    const r = await rows<Record<string, unknown> & { export_policy_rates?: unknown[] }>('export_policies', { select: EXPORT_POLICY_SELECT, country: `eq.${country}`, order: 'id.asc' });
    if (!r.ok) return r;
    const scoped = r.value.filter((p) => region === undefined || p.region_code === null || p.region_code === region);
    const shaped = scoped.map(({ export_policy_rates, ...p }) => ({ ...p, rates: export_policy_rates ?? [] }));
    return validate(ExportPoliciesSchema, shaped, `export_policies ${country}`);
  }

  /** Incentive rows for a country: country-wide rows plus those of `region` (all rows when no region is given). */
  async function loadIncentives(country: string, region?: string): Promise<Result<IncentiveRecord[]>> {
    if (!COUNTRY.test(country) || (region !== undefined && !REGION.test(region))) return err('not_found', 'unknown market or region');
    const r = await rows<Record<string, unknown>>('incentives', { select: '*', country: `eq.${country}`, order: 'id.asc' });
    if (!r.ok) return r;
    const scoped = r.value.filter((i) => region === undefined || i.region_code === null || i.region_code === region);
    return validate(IncentivesSchema, scoped, `incentives ${country}`);
  }

  async function loadGlobalUtilities(country: string, region?: string): Promise<Result<GlobalUtility[]>> {
    if (!COUNTRY.test(country) || (region !== undefined && !REGION.test(region))) return err('not_found', 'unknown market or region');
    const params: Record<string, string> = { select: UTILITY_SELECT, country: `eq.${country}`, order: 'display_order.asc,id.asc' };
    if (region) params.region_code = `eq.${region}`;
    const r = await rows<UtilityRow & { country: string; region_code: string; export_policy_id: string | null }>('utilities', params);
    if (!r.ok) return r;
    if (r.value.length === 0) return err('not_found', `no utilities for ${country}${region ? `/${region}` : ''}`);
    const byId = new Map(r.value.map((u) => [u.id, u]));
    const mapped = utilitiesFromRows(r.value).map((u) => {
      const row = byId.get(u.id as string)!;
      return { ...u, country: row.country, region_code: row.region_code, export_policy_id: row.export_policy_id ?? null };
    });
    return validate(GlobalUtilitiesSchema, mapped, `utilities ${country}`);
  }

  /** The two cost lines of a region, with their tax flag. A missing row is an error here (the US loader behaves the same). */
  async function loadGlobalCosts(country: string, region: string): Promise<Result<GlobalCosts>> {
    if (!COUNTRY.test(country) || !REGION.test(region)) return err('not_found', 'unknown market or region');
    const r = await rows<Record<string, unknown> & { item: string; includes_tax: boolean | null }>('cost_ranges', { select: '*', country: `eq.${country}`, region_code: `eq.${region}` });
    if (!r.ok) return r;
    const shaped: Record<string, unknown> = {};
    for (const row of r.value) {
      const { low, likely, high, unit, note, source_url, verified_on, verification } = row as Record<string, unknown>;
      shaped[row.item] = { line: { low, likely, high, unit, note, source_url, verified_on, verification }, includes_tax: row.includes_tax ?? null };
    }
    return validate(GlobalCostsSchema, shaped, `cost_ranges ${country}/${region}`);
  }

  /** Assumptions for a market; a region row overrides the country row. */
  async function loadGlobalAssumptions(country: string, region?: string): Promise<Result<GlobalAssumptionsRecord>> {
    if (!COUNTRY.test(country) || (region !== undefined && !REGION.test(region))) return err('not_found', 'unknown market or region');
    const r = await rows<{ key: string; country: string; state: string | null; value: Record<string, unknown>; rationale: string }>('model_assumptions', {
      select: 'key,country,state,value,rationale',
      country: `eq.${country}`,
    });
    if (!r.ok) return r;
    return validate(GlobalAssumptionsSchema, globalAssumptionsFromRows(r.value, country, region), `model_assumptions ${country}${region ? `/${region}` : ''}`);
  }

  /** Date-effective VAT rows of a country (0035). */
  async function loadVatRates(country: string): Promise<Result<VatRate[]>> {
    if (!COUNTRY.test(country)) return err('not_found', 'unknown market');
    const r = await rows<Record<string, unknown>>('vat_rates', { select: '*', country: `eq.${country}`, order: 'applies_to.asc,valid_from.asc' });
    return r.ok ? validate(VatRatesSchema, r.value, `vat_rates ${country}`) : r;
  }

  /** The yield points (one per utility / price cap region) of a country (0035). */
  async function loadCalcLocations(country: string): Promise<Result<CalcLocation[]>> {
    if (!COUNTRY.test(country)) return err('not_found', 'unknown market');
    const r = await rows<Record<string, unknown>>('calculator_locations', { select: '*', country: `eq.${country}`, order: 'id.asc' });
    return r.ok ? validate(CalcLocationsSchema, r.value, `calculator_locations ${country}`) : r;
  }

  /** One inventory table (0029), optionally filtered by exact column values (e.g. { country: 'US', region_code: 'FL' }). */
  async function loadInventory<T extends InventoryTable>(table: T, filters: Record<string, string> = {}): Promise<Result<InventoryRows<T>>> {
    const params: Record<string, string> = { select: '*' };
    for (const [k, v] of Object.entries(filters)) {
      if (!SLUGLIKE.test(k.replace(/_/g, '-')) || !/^[A-Za-z0-9._-]{1,64}$/.test(v)) return err('not_found', 'bad filter');
      params[k] = `eq.${v}`;
    }
    const r = await rows<unknown>(table, params);
    if (!r.ok) return r;
    return validate(INVENTORY_SCHEMAS[table], r.value, table) as Result<InventoryRows<T>>;
  }

  /** Everything calculateGlobal() needs for one market region (all loads in parallel; the first failure wins). */
  async function loadGlobalCalcConfig(country: string, region: string): Promise<Result<GlobalCalcConfig>> {
    const [m, rg, u, p, i, c, a] = await Promise.all([
      loadMarket(country),
      loadRegions(country),
      loadGlobalUtilities(country, region),
      loadExportPolicies(country, region),
      loadIncentives(country, region),
      loadGlobalCosts(country, region),
      loadGlobalAssumptions(country, region),
    ]);
    if (!m.ok) return m;
    if (!rg.ok) return rg;
    const regionRow = rg.value.find((x) => x.code === region);
    if (!regionRow) return err('not_found', `no region ${country}/${region}`);
    if (!u.ok) return u;
    if (!p.ok) return p;
    if (!i.ok) return i;
    if (!c.ok) return c;
    if (!a.ok) return a;
    return ok({ market: m.value, region: regionRow, utilities: u.value, exportPolicies: p.value, incentives: i.value, costs: c.value, assumptions: a.value });
  }

  return { loadMarkets, loadMarket, loadRegions, loadExportPolicies, loadIncentives, loadGlobalUtilities, loadGlobalCosts, loadGlobalAssumptions, loadVatRates, loadCalcLocations, loadInventory, loadGlobalCalcConfig };
}

export type GlobalRepo = ReturnType<typeof createGlobalRepo>;

/**
 * Build the calculateGlobal() context for one utility. Fails (not_found) when the utility has no export policy:
 * the policy is data, never defaulted.
 */
export function toGlobalCalcContext(config: GlobalCalcConfig, utilityId: string, production: ProductionInput): Result<GlobalCalcContext> {
  const utility = config.utilities.find((u) => u.id === utilityId);
  if (!utility) return err('not_found', `no utility ${utilityId}`);
  const policy = config.exportPolicies.find((p) => p.id === utility.export_policy_id);
  if (!policy) return err('not_found', `utility ${utilityId} has no export policy`);
  return ok({
    market: marketInfo(config.market),
    regionCode: config.region.code,
    utility,
    exportPolicy: calcExportPolicy(policy),
    incentives: config.incentives.map(calcIncentive),
    installedCostPerWatt: calcCostLine(config.costs.installed_cost_per_watt),
    batteryInstalledCost: calcCostLine(config.costs.battery_installed_cost),
    batteryUsableKwh: batteryUsableKwh(config.assumptions),
    assumptions: calcAssumptions(config.assumptions),
    production,
  });
}

export const loadGlobalCalcConfig = (country: string, region: string, deps?: GlobalRepoDeps) => createGlobalRepo(deps).loadGlobalCalcConfig(country, region);
