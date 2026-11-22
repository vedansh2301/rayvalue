/** Locale-aware formatting for place pages (numbers, percentages, money, dates). Pure; display only, no arithmetic on data. */

export function formatNumber(n: number, locale: string, maxFractionDigits = 0, minFractionDigits = 0): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: maxFractionDigits, minimumFractionDigits: Math.min(minFractionDigits, maxFractionDigits) }).format(n);
}

/** The value is already in percent units (49.2 means 49.2%), so only the suffix is added: "49.2%" (en) / "49,2 %" (de). */
export function formatPercent(n: number, locale: string, digits = 1): string {
  // English keeps "49.2%", German "49,2 %" (no-break space). Every other locale follows its own CLDR percent pattern
  // (Swedish "49,2 %", Polish "49,2%" ...), so the sign sits where readers there expect it.
  if (locale.startsWith('en')) return `${formatNumber(n, locale, digits, digits)}%`;
  if (locale.startsWith('de')) return `${formatNumber(n, locale, digits, digits)}\u00a0%`;
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n / 100);
}

export function formatMoney(n: number, currency: string, locale: string, digits = 0): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2026-11-22" -> "22 November 2026" (en-GB / en-AU) or "22. November 2026" (de). "2026-09" -> "September 2026".
 * Anything else (a bare year, free text) comes back unchanged.
 */
export function formatDate(iso: string, locale: string): string {
  const m = ISO_DATE.exec(iso);
  const ym = /^(\d{4})-(\d{2})$/.exec(iso);
  const parts = m ?? ym;
  if (!parts) return iso;
  const d = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, m ? Number(m[3]) : 1));
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, m ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Short month names for the 12-month chart, in the page locale. */
export function monthLabels(locale: string): string[] {
  const f = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  // English short names vary in length by locale (Sept, June); three letters keep the chart labels even.
  const en = locale.startsWith('en');
  return Array.from({ length: 12 }, (_, i) => { const m = f.format(new Date(Date.UTC(2026, i, 1))).replace(/\.$/, ''); return en ? m.slice(0, 3) : m; });
}

/**
 * A fact period for display. Periods are stored as '' (none), a date, a 'from/to' interval or 'm01'..'m12' (a month).
 * Months are not shown (they are the chart); a date shows as that date; an interval as "from to to".
 */
export function formatPeriod(period: string, locale: string, to: string): string | null {
  if (!period || /^m\d{2}$/.test(period)) return null;
  const [a, b] = period.split('/');
  if (b) return `${formatDate(a!, locale)} ${to} ${formatDate(b, locale)}`;
  return formatDate(a!, locale);
}
