/**
 * Calculator form helpers (pure). ZIP checks live in zip.ts. The island shows the
 * messages; the engine (src/lib/calc) re-checks everything and stays the authority.
 */
import type { State } from '../../data/schemas';

export const STATE_NAMES: Record<State, string> = { FL: 'Florida', CA: 'California' };
export const CALCULATOR_PATHS: Record<State, string> = { FL: '/calculator/florida', CA: '/calculator/california' };

export type BillCheck = { ok: true; value: number } | { ok: false; error: 'empty' | 'not_number' | 'too_low' | 'too_high' };

/** Dollars as typed ("$1,250.50" is fine). Must be > 0 and <= max. */
export function parseBill(raw: string, max: number): BillCheck {
  const s = raw.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  if (s === '') return { ok: false, error: 'empty' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'not_number' };
  const value = Number(s);
  if (!Number.isFinite(value)) return { ok: false, error: 'not_number' };
  if (value <= 0) return { ok: false, error: 'too_low' };
  if (value > max) return { ok: false, error: 'too_high' };
  return { ok: true, value };
}
