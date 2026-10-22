import type { AvgRates, RateModel, ResolvedTier, TieredRates } from './rates';

/**
 * Energy cost ($) of `kwh` used in one month, priced through a tier list.
 * Excludes the fixed charge. Monotone non-decreasing in kWh.
 *   e.g. tiers [≤1000 @ $0.10, rest @ $0.15], 1500 kWh → 1000×0.10 + 500×0.15 = $175
 */
export function tierEnergyCost(tiers: readonly ResolvedTier[], kwh: number): number {
  let cost = 0;
  let floor = 0;
  for (const t of tiers) {
    if (kwh <= floor) break;
    const ceiling = t.upTo ?? Infinity;
    cost += (Math.min(kwh, ceiling) - floor) * t.rate;
    floor = ceiling;
  }
  return cost;
}

/**
 * Total bill ($) over a year if the home uses `monthlyKwh` every month:
 * Σ over the 12 months of (fixed charge + that month's tiered energy cost).
 * Handles seasonal tier sets (e.g. Duke summer vs winter) month by month.
 */
export function annualBillCost(rates: TieredRates, monthlyKwh: number): number {
  let total = 0;
  for (const tiers of rates.monthTiers) total += rates.fixedMonthly + tierEnergyCost(tiers, monthlyKwh);
  return total;
}

/**
 * Invert annualBillCost by bisection: the monthly kWh whose annual bill equals
 * avgMonthlyBill × 12. Returns 0 when the bill is at or below the fixed charge.
 * Tolerance: 1e-6 kWh.
 */
export function invertTieredBill(rates: TieredRates, avgMonthlyBill: number): number {
  if (avgMonthlyBill <= rates.fixedMonthly) return 0;
  const target = avgMonthlyBill * 12;
  let lo = 0;
  let hi = 1000;
  let guard = 0;
  while (annualBillCost(rates, hi) < target) {
    hi *= 2;
    // Only reachable if every open-ended tier rate is $0, i.e. no usage can explain the bill.
    if (++guard > 60) throw new Error('cannot invert bill: open-ended tier rates are zero');
  }
  while (hi - lo > 1e-6) {
    const mid = (lo + hi) / 2;
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
