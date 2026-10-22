import type { AvgRates, RateModel, ResolvedTier, TieredRates } from './rates';

/**
 * Energy cost ($) of `kwh` used in one month, priced through a tier list at either the
 * all-in rate (default) or the base-energy rate. Excludes the fixed charge. Monotone.
 *   e.g. tiers [≤1000 @ $0.10, rest @ $0.15], 1500 kWh → 1000×0.10 + 500×0.15 = $175
 */
export function tierEnergyCost(tiers: readonly ResolvedTier[], kwh: number, which: 'rate' | 'baseRate' = 'rate'): number {
  let cost = 0;
  let floor = 0;
  for (const t of tiers) {
    if (kwh <= floor) break;
    const ceiling = t.upTo ?? Infinity;
    cost += (Math.min(kwh, ceiling) - floor) * t[which];
    floor = ceiling;
  }
  return cost;
}

/**
 * One month's bill ($) for `kwh` through that month's tiers, including the fixed charge
 * and the minimum bill:
 *   no minimum:   fixed + energy
 *   total_bill:   max(minimum, fixed + energy)
 *   base_charges: max(minimum, fixed + base energy) + (energy − base energy)
 *                 (FPL: "monthly base electric service costs fall below $30 ... minimum $30
 *                 base bill"; fuel and other clause charges are billed on top)
 * Monotone non-decreasing in kWh.
 */
export function monthBill(rates: TieredRates, tiers: readonly ResolvedTier[], kwh: number): number {
  const energy = tierEnergyCost(tiers, kwh);
  const min = rates.minimum;
  if (!min) return rates.fixedMonthly + energy;
  if (min.basis === 'total_bill') return Math.max(min.amount, rates.fixedMonthly + energy);
  const base = tierEnergyCost(tiers, kwh, 'baseRate');
  return Math.max(min.amount, rates.fixedMonthly + base) + (energy - base);
}

/**
 * Total bill ($) over a year if the home uses `monthlyKwh` every month: Σ of the 12
 * months' monthBill. Handles seasonal tier sets (e.g. Duke summer vs winter).
 */
export function annualBillCost(rates: TieredRates, monthlyKwh: number): number {
  let total = 0;
  for (const tiers of rates.monthTiers) total += monthBill(rates, tiers, monthlyKwh);
  return total;
}

/** Average monthly bill at zero usage (fixed charge, or the minimum bill if higher). */
export function zeroUsageMonthlyBill(rates: RateModel): number {
  return rates.kind === 'tiered' ? annualBillCost(rates, 0) / 12 : rates.fixedMonthly;
}

/**
 * Invert annualBillCost by bisection: the monthly kWh whose annual bill equals
 * avgMonthlyBill × 12. Returns 0 when the bill is at or below the zero-usage bill.
 * Stops after 200 halvings, when the bracket is within 1e-9 relative (≥ 1e-9 kWh), or
 * when floating point can no longer split it, so it always terminates.
 */
export function invertTieredBill(rates: TieredRates, avgMonthlyBill: number): number {
  if (avgMonthlyBill <= zeroUsageMonthlyBill(rates)) return 0;
  const target = avgMonthlyBill * 12;
  let lo = 0;
  let hi = 1000;
  while (annualBillCost(rates, hi) < target) {
    lo = hi;
    hi *= 2;
    // Only reachable if every open-ended tier rate is $0 (no usage can explain the bill).
    if (!Number.isFinite(hi)) throw new Error('cannot invert bill: open-ended tier rates are zero');
  }
  for (let i = 0; i < 200; i++) {
    if (hi - lo <= 1e-9 * Math.max(1, hi)) break;
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (annualBillCost(rates, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** CA: (bill − fixed charge) ÷ published average retail rate, floored at 0. */
export function invertAvgRateBill(rates: AvgRates, avgMonthlyBill: number): number {
  if (avgMonthlyBill <= rates.fixedMonthly) return 0;
  if (!(rates.retailRate > 0)) throw new Error('cannot invert bill: average retail rate is zero');
  return (avgMonthlyBill - rates.fixedMonthly) / rates.retailRate;
}

/** Estimated annual kWh (monthly estimate × 12) from an average monthly bill. */
export function estimateAnnualKwh(avgMonthlyBill: number, rates: RateModel): number {
  const monthly = rates.kind === 'tiered' ? invertTieredBill(rates, avgMonthlyBill) : invertAvgRateBill(rates, avgMonthlyBill);
  return monthly * 12;
}
