/** Loads the DB rows for a utility page and builds its view model. SERVER-ONLY. */
import type { DbError, Result } from '../db/client';
import type { CalcConfig } from '../db/repo';
import type { City, CityProduction, State } from '../../data/schemas';
import { lookupZip } from '../geo';
import { UTILITY_PAGES, type UtilityPageMeta } from './pages';
import { buildUtilityPage, type UtilityPageVm } from './view';

export type UtilityPageData = { kind: 'ok'; vm: UtilityPageVm } | { kind: 'unavailable'; meta: UtilityPageMeta; error: DbError | null };

export interface UtilityRepo {
  loadCalcConfig(state: State): Promise<Result<CalcConfig>>;
  loadCities(state?: State): Promise<Result<City[]>>;
  loadProduction(state: State, slug?: string): Promise<Result<CityProduction[]>>;
}

export async function loadUtilityPageData(slug: string, repo?: UtilityRepo): Promise<UtilityPageData> {
  const meta = UTILITY_PAGES.find((p) => p.slug === slug);
  if (!meta) throw new Error(`unknown utility page: ${slug}`);
  const r = repo ?? (await import('../db/repo'));
  const [cfg, cities, production] = await Promise.all([r.loadCalcConfig(meta.state), r.loadCities(meta.state), r.loadProduction(meta.state)]);
  if (!cfg.ok) return { kind: 'unavailable', meta, error: cfg.error };
  const vm = buildUtilityPage({
    meta,
    utilities: cfg.value.utilities,
    costs: cfg.value.costs,
    assumptions: cfg.value.assumptions,
    // Cities/production are optional: without them the examples show "being verified" and the page is noindex.
    cities: cities.ok ? cities.value : [],
    production: production.ok ? production.value : [],
    lookupZip,
  });
  return vm ? { kind: 'ok', vm } : { kind: 'unavailable', meta, error: null };
}

/** Cache headers: normal DB-page cache when complete, short cache when examples or data are missing, never cache an outage. */
export function applyUtilityPageHeaders(response: { status?: number; headers: Headers }, data: UtilityPageData): void {
  if (data.kind === 'unavailable') {
    response.status = 503;
    response.headers.set('Cache-Control', 'no-store');
    console.error(`utility page ${data.meta.slug}: data unavailable`, data.error?.kind ?? 'missing utility row');
    return;
  }
  const h = data.vm.indexable
    ? { 'Cache-Control': 'public, max-age=0', 'CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400' }
    : { 'Cache-Control': 'public, max-age=0', 'CDN-Cache-Control': 'public, s-maxage=60' };
  for (const [k, v] of Object.entries(h)) response.headers.set(k, v);
}
