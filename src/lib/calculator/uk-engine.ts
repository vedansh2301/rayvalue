/**
 * Everything the UK island needs only when it runs an estimate (loaded with a dynamic import(), so it is not part of the
 * initial island chunk): the engine, the chart builder and the live PVGIS lookup through our own /api/pvgis proxy.
 */
import type { ProductionInput } from '../calc/types';
import { PVWATTS_TIMEOUT_MS, parsePvwattsBody } from './production';

export { calculateGlobal } from '../calc/calculate-global';
export { buildSavingsChart } from '../calc/chart';

/** Live yield for 1 kW DC from /api/pvgis, or null on any error, non-200, bad body, timeout or abort. Never throws. */
export async function fetchLivePvgis(url: string, fetchImpl: typeof fetch = fetch, timeoutMs: number = PVWATTS_TIMEOUT_MS, signal?: AbortSignal): Promise<ProductionInput | null> {
  if (signal?.aborted) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return parsePvwattsBody(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
