/**
 * Shareable calculator URLs: ?zip=&utility=&bill=&battery=&shading=
 * Pure parse/serialize only (syntax checks). Whether the ZIP is in the page's state, the
 * utility exists and the bill is within bounds is checked by the calculator against its data.
 */
import type { BatteryCount, Shading } from './calc/types';

export interface ShareParams {
  zip: string;
  utility: string;
  /** Average monthly bill in dollars as entered (up to 2 decimals). */
  bill: number;
  battery: BatteryCount;
  shading: Shading;
}

const BATTERIES: Record<string, BatteryCount> = { '0': 0, '1': 1, '2': 2 };
const SHADINGS: readonly Shading[] = ['none', 'some', 'heavy'];

/** Parse share params from a query string (with or without "?") or URLSearchParams. All five must be present and well-formed, else null. */
export function parseShareParams(search: string | URLSearchParams): ShareParams | null {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  const zip = p.get('zip')?.trim() ?? '';
  const utility = p.get('utility')?.trim() ?? '';
  const billRaw = p.get('bill')?.trim() ?? '';
  const batteryRaw = p.get('battery')?.trim() ?? '';
  const shadingRaw = p.get('shading')?.trim() ?? '';

  if (!/^\d{5}$/.test(zip)) return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(utility)) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(billRaw)) return null;
  const bill = Number(billRaw);
  if (!Number.isFinite(bill) || bill <= 0) return null;
  const battery = BATTERIES[batteryRaw];
  if (battery === undefined) return null;
  const shading = SHADINGS.find((s) => s === shadingRaw);
  if (!shading) return null;
  return { zip, utility, bill, battery, shading };
}

/** "?zip=…&utility=…&bill=…&battery=…&shading=…" in a fixed order. */
export function serializeShareParams(p: ShareParams): string {
  const q = new URLSearchParams();
  q.set('zip', p.zip);
  q.set('utility', p.utility);
  q.set('bill', String(p.bill));
  q.set('battery', String(p.battery));
  q.set('shading', p.shading);
  return `?${q.toString()}`;
}

/** Just the `?utility=` id (syntax only), for linking into a calculator from a utility page. null when absent or malformed. */
export function parseUtilityParam(search: string | URLSearchParams): string | null {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  const utility = p.get('utility')?.trim() ?? '';
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(utility) ? utility : null;
}
