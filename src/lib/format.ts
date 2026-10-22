export interface Range {
  low: number;
  likely: number;
  high: number;
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Whole-dollar US currency, e.g. 12500 -> "$12,500". */
export function formatUsd(value: number): string {
  return usd.format(value);
}

/** "low – high (likely X)" using the supplied value formatter. */
export function formatRange(range: Range, fmt: (n: number) => string = String): string {
  return `${fmt(range.low)} – ${fmt(range.high)} (likely ${fmt(range.likely)})`;
}
