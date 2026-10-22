import type { PaybackRange, Range } from './types';

/** Round to the nearest multiple of `step`, halves away from zero (−250 → −300), never "-0". */
function roundTo(n: number, step: number): number {
  // Sub-unit steps divide by an integer factor so 0.3 stays 0.3 (3 × 0.1 would not).
  const f = step < 1 ? Math.round(1 / step) : 0;
  const m = f ? Math.round(Math.abs(n) * f) / f : Math.round(Math.abs(n) / step) * step;
  const r = Math.sign(n) * m;
  return r === 0 ? 0 : r;
}

/** kW to 0.1. */
export const roundKw = (kw: number) => roundTo(kw, 0.1);

/** Dollars to the nearest $100. */
export const roundUsd = (usd: number) => roundTo(usd, 100);

/** Years to the nearest 0.5. */
export const roundYears = (years: number) => roundTo(years, 0.5);

/** kWh to the nearest 100. */
export const roundKwh = (kwh: number) => roundTo(kwh, 100);

/** Rounding is monotone, so low <= likely <= high is preserved. */
export function roundRange(r: Range, fn: (n: number) => number): Range {
  return { low: fn(r.low), likely: fn(r.likely), high: fn(r.high) };
}

export function roundPayback(r: PaybackRange): PaybackRange {
  const f = (y: number | null) => (y === null ? null : roundYears(y));
  return { low: f(r.low), likely: f(r.likely), high: f(r.high) };
}
