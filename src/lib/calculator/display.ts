/**
 * Display formatting for calculator results (pure; no calculation). Values arrive
 * already rounded by src/lib/calc; this only turns them into text.
 */
import type { PaybackRange, Range } from '../calc/types';
import { formatUsd } from '../format';

/** What the results card renders for one metric: a single value, or likely + low–high. */
export type RangeDisplay = { kind: 'single'; value: string } | { kind: 'range'; likely: string; low: string; high: string };

export const formatKw = (kw: number) => `${kw.toFixed(1)} kW`;

/** 7 -> "7 years", 7.5 -> "7.5 years", 1 -> "1 year". */
export function formatYears(y: number): string {
  return `${String(y)} ${y === 1 ? 'year' : 'years'}`;
}

/** Money that may be negative: -2500 -> "−$2,500" (true minus sign). */
export function formatSignedUsd(n: number): string {
  return n < 0 ? `−${formatUsd(-n)}` : formatUsd(n);
}

/** Whole-unit money formatters for any market ("£12,500"; negatives use a true minus sign). Display only. */
export function moneyFormats(locale: string, currency: string) {
  const f = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
  return {
    money: (n: number) => f.format(n),
    signed: (n: number) => (n < 0 ? `−${f.format(-n)}` : f.format(n)),
    /** The currency symbol alone, for chart axes ("£"). */
    symbol: f.formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency,
  };
}

/** A rounded range; collapses to one value when low, likely and high are all equal. */
export function displayRange(r: Range, fmt: (n: number) => string): RangeDisplay {
  if (r.low === r.high && r.low === r.likely) return { kind: 'single', value: fmt(r.likely) };
  return { kind: 'range', likely: fmt(r.likely), low: fmt(r.low), high: fmt(r.high) };
}

/** Payback where null means "not within the analysis period". `low` is the best (shortest) case. */
export function displayPayback(r: PaybackRange, analysisYears: number): RangeDisplay {
  const beyond = `More than ${formatYears(analysisYears)}`;
  const f = (y: number | null) => (y === null ? beyond : formatYears(y));
  if (r.low === r.high && r.low === r.likely) return { kind: 'single', value: f(r.likely) };
  return { kind: 'range', likely: f(r.likely), low: f(r.low), high: r.high === null ? `more than ${formatYears(analysisYears)}` : f(r.high) };
}

/** Plain-text version for screen readers / copy: "$10,000 to $15,000, likely $12,000". */
export function rangeText(d: RangeDisplay): string {
  return d.kind === 'single' ? d.value : `${d.low} to ${d.high}, likely ${d.likely}`;
}
