/**
 * Shared helpers of the international calculator island (pure). Install-timing periods built from the sourced windows,
 * locale-aware money input and display. Nothing here invents a number: dates come from database rows, and the only
 * arithmetic is day arithmetic on ISO dates and text formatting (unit tested).
 */
import type { PaybackRange } from '../calc/types';
import { resolveVatRate, type VatWindow } from '../calc/vat';
import type { BillCheck } from './form';
import { parseBill } from './form';
import type { CalcStrings, YearWords } from './intl-strings';

// ------------------------------------------------------------------ dates

export const longDate = (iso: string, locale: string): string => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftDay = (iso: string, days: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const dayAfter = (iso: string): string => shiftDay(iso, 1);
export const dayBefore = (iso: string): string => shiftDay(iso, -1);

// ------------------------------------------------------------------ install periods

/** A date window (any of VAT, incentive or export-rate rows). A null bound is open. */
export interface DateWindow {
  validFrom: string | null;
  validTo: string | null;
}

export interface InstallPeriod {
  id: string;
  /** First day of the period (>= today). */
  startsOn: string;
  /** Last day of the period; null = open-ended. */
  endsOn: string | null;
  /** ISO install date the engine runs with: the period's first day. */
  installDate: string;
  /** Solar VAT on that date (fraction); null when the market has no VAT window for it. */
  solarVat: number | null;
  /** Likely upfront battery incentive per usable kWh on that date (sum of per-kWh storage rows in effect); null when none. */
  batteryRebatePerKwh: number | null;
}

export interface PeriodInputs {
  vat: readonly (DateWindow & Pick<VatWindow, 'appliesTo' | 'rate'>)[];
  /** Per-kWh storage incentive rows (only the ones the calculator would apply: open or waitlist). */
  incentives?: readonly (DateWindow & { amountLikely: number | null; perKwhStorage: boolean })[];
  /** Export-rate windows (valid_from / valid_to of every export_policy_rates row). */
  exportRates?: readonly DateWindow[];
  /** Last install date offered (model_assumptions install_horizon); null = no limit. */
  horizon?: string | null;
  today: string;
}

/**
 * Install-timing periods: the span from `today` to the horizon split wherever a sourced VAT, incentive or export-rate window
 * starts or ends. One period per span, so a rule that changes on a date (VAT 0% to 5%, a battery rebate factor, a feed-in
 * rate that ends) gets its own choice. Windows that ended before today and boundaries past the horizon are ignored.
 * Empty when `today` is after the horizon.
 */
export function installPeriods(i: PeriodInputs): InstallPeriod[] {
  const { today, horizon = null } = i;
  if (horizon !== null && horizon < today) return [];
  const wins: DateWindow[] = [...i.vat, ...(i.incentives ?? []), ...(i.exportRates ?? [])];
  const cuts = new Set<string>();
  for (const w of wins) {
    if (w.validFrom !== null && w.validFrom > today) cuts.add(w.validFrom);
    if (w.validTo !== null && w.validTo >= today) cuts.add(dayAfter(w.validTo));
  }
  const starts = [today, ...[...cuts].filter((c) => c > today && (horizon === null || c <= horizon)).sort()];
  const schedule = i.vat.map((v) => ({ appliesTo: v.appliesTo, rate: v.rate, validFrom: v.validFrom, validTo: v.validTo }));
  return starts.map((start, n) => {
    const next = starts[n + 1];
    const endsOn = next !== undefined ? dayBefore(next) : horizon;
    const vat = resolveVatRate(schedule, 'solar', start, '--');
    const rebates = (i.incentives ?? []).filter((r) => r.perKwhStorage && r.amountLikely !== null && (r.validFrom === null || r.validFrom <= start) && (r.validTo === null || r.validTo >= start));
    return {
      id: start,
      startsOn: start,
      endsOn,
      installDate: start,
      solarVat: vat.ok ? vat.value : null,
      batteryRebatePerKwh: rebates.length ? rebates.reduce((s, r) => s + (r.amountLikely ?? 0), 0) : null,
    };
  });
}

/** The label of a period ("Installed by 31 March 2027", "Installed 1 January 2027 to 30 June 2027", "Installed from 1 April 2027"). */
export function periodLabel(p: InstallPeriod, index: number, s: Pick<CalcStrings, 'installBy' | 'installBetween' | 'installFrom'>, locale: string): string {
  if (p.endsOn === null) return s.installFrom(longDate(p.startsOn, locale));
  if (index === 0) return s.installBy(longDate(p.endsOn, locale));
  return s.installBetween(longDate(p.startsOn, locale), longDate(p.endsOn, locale));
}

// ------------------------------------------------------------------ money input

/**
 * A money amount as typed, for a locale. German: "1.250,50 €", "90,5" and "90" are fine (dot = thousands, comma = decimal);
 * English: "$1,250.50", "£90" (comma = thousands). Returns the same checks as parseBill (> 0 and <= max, up to 2 decimals).
 */
export function parseMoneyInput(raw: string, locale: string, max: number): BillCheck {
  let s = raw.trim().replace(/[£$€]/g, '').replace(/\s+/g, '');
  if (locale.startsWith('de')) {
    s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  }
  return parseBill(s, max);
}

/** A kWh amount as typed (a positive number, decimals allowed; thousands separators for the locale). Null when not a valid positive number. */
export function parseKwhInput(raw: string, locale: string): number | null {
  let s = raw.trim().replace(/\s+/g, '');
  if (s === '') return null;
  if (locale.startsWith('de')) s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ------------------------------------------------------------------ display

export const formatKwLocale = (kw: number, locale: string): string => `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(kw)} kW`;

const yearsText = (y: number, w: YearWords, locale: string): string => `${new Intl.NumberFormat(locale).format(y)} ${y === 1 ? w.one : w.many}`;

/** displayPayback() with the market's words and number format. For the English set it equals displayPayback() exactly. */
export function paybackText(r: PaybackRange, analysisYears: number, w: YearWords, locale: string) {
  const f = (y: number | null) => (y === null ? `${w.moreThan} ${yearsText(analysisYears, w, locale)}` : yearsText(y, w, locale));
  if (r.low === r.high && r.low === r.likely) return { kind: 'single' as const, value: f(r.likely) };
  return { kind: 'range' as const, likely: f(r.likely), low: f(r.low), high: r.high === null ? `${w.moreThanLower} ${yearsText(analysisYears, w, locale)}` : f(r.high) };
}
