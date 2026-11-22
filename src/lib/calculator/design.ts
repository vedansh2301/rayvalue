/**
 * Pure helpers for the designed calculator layout (the shared island and the country shells): the UK map dots, the VAT
 * countdown, answered-question counting, the export-rate bars and the usage slider. No tariff, rate or cost is typed
 * here: rates, VAT windows and bounds come from database rows; the map dot coordinates are drawing geometry only.
 */
import type { IncentiveRecord, VatRate } from '../../data/schemas-global';

/** Dot positions on the UK outline (viewBox "-4 -2 71 104", outline 62.9 x 100), keyed by price cap region name. Geometry only. */
export const UK_REGION_DOTS: Readonly<Record<string, readonly [x: number, y: number]>> = {
  'London': [48, 82], 'Northern Scotland': [25, 22], 'Southern Scotland': [27, 42], 'North Eastern England': [41, 50],
  'North Western England': [33, 57], 'Yorkshire': [43, 59], 'Merseyside and Northern Wales': [27, 64], 'East Midlands': [43, 69],
  'West Midlands': [35, 73], 'Eastern England': [53, 73], 'Southern Wales': [24, 80], 'South Western England': [22, 90],
  'Southern England': [37, 88], 'South Eastern England': [55, 87],
};

/** The dot of a region by its display name (the "(Ofgem price cap region)" suffix is ignored); null when the map has none. */
export function regionDot(displayName: string): readonly [number, number] | null {
  return UK_REGION_DOTS[displayName.replace(/ \(Ofgem price cap region\)$/, '')] ?? null;
}

const DAY = 86_400_000;
const utcDay = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);

/**
 * Days from `today` to the last day of the solar VAT window that is at 0% today, or null when there is none or it has no
 * end date. Whole days (0 on the last day). Rows come from the vat_rates table.
 */
export function zeroVatDaysLeft(vat: readonly Pick<VatRate, 'applies_to' | 'rate' | 'valid_from' | 'valid_to'>[], today: string): number | null {
  const w = vat.find((v) => v.applies_to === 'solar' && v.rate === 0 && v.valid_to !== null && (v.valid_from === null || v.valid_from <= today) && v.valid_to >= today);
  return w ? utcDay(w.valid_to!) - utcDay(today) : null;
}

/** The ISO date the 0% solar VAT window ends (see zeroVatDaysLeft), for the "until" wording. */
export function zeroVatEnd(vat: readonly Pick<VatRate, 'applies_to' | 'rate' | 'valid_from' | 'valid_to'>[], today: string): string | null {
  return vat.find((v) => v.applies_to === 'solar' && v.rate === 0 && v.valid_to !== null && (v.valid_from === null || v.valid_from <= today) && v.valid_to >= today)?.valid_to ?? null;
}

/** Number of questions answered, out of `total` (the install question is not asked when a market has no install periods). */
export function answeredCount(a: { region: boolean; usage: boolean; roof: boolean; shade: boolean; install: boolean | null; offer: boolean }): { done: number; total: number } {
  const flags = [a.region, a.usage, a.roof, a.shade, ...(a.install === null ? [] : [a.install]), a.offer];
  return { done: flags.filter(Boolean).length, total: flags.length };
}

/** Width (0..100) of an export-rate bar: the rate as a share of the highest rate offered. Offers without a rate get 0. */
export function rateBarPct(rate: number | null, max: number): number {
  if (rate === null || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((rate / max) * 1000) / 10));
}

/** Slider ranges. These size the control only: the typed value is what is calculated, up to the database's bill limit. */
export const USAGE_SLIDER = {
  bill: { min: 20, max: 400, step: 5 },
  kwh: { min: 500, max: 10_000, step: 100 },
} as const;

/** The slider value for a typed amount, clamped into the slider's range (the thumb only; the typed value is untouched). */
export function sliderPosition(mode: 'bill' | 'kwh', value: number | null): number {
  const r = USAGE_SLIDER[mode];
  return value === null || !Number.isFinite(value) ? r.min : Math.max(r.min, Math.min(r.max, value));
}

/** Compass needle rotation (degrees) for a roof direction. */
export const COMPASS_DEG: Readonly<Record<'south' | 'east_west' | 'north', number>> = { south: 0, east_west: 90, north: 180 };

/** Width (0..100, one decimal) of the "N of M answered" bar. */
export const progressPct = (done: number, total: number): number => (total <= 0 ? 0 : Math.round((done / total) * 1000) / 10);

/**
 * Days from `today` to the last day of the current per-kWh battery rebate row that has an end date (the date the rebate
 * steps down), or null when there is none. Whole days. Rows come from the incentives table.
 */
export function rebateStepDownDays(rows: readonly Pick<IncentiveRecord, 'amount_type' | 'amount_likely' | 'effective_from' | 'effective_to'>[], today: string): number | null {
  const ends = rows
    .filter((r) => r.amount_type === 'per_kwh_storage' && r.amount_likely !== null && r.effective_to !== null && (r.effective_from === null || r.effective_from <= today) && r.effective_to >= today)
    .map((r) => r.effective_to!)
    .sort();
  return ends.length ? utcDay(ends[0]!) - utcDay(today) : null;
}
