/** Formatting helpers for the human-readable assumptions / warnings lists. */

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rate = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 5 });

/** $12,500 */
export const dollars = (n: number) => usd0.format(n);
/** $10.52 */
export const cents = (n: number) => usd2.format(n);
/** $0.12258/kWh (data values shown as published, up to 5 decimals) */
export const perKwh = (n: number) => `${rate.format(n)}/kWh`;
/** $3.10/W */
export const perWatt = (n: number) => `${usd2.format(n)}/W`;
/** 0.045 → "4.5%" */
export const pct = (share: number) => `${Number((share * 100).toFixed(2))}%`;
/** 16,800 */
export const num = (n: number) => whole.format(n);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** [3..11] → "Mar–Nov", [12,1,2] → "Dec–Feb", non-contiguous → "Jan, Mar". */
export function monthSpan(months: readonly number[]): string {
  const set = new Set(months);
  if (set.size === 12) return 'all year';
  const prev = (m: number) => (m === 1 ? 12 : m - 1);
  const next = (m: number) => (m === 12 ? 1 : m + 1);
  const starts = [...set].filter((m) => !set.has(prev(m)));
  if (starts.length === 1) {
    const start = starts[0]!;
    let end = start;
    while (set.has(next(end))) end = next(end);
    return start === end ? MONTHS[start - 1]! : `${MONTHS[start - 1]}–${MONTHS[end - 1]}`;
  }
  return [...set].sort((a, b) => a - b).map((m) => MONTHS[m - 1]).join(', ');
}
