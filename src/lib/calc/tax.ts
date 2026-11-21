import type { Resolved } from './rates';
import type { Range } from './types';

/** How a cost line is priced. costsIncludeTax null/undefined = unknown or already consumer-facing (the US rows today): used as is. */
export interface TaxInfo {
  /** cost_ranges.includes_tax: true = price already includes VAT/GST; false = ex-tax. */
  costsIncludeTax: boolean | null;
  /** markets.vat_rate as a fraction (0.10 = 10%); null = not verified yet. */
  vatRate: number | null;
}

/**
 * Convert a cost range to consumer prices (VAT/GST included): the calculator always works in what the homeowner
 * pays. An ex-tax line is multiplied by (1 + vatRate); the rate comes from the markets table, never a constant.
 * A tax-inclusive (or unknown / US) line passes through unchanged. An ex-tax line with no verified rate is
 * missing data (`markets[CC].vat_rate`), never a silent zero.
 */
export function toConsumerPrice(range: Range, tax: TaxInfo | undefined, country: string): Resolved<Range> {
  if (!tax || tax.costsIncludeTax !== false) return { ok: true, value: range };
  if (tax.vatRate === null) return { ok: false, missing: [`markets[${country}].vat_rate`] };
  const f = 1 + tax.vatRate;
  return { ok: true, value: { low: range.low * f, likely: range.likely * f, high: range.high * f } };
}
