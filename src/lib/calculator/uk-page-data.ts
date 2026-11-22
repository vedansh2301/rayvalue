/**
 * Server-side adapter for the UK calculator page: loads and validates every row the island needs (Supabase,
 * publishable key, SELECT only) and returns them as props. The browser never talks to the database. SERVER-ONLY.
 * Any missing or invalid piece makes the whole page "verifying" (HTTP 200, short cache): a half-loaded calculator
 * would have to guess, and it never does.
 */
import type { DbError, Result } from '../db/client';
import type { createGlobalRepo } from '../db/repo-global';
import type { UkCalculatorProps } from './uk';

export const UK_COUNTRY = 'GB';
/** The national "region" row that holds the GB cost, utility and assumption rows (migration 0035). */
export const UK_DATA_REGION = 'GB';

export type UkPageData = { ok: true; props: UkCalculatorProps } | { ok: false; error: DbError };

type Repo = Pick<ReturnType<typeof createGlobalRepo>, 'loadMarket' | 'loadGlobalUtilities' | 'loadExportPolicies' | 'loadGlobalCosts' | 'loadGlobalAssumptions' | 'loadVatRates' | 'loadCalcLocations'>;

const fail = (r: Result<unknown>): UkPageData | null => (r.ok ? null : { ok: false, error: r.error });

/** `today` (ISO date) is injectable for tests; the page passes the server date. */
export async function loadUkPageData(today: string, repo?: Repo): Promise<UkPageData> {
  const r = repo ?? (await import('../db/repo-global')).createGlobalRepo();
  const [market, utilities, policies, costs, assumptions, vat, locations] = await Promise.all([
    r.loadMarket(UK_COUNTRY),
    r.loadGlobalUtilities(UK_COUNTRY, UK_DATA_REGION),
    r.loadExportPolicies(UK_COUNTRY),
    r.loadGlobalCosts(UK_COUNTRY, UK_DATA_REGION),
    r.loadGlobalAssumptions(UK_COUNTRY),
    r.loadVatRates(UK_COUNTRY),
    r.loadCalcLocations(UK_COUNTRY),
  ]);
  const bad = fail(market) ?? fail(utilities) ?? fail(policies) ?? fail(costs) ?? fail(assumptions) ?? fail(vat) ?? fail(locations);
  if (bad) return bad;
  if (!market.ok || !utilities.ok || !policies.ok || !costs.ok || !assumptions.ok || !vat.ok || !locations.ok) throw new Error('unreachable');
  const exportPolicies = policies.value.filter((p) => p.kind === 'feed_in');
  if (exportPolicies.length === 0) return { ok: false, error: { kind: 'not_found', message: 'no export offers for GB' } };
  return {
    ok: true,
    props: { market: market.value, utilities: utilities.value, locations: locations.value, exportPolicies, costs: costs.value, assumptions: assumptions.value, vatRates: vat.value, today },
  };
}
