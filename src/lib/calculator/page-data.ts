/**
 * Server-side adapter between the DB repository (src/lib/db, Task 4b) and the calculator
 * page. Everything the island needs is loaded here and passed as props; the browser never
 * talks to the database. SERVER-ONLY.
 */
import type { Assumptions, City, CityProduction, Costs, Offer, State, Utility } from '../../data/schemas';
import type { DbError, Result } from '../db/client';
import { toProductionInput } from '../db/map';
import { DB_PAGE_CACHE_HEADERS, type CalcConfig } from '../db/repo';
import type { FallbackCity, FallbackProduction } from './production';

/** Props for src/components/calculator/Calculator.tsx. */
export interface CalculatorProps {
  state: State;
  utilities: Utility[];
  costs: Costs;
  assumptions: Assumptions;
  fallbackCities: FallbackCity[];
  fallbackProduction: FallbackProduction[];
}

export type CalculatorPageData =
  | { ok: true; props: CalculatorProps; offer: Offer | null; warnings: DbError[] }
  | { ok: false; error: DbError };

/** The repo functions this adapter uses (injectable for tests). */
export interface CalculatorRepo {
  loadCalcConfig(state: State): Promise<Result<CalcConfig>>;
  loadCities(state?: State): Promise<Result<City[]>>;
  loadProduction(state: State, slug?: string): Promise<Result<CityProduction[]>>;
}

/** An offer is shown only when active and with a URL. */
export function visibleOffer(offer: Offer | null): Offer | null {
  return offer && offer.active && offer.url ? offer : null;
}

/**
 * Load config (required) plus cities and precomputed production (optional: without them the
 * calculator still works with live PVWatts, it just has no fallback).
 */
export async function loadCalculatorPageData(state: State, repo?: CalculatorRepo): Promise<CalculatorPageData> {
  const r = repo ?? (await import('../db/repo'));
  const [config, cities, production] = await Promise.all([r.loadCalcConfig(state), r.loadCities(state), r.loadProduction(state)]);
  if (!config.ok) return { ok: false, error: config.error };

  const warnings: DbError[] = [];
  if (!cities.ok) warnings.push(cities.error);
  if (!production.ok) warnings.push(production.error);
  const haveFallback = cities.ok && production.ok;

  const fallbackCities: FallbackCity[] = haveFallback
    ? cities.value.filter((c) => c.state === state).map((c) => ({ state: c.state, slug: c.slug, name: c.name, lat: c.lat, lon: c.lon }))
    : [];
  const fallbackProduction: FallbackProduction[] = haveFallback
    ? production.value
        .filter((p) => p.state === state)
        .map((p) => ({ slug: p.slug, losses: p.losses, ...toProductionInput(p) }))
    : [];

  const { utilities, costs, assumptions, offer } = config.value;
  return {
    ok: true,
    props: { state, utilities: utilities.filter((u) => u.state === state), costs, assumptions, fallbackCities, fallbackProduction },
    offer: visibleOffer(offer),
    warnings,
  };
}

/** Short CDN cache for the "verifying rates" fallback page so recovery shows up quickly. */
export const DB_ERROR_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0',
  'CDN-Cache-Control': 'public, s-maxage=60',
} as const;

/** Set cache headers for the page (normal or short "verifying" cache) and log load problems (log-safe messages only). */
export function applyCalculatorPageHeaders(headers: Headers, data: CalculatorPageData, state: State): void {
  for (const [k, v] of Object.entries(data.ok ? DB_PAGE_CACHE_HEADERS : DB_ERROR_CACHE_HEADERS)) headers.set(k, v);
  if (!data.ok) console.error(`calculator ${state}: data unavailable:`, data.error.kind, data.error.message, data.error.issues ?? '');
  else for (const w of data.warnings) console.error(`calculator ${state}: no production fallback:`, w.kind, w.message);
}
