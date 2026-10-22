import type { PaybackRange, Range } from './types';

/** Avoid "-0" leaking into output. */
const noNegZero = (n: number) => (n === 0 ? 0 : n);

/** kW to 0.1. */
export const roundKw = (kw: number) => noNegZero(Math.round(kw * 10) / 10);

/** Dollars to the nearest $100. */
export const roundUsd = (usd: number) => noNegZero(Math.round(usd / 100) * 100);

/** Years to the nearest 0.5. */
export const roundYears = (years: number) => noNegZero(Math.round(years * 2) / 2);

/** kWh to the nearest 100. */
export const roundKwh = (kwh: number) => noNegZero(Math.round(kwh / 100) * 100);

/** Rounding is monotone, so low <= likely <= high is preserved. */
export function roundRange(r: Range, fn: (n: number) => number): Range {
  return { low: fn(r.low), likely: fn(r.likely), high: fn(r.high) };
}

export function roundPayback(r: PaybackRange): PaybackRange {
  const f = (y: number | null) => (y === null ? null : roundYears(y));
  return { low: f(r.low), likely: f(r.likely), high: f(r.high) };
}
