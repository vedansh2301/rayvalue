/**
 * Year-by-year savings for `years` years. `savingsInYear(n)` receives n = 1…years and
 * returns that year's savings (callers apply degradation and escalation there).
 */
export function projectSavings(years: number, savingsInYear: (n: number) => number): number[] {
  return Array.from({ length: years }, (_, i) => savingsInYear(i + 1));
}

/**
 * Payback in years: the first year in which cumulative savings reach `cost`, with
 * linear interpolation inside that year: (n − 1) + (cost − cumulative_{n−1}) / savings_n.
 * Returns null if savings never reach the cost within the projection (or are all zero),
 * and 0 if there is nothing to pay back (cost <= 0 with some savings).
 * Not rounded (see round.ts).
 */
export function paybackYears(cost: number, yearlySavings: readonly number[]): number | null {
  if (yearlySavings.every((s) => s <= 0)) return null;
  if (cost <= 0) return 0;
  let cumulative = 0;
  for (let i = 0; i < yearlySavings.length; i++) {
    const s = yearlySavings[i]!;
    const before = cumulative;
    cumulative += s;
    if (s > 0 && cumulative >= cost) return i + (cost - before) / s;
  }
  return null;
}

/** Undiscounted cumulative savings over the projection minus installed cost. */
export function netSavings(cost: number, yearlySavings: readonly number[]): number {
  return yearlySavings.reduce((a, b) => a + b, 0) - cost;
}
