import type { Assumptions } from '../../data/schemas';
import type { ProductionInput, Shading } from './types';

/** PVWatts `losses` (percent) to request for a shading level. Callers (Task 4) use this. */
export function lossesForShading(shading: Shading, assumptions: Assumptions): number {
  return assumptions.pvwatts_system_loss_pct[shading];
}

/** Throws on a malformed production input (a caller bug, not a user error). */
export function validateProduction(p: ProductionInput): void {
  if (!Number.isFinite(p.annualKwhPerKw) || p.annualKwhPerKw <= 0) {
    throw new RangeError(`production.annualKwhPerKw must be a positive number, got ${p.annualKwhPerKw}`);
  }
  if (p.monthlyKwhPerKw !== undefined) {
    const m = p.monthlyKwhPerKw;
    if (m.length !== 12) throw new RangeError(`production.monthlyKwhPerKw must have 12 values, got ${m.length}`);
    if (m.some((v) => !Number.isFinite(v) || v < 0)) throw new RangeError('production.monthlyKwhPerKw values must be non-negative numbers');
    if (m.reduce((a, b) => a + b, 0) <= 0) throw new RangeError('production.monthlyKwhPerKw must not sum to zero');
  }
}

/**
 * Share of annual production in each calendar month (index 0 = January); sums to 1.
 * From monthlyKwhPerKw normalized by its own sum, or 1/12 each if absent.
 */
export function monthlyShares(p: ProductionInput): number[] {
  if (!p.monthlyKwhPerKw) return Array.from({ length: 12 }, () => 1 / 12);
  const sum = p.monthlyKwhPerKw.reduce((a, b) => a + b, 0);
  return p.monthlyKwhPerKw.map((v) => v / sum);
}
