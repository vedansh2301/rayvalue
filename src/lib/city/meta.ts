/**
 * Title and meta description templates for city pages. Pure formatting and selection: every number in the output is a
 * value the caller passed in from the database / calc engine (nothing is computed or invented here), the only literal
 * digits being the page year. Title <= 60 characters including the " | RayValue" suffix; description 140-155.
 */
import { formatUsd } from '../format';
import { formatKwhLabel, formatYears } from './view';

export const TITLE_MAX = 60;
export const DESC_MIN = 140;
export const DESC_MAX = 155;
const SUFFIX = ' | RayValue';

export interface CityMetaInput {
  name: string;
  state: 'FL' | 'CA';
  stateName: string;
  /** Short utility name (copy metadata, e.g. "FPL"), or null. */
  utilityShort: string | null;
  /** The middle example bill, in dollars per month, with its calculated payback years; null when unavailable. */
  example: { bill: number; low: number | null; likely: number | null; high: number | null; analysisYears: number } | null;
  /** PVWatts annual kWh per kW for the city; null when unavailable. */
  annualKwhPerKw: number | null;
}

const fullLen = (title: string) => title.length + SUFFIX.length;

export function cityTitle(c: Pick<CityMetaInput, 'name' | 'state'>): string {
  const candidates = [
    `Solar payback in ${c.name}, ${c.state}: 2026, no tax credit`,
    `Is solar worth it in ${c.name}, ${c.state}? 2026 payback`,
    `${c.name}, ${c.state} solar payback in 2026`,
    `Solar payback in ${c.name}, ${c.state}`,
  ];
  const fits = candidates.filter((t) => fullLen(t) <= TITLE_MAX);
  return fits.find((t) => fullLen(t) >= 50) ?? fits[0] ?? candidates.at(-1)!;
}

export function paybackPhrase(e: NonNullable<CityMetaInput['example']>): string | null {
  const max = e.analysisYears;
  if (e.likely === null) return `more than ${max} years`;
  if (e.low === null) return null;
  const hi = formatYears(e.high, max);
  return e.high === null ? `${e.low} to ${hi} years (likely ${e.likely})` : `${e.low}–${hi} years (likely ${e.likely})`;
}

export function cityDescription(c: CityMetaInput): string {
  const util = c.utilityShort;
  const candidates: string[] = [];
  const phrase = c.example ? paybackPhrase(c.example) : null;
  if (c.example && phrase && util) {
    candidates.push(`${c.name} solar payback with no federal tax credit: ${phrase} for an example ${formatUsd(c.example.bill)}/month bill on ${util} rates. Sun and rate data.`);
  }
  if (c.annualKwhPerKw !== null && util) {
    candidates.push(`See solar payback in ${c.name}, ${c.state} with no federal tax credit: ${util} rates, about ${formatKwhLabel(c.annualKwhPerKw)} kWh per kW of sun a year, and example payback ranges.`);
  }
  candidates.push(`Electricity rates, sun hours and example solar payback ranges for ${c.name}, ${c.stateName} homeowners in 2026, with no federal tax credit applied.`);

  for (const base of candidates) {
    const padded = base.length < DESC_MIN ? `${base} Free calculator.` : base;
    if (padded.length >= DESC_MIN && padded.length <= DESC_MAX) return padded;
  }
  // No candidate fits the window (an unusually long name): the numberless generic line, never a truncated number.
  return candidates.at(-1)!;
}
