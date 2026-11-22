import { inWindow } from './export-policy';
import type { Resolved } from './rates';

/** One date-effective VAT/GST row (vat_rates, migration 0035). ISO dates; a null bound is open. rate is a fraction (0.05 = 5%). */
export interface VatWindow {
  appliesTo: 'solar' | 'battery';
  rate: number;
  validFrom: string | null;
  validTo: string | null;
}

/**
 * The VAT rate on installing `item` on `date`. When several windows contain the date the latest valid_from wins.
 * No window = missing data (listed as `vat_rates[CC/item@date]`), never a default rate.
 */
export function resolveVatRate(schedule: readonly VatWindow[], item: VatWindow['appliesTo'], date: string, country: string): Resolved<number> {
  const hit = schedule
    .filter((w) => w.appliesTo === item && inWindow(date, w.validFrom, w.validTo))
    .sort((a, b) => (b.validFrom ?? '').localeCompare(a.validFrom ?? ''))[0];
  return hit ? { ok: true, value: hit.rate } : { ok: false, missing: [`vat_rates[${country}/${item}@${date}]`] };
}
