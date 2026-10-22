/**
 * Client-side live solar production via /api/pvwatts (no geo / ZIP tables imported here,
 * so it stays in the small initial island chunk). The nearest-city fallback is in engine.ts.
 */
import type { State } from '../../data/schemas';
import type { ProductionInput } from '../calc/types';

export const PVWATTS_TIMEOUT_MS = 6000;

/** Slim city shape the page sends to the browser. */
export interface FallbackCity {
  state: State;
  slug: string;
  name: string;
  lat: number;
  lon: number;
}

/** Slim precomputed production row the page sends to the browser. */
export interface FallbackProduction extends ProductionInput {
  slug: string;
  losses: number;
}

/** Canonical 2-decimal coordinate string (same rule as the endpoint, so no 308 redirect). */
export function coord2(n: number): string {
  const s = n.toFixed(2);
  return s === '-0.00' ? '0.00' : s;
}

/** /api/pvwatts URL with params in the endpoint's canonical order: lat, lon, losses. */
export function pvwattsUrl(lat: number, lon: number, losses: number): string {
  return `/api/pvwatts?lat=${coord2(lat)}&lon=${coord2(lon)}&losses=${String(losses)}`;
}

/** Validate the endpoint's JSON body; null if it is not a usable production record. */
export function parsePvwattsBody(json: unknown): ProductionInput | null {
  const j = json as { annual_kwh_per_kw?: unknown; monthly_kwh_per_kw?: unknown } | null;
  if (!j || typeof j !== 'object') return null;
  const annual = j.annual_kwh_per_kw;
  const monthly = j.monthly_kwh_per_kw;
  if (typeof annual !== 'number' || !Number.isFinite(annual) || annual <= 0) return null;
  if (!Array.isArray(monthly) || monthly.length !== 12 || !monthly.every((m) => typeof m === 'number' && Number.isFinite(m) && m >= 0)) return null;
  return { annualKwhPerKw: annual, monthlyKwhPerKw: monthly as number[] };
}

/**
 * Live production, or null on any error / non-200 / bad body / timeout / abort. Never throws.
 * `signal` lets the caller cancel a superseded request.
 */
export async function fetchLiveProduction(
  lat: number,
  lon: number,
  losses: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PVWATTS_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<ProductionInput | null> {
  if (signal?.aborted) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetchImpl(pvwattsUrl(lat, lon, losses), { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return parsePvwattsBody(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
