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

/** Select value for "My utility isn't listed" (never a utility id: ids are kebab-case names). */
export const UNLISTED_UTILITY = 'unlisted';

export type UtilityChoice = { kind: 'none' } | { kind: 'unlisted' } | { kind: 'listed'; id: string };

/** What the step-2 select currently means. Unknown values count as no choice. */
export function utilityChoice(value: string, utilityIds: readonly string[]): UtilityChoice {
  if (value === UNLISTED_UTILITY) return { kind: 'unlisted' };
  return utilityIds.includes(value) ? { kind: 'listed', id: value } : { kind: 'none' };
}

/** ["A"] → "A"; ["A", "B"] → "A and B"; ["A", "B", "C"] → "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface FormInputs {
  zip: string;
  utilityId: string;
  billRaw: string;
  battery: number;
  shading: string;
}

/** A stable key for the answers, to tell whether shown results still match the form. */
export function inputsKey(i: FormInputs): string {
  return JSON.stringify([i.zip.trim(), i.utilityId, i.billRaw.trim().replace(/^\$/, '').replace(/,/g, ''), i.battery, i.shading]);
}

/** Results are stale when they were computed for different answers than the form now holds. */
export function resultsStale(ranWith: string | null, current: FormInputs): boolean {
  return ranWith !== null && ranWith !== inputsKey(current);
}
