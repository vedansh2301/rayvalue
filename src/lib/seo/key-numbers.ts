/**
 * "Key numbers" block data for the answer-first section at the top of city and utility pages. Pure: it only formats
 * values that already come from the database or the calc engine (never computes or invents one). A line whose input
 * is null is dropped, never shown as a placeholder. Every line carries its source link and the date it was checked.
 */
import type { CityProduction, StateCosts, Utility } from '../../data/schemas';
import { taxPath } from '../paths';
import { maxDate } from './lastmod';
import { formatKwhLabel, isHttpUrl, utilityRateRows } from '../city/view';

export interface KeyNumber {
  label: string;
  value: string;
  source: { label: string; url: string } | null;
  checkedOn: string | null;
  note?: string;
}

export interface KeyNumbersBlock {
  /** One-sentence answer, or null when the inputs for it are missing. */
  answer: string | null;
  items: KeyNumber[];
  /** Newest checkedOn among the items. */
  checkedOn: string | null;
}

export const MIN_ITEMS = 3;
export const MAX_ITEMS = 5;

/** Keep the first MAX_ITEMS lines; fewer than MIN_ITEMS means the block is not shown at all. */
export function finishBlock(answer: string | null, items: readonly (KeyNumber | null)[]): KeyNumbersBlock {
  const kept = items.filter((i): i is KeyNumber => i !== null).slice(0, MAX_ITEMS);
  if (kept.length < MIN_ITEMS) return { answer: null, items: [], checkedOn: null };
  return { answer, items: kept, checkedOn: maxDate(...kept.map((i) => i.checkedOn)) };
}

const src = (label: string, url: string | null | undefined) => (isHttpUrl(url) ? { label, url } : null);

/** First energy-rate line of the utility's rate table (first tier, or the published average). */
export function rateKeyNumber(u: Utility): KeyNumber | null {
  const row = utilityRateRows(u).find((r) => r.value !== null && r.label !== 'Fixed monthly charge' && r.label !== 'Average export credit');
  if (!row || row.value === null) return null;
  const avg = u.rate_type === 'tou_summary' ? u.avg_rate_per_kwh : null;
  return {
    label: `${u.name}: ${row.label.toLowerCase()}`,
    value: row.value,
    source: src(`${u.name} rate source`, avg ? avg.source_url : u.source_url),
    checkedOn: avg ? avg.verified_on : u.verified_on,
  };
}

export function fixedChargeKeyNumber(u: Utility): KeyNumber | null {
  const row = utilityRateRows(u).find((r) => r.label === 'Fixed monthly charge');
  if (!row || row.value === null) return null;
  return { label: 'Fixed monthly charge', value: row.value, source: src(`${u.name} rate source`, u.source_url), checkedOn: u.verified_on };
}

/** California export credit (only when the utility row has one). */
export function exportKeyNumber(u: Utility): KeyNumber | null {
  if (u.state !== 'CA') return null;
  const row = utilityRateRows(u).find((r) => r.label === 'Average export credit');
  if (!row || row.value === null) return null;
  return { label: 'Average export credit (NEM 3.0)', value: row.value, source: src('Export credit source', u.export_credit_source_url), checkedOn: u.export_credit_verified_on };
}

export function productionKeyNumber(p: CityProduction | null): KeyNumber | null {
  if (!p) return null;
  return { label: 'Solar output', value: `${formatKwhLabel(p.annual_kwh_per_kw)} kWh per kW per year`, source: src('NREL PVWatts', p.source_url), checkedOn: p.fetched_on };
}

const usd2 = (n: number) => `$${n.toFixed(2)}`;
export function installedCostKeyNumber(c: StateCosts | null): KeyNumber | null {
  const l = c?.installed_cost_per_watt;
  if (!l || l.low === null || l.likely === null || l.high === null) return null;
  return { label: 'Installed cost', value: `${usd2(l.low)}–${usd2(l.high)} per watt (likely ${usd2(l.likely)})`, source: src('Cost source', l.source_url), checkedOn: l.verified_on };
}

/** Rule 2: the federal 25D credit is $0 for 2026+ installs. Text only, no figure. */
export const federalCreditKeyNumber = (): KeyNumber => ({
  label: 'Federal 25D solar credit',
  value: 'Not available for 2026+ installs',
  source: { label: 'Solar tax benefits', url: taxPath() },
  checkedOn: null,
});
