import type { Utility } from '../../data/schemas';

/** A tier with every value present. `upTo` is the monthly kWh ceiling; null = open-ended. */
export interface ResolvedTier {
  upTo: number | null;
  /** All-in $/kWh. */
  rate: number;
  /** Base-energy part of `rate` (only meaningful for a base_charges minimum; else equals `rate`). */
  baseRate: number;
}

/**
 * A minimum monthly bill.
 *  - base_charges: bill = max(amount, fixed + base energy) + clause energy (FPL's definition).
 *  - total_bill:   bill = max(amount, fixed + all energy).
 */
export interface MinimumBill {
  amount: number;
  basis: 'base_charges' | 'total_bill';
}

/** FL retail net metering: one tier list per calendar month (index 0 = January). */
export interface TieredRates {
  kind: 'tiered';
  fixedMonthly: number;
  /** null when the tariff has no minimum bill. */
  minimum: MinimumBill | null;
  monthTiers: readonly (readonly ResolvedTier[])[];
}

/** CA net billing: one published average retail rate plus an average export credit. */
export interface AvgRates {
  kind: 'avg';
  fixedMonthly: number;
  /** utility.avg_rate_per_kwh.likely (published residential class average). */
  retailRate: number;
  /** utility.avg_export_credit_per_kwh. */
  exportCredit: number;
}

export type RateModel = TieredRates | AvgRates;

export type Resolved<T> = { ok: true; value: T } | { ok: false; missing: string[] };

/**
 * Turn a utility record into the numbers the engine needs, or list every null it
 * would need. Paths use the same spelling as docs/TODO-VERIFY.md. Never substitutes
 * a default for a null.
 *
 * Needed: FL = fixed_monthly_charge + every tier rate in every tier set (all 12 months
 * are priced) + the minimum bill (unless the basis is "none"; an unknown basis reports
 * minimum_monthly_bill) + every tier's base_rate_per_kwh when the minimum is on base charges; CA = fixed_monthly_charge + avg_rate_per_kwh.likely + avg_export_credit_per_kwh.
 * Not needed (so not reported): CA avg_rate_per_kwh.low/high, TOU rates, baseline credit.
 */
export function resolveRates(u: Utility): Resolved<RateModel> {
  const p = `utilities[${u.id}]`;
  const missing: string[] = [];

  if (u.rate_type === 'tiered') {
    const sets = u.tier_sets ?? [];
    const basis = u.minimum_bill_basis;
    const onBase = basis === 'base_charges';
    for (const set of sets) {
      set.tiers.forEach((t, i) => {
        if (t.rate_per_kwh === null) missing.push(`${p}.tier_sets[${set.season}].tiers[${i}].rate_per_kwh`);
        if (onBase && t.base_rate_per_kwh === null) missing.push(`${p}.tier_sets[${set.season}].tiers[${i}].base_rate_per_kwh`);
      });
    }
    if (u.fixed_monthly_charge === null) missing.push(`${p}.fixed_monthly_charge`);
    const hasMinimum = basis === 'base_charges' || basis === 'total_bill';
    // Unknown basis (null), or a known basis without an amount, is missing data.
    if (basis === null || (hasMinimum && u.minimum_monthly_bill === null)) missing.push(`${p}.minimum_monthly_bill`);
    if (missing.length) return { ok: false, missing };
    const minimum: MinimumBill | null = hasMinimum ? { amount: u.minimum_monthly_bill as number, basis } : null;

    const monthTiers: ResolvedTier[][] = [];
    for (let m = 1; m <= 12; m++) {
      const set = sets.find((s) => s.months.includes(m));
      // The schema guarantees every month is covered by exactly one set.
      if (!set) throw new Error(`${u.id}: no tier set covers month ${m}`);
      monthTiers.push(
        set.tiers.map((t) => {
          const rate = t.rate_per_kwh as number;
          return { upTo: t.up_to_kwh, rate, baseRate: onBase ? (t.base_rate_per_kwh as number) : rate };
        }),
      );
    }
    return { ok: true, value: { kind: 'tiered', fixedMonthly: u.fixed_monthly_charge as number, minimum, monthTiers } };
  }

  if (u.fixed_monthly_charge === null) missing.push(`${p}.fixed_monthly_charge`);
  const retail = u.avg_rate_per_kwh?.likely ?? null;
  if (retail === null) missing.push(`${p}.avg_rate_per_kwh.likely`);
  if (u.avg_export_credit_per_kwh === null) missing.push(`${p}.avg_export_credit_per_kwh`);
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    value: {
      kind: 'avg',
      fixedMonthly: u.fixed_monthly_charge as number,
      retailRate: retail as number,
      exportCredit: u.avg_export_credit_per_kwh as number,
    },
  };
}
