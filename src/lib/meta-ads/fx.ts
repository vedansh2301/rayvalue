/**
 * INR -> USD for display next to rupee amounts (pure). The rate is a sourced row in public.fx_rates (source_url +
 * verified_on); there is no rate in code. With no usable row the page shows rupees only. The rate is a range (lowest
 * and highest daily rate of the source week), so USD is shown as a range too.
 */
export interface FxRate {
  id: string;
  /** Rupees per US dollar. */
  low: number | null;
  likely: number | null;
  high: number | null;
  observed_from: string | null;
  observed_to: string | null;
  note: string | null;
  source_url: string | null;
  verified_on: string | null;
  verification: string;
}

/** A rate is usable only with all three bounds, a source and a date, and not marked unverified. */
export function usableRate(r: FxRate | null | undefined): r is FxRate & { low: number; likely: number; high: number; source_url: string; verified_on: string } {
  return !!r && r.low !== null && r.likely !== null && r.high !== null && r.low > 0 && r.low <= r.likely && r.likely <= r.high && !!r.source_url && !!r.verified_on && r.verification !== 'unverified';
}

/** USD range for an INR amount: low uses the highest rupees-per-dollar rate, high the lowest. null without a usable rate. */
export function usdRange(inr: number | null, rate: FxRate | null | undefined): { low: number; high: number } | null {
  if (inr === null || !usableRate(rate)) return null;
  return { low: inr / rate.high, high: inr / rate.low };
}

export function formatUsdRange(r: { low: number; high: number }): string {
  const f = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lo = f(r.low);
  const hi = f(r.high);
  return lo === hi ? lo : `${lo}–${hi}`;
}
