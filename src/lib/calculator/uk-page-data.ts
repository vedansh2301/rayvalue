/**
 * Server-side adapter for the international calculator pages (UK, Germany, Australia): loads and validates every row the
 * island needs (Supabase, publishable key, SELECT only) and returns them as props. The browser never talks to the database.
 * SERVER-ONLY. Any missing or invalid piece makes the whole page "verifying" (HTTP 200, short cache): a half-loaded
 * calculator would have to guess, and it never does.
 *
 * The file keeps its original name (the UK was first); loadCalculatorPageData() is the generic loader and loadUkPageData()
 * the unchanged UK entry point.
 */
import type { DbError, Result } from '../db/client';
import type { createGlobalRepo } from '../db/repo-global';
import type { UkCalculatorProps } from './uk';

export const UK_COUNTRY = 'GB';
/** The national "region" row that holds the GB cost, utility and assumption rows (migration 0035). */
export const UK_DATA_REGION = 'GB';

/** Country -> the national "region" row that holds its cost, utility and assumption rows (0035 GB, 0037 DE and AU). */
export const CALCULATOR_DATA_REGION: Record<string, string> = { GB: 'GB', DE: 'DE', AU: 'AU' };

export type UkPageData = { ok: true; props: UkCalculatorProps } | { ok: false; error: DbError };
export type CalculatorPageData = UkPageData;

type Repo = Pick<ReturnType<typeof createGlobalRepo>, 'loadMarket' | 'loadGlobalUtilities' | 'loadExportPolicies' | 'loadGlobalCosts' | 'loadGlobalAssumptions' | 'loadVatRates' | 'loadCalcLocations' | 'loadIncentives'>;

const fail = (r: Result<unknown>): UkPageData | null => (r.ok ? null : { ok: false, error: r.error });

/** `today` (ISO date) is injectable for tests; the page passes the server date. */
export async function loadCalculatorPageData(country: string, today: string, repo?: Repo): Promise<CalculatorPageData> {
  const dataRegion = CALCULATOR_DATA_REGION[country];
  if (!dataRegion) return { ok: false, error: { kind: 'not_found', message: `no calculator data region for ${country}` } };
  const r = repo ?? (await import('../db/repo-global')).createGlobalRepo();
  const [market, utilities, policies, costs, assumptions, vat, locations, incentives] = await Promise.all([
    r.loadMarket(country),
    r.loadGlobalUtilities(country, dataRegion),
    r.loadExportPolicies(country),
    r.loadGlobalCosts(country, dataRegion),
    r.loadGlobalAssumptions(country),
    r.loadVatRates(country),
    r.loadCalcLocations(country),
    r.loadIncentives(country),
  ]);
  const bad = fail(market) ?? fail(utilities) ?? fail(policies) ?? fail(costs) ?? fail(assumptions) ?? fail(vat) ?? fail(locations) ?? fail(incentives);
  if (bad) return bad;
  if (!market.ok || !utilities.ok || !policies.ok || !costs.ok || !assumptions.ok || !vat.ok || !locations.ok || !incentives.ok) throw new Error('unreachable');
  const exportPolicies = policies.value.filter((p) => p.kind === 'feed_in' || p.kind === 'gross_metering');
  if (exportPolicies.length === 0) return { ok: false, error: { kind: 'not_found', message: `no export offers for ${country}` } };
  return {
    ok: true,
    props: {
      market: market.value,
      utilities: utilities.value,
      locations: locations.value,
      exportPolicies,
      costs: costs.value,
      assumptions: assumptions.value,
      vatRates: vat.value,
      incentives: incentives.value,
      today,
    },
  };
}

export const loadUkPageData = (today: string, repo?: Repo): Promise<UkPageData> => loadCalculatorPageData(UK_COUNTRY, today, repo);
