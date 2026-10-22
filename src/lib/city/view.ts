/**
 * Pure view-model helpers for city pages: no fetching, no Astro. Values come from the
 * database (via src/lib/db); this file only shapes and formats them. Anything unknown is
 * returned as null and shown as "being verified" by the components.
 */
import type { Assumptions, City, CityProduction, Utility } from '../../data/schemas';
import { calculate, lossesForShading } from '../calc';
import type { CalcContext, CalcSuccess } from '../calc';
import { formatUsd } from '../format';
import { lookupZip } from '../geo'; // server-side only (city pages render on the server)

export const STATE_SLUGS = { florida: 'FL', california: 'CA' } as const;
export type StateSlug = keyof typeof STATE_SLUGS;
export const STATE_NAMES = { FL: 'Florida', CA: 'California' } as const;

export function stateFromSlug(slug: string | undefined): 'FL' | 'CA' | null {
  return slug === 'florida' || slug === 'california' ? STATE_SLUGS[slug] : null;
}
export const slugFromState = (s: 'FL' | 'CA'): StateSlug => (s === 'FL' ? 'florida' : 'california');

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Illustrative monthly bills for the example-payback section, from model_assumptions key
 * `city_example_bills` (model inputs, not facts). null when the row is missing or assumptions
 * could not be loaded: the page then shows the section as "being verified". No fallback in code.
 */
export function exampleBills(assumptions: Assumptions | null): readonly number[] | null {
  return assumptions?.city_example_bills?.value ?? null;
}

/** Owner-written Markdown intro -> plain paragraphs (rendered as escaped text; no HTML is ever injected). */
export function introParagraphs(md: string | null): string[] {
  if (!md) return [];
  return md
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

/** Only http(s) URLs from the DB are rendered as links (blocks javascript:, data: etc.). */
export const isHttpUrl = (u: string | null | undefined): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);

const usdRate = (n: number) => `$${n.toFixed(3).replace(/0$/, '')}/kWh`;
export const formatRate = (n: number | null): string | null => (n === null ? null : usdRate(n));

export interface RateRow {
  label: string;
  /** null = being verified */
  value: string | null;
}

/** Display rows for one utility's rates. */
export function utilityRateRows(u: Utility): RateRow[] {
  const rows: RateRow[] = [];
  if (u.rate_type === 'tiered' && u.tier_sets) {
    for (const set of u.tier_sets) {
      const season = set.season === 'all_year' ? '' : `${set.season === 'summer' ? 'Summer' : 'Winter'} `;
      let prev = 0;
      set.tiers.forEach((t, i) => {
        const range = t.up_to_kwh === null ? `Over ${prev} kWh/month` : `${i === 0 ? 'First' : `${prev}–`}${i === 0 ? ` ${t.up_to_kwh} kWh/month` : `${t.up_to_kwh} kWh/month`}`;
        rows.push({ label: `${season}${range}`, value: formatRate(t.rate_per_kwh) });
        if (t.up_to_kwh !== null) prev = t.up_to_kwh;
      });
    }
  } else if (u.avg_rate_per_kwh) {
    rows.push({ label: 'Average residential rate', value: formatRate(u.avg_rate_per_kwh.likely) });
  }
  if (u.state === 'CA') rows.push({ label: 'Average export credit', value: formatRate(u.avg_export_credit_per_kwh) });
  rows.push({ label: 'Fixed monthly charge', value: u.fixed_monthly_charge === null ? null : formatUsd(u.fixed_monthly_charge) });
  return rows;
}

/** The export credit's own source (CA), for a footnote under the rate table; null when absent or not an http(s) link. */
export function exportCreditSource(u: Utility): { url: string; date: string | null; note: string | null } | null {
  if (u.avg_export_credit_per_kwh === null || !isHttpUrl(u.export_credit_source_url)) return null;
  return { url: u.export_credit_source_url, date: u.export_credit_verified_on, note: u.export_credit_note };
}

export interface Bar {
  month: string;
  kwh: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bar geometry for a 12-month chart in a (width x height) viewBox; bars scale to the largest month. */
export function chartBars(monthly: readonly number[], width = 600, height = 220, pad = { top: 12, bottom: 28, side: 8 }): Bar[] {
  const max = Math.max(...monthly, 0);
  const plotH = height - pad.top - pad.bottom;
  const slot = (width - pad.side * 2) / monthly.length;
  const w = slot * 0.7;
  return monthly.map((kwh, i) => {
    const h = max > 0 ? (kwh / max) * plotH : 0;
    return { month: MONTHS[i] ?? String(i + 1), kwh, x: pad.side + slot * i + (slot - w) / 2, y: pad.top + plotH - h, w, h };
  });
}

/** The production record matching the "some shading" loss assumption, or null. */
export function pickProduction(rows: readonly CityProduction[], assumptions: Assumptions): CityProduction | null {
  const loss = lossesForShading('some', assumptions);
  return rows.find((r) => Math.abs(r.losses - loss) < 1e-9) ?? null;
}

export interface ExampleRow {
  bill: number;
  /** null = being verified (missing data, or the calculation could not run) */
  result: Pick<CalcSuccess, 'size' | 'cost' | 'paybackYears'> | null;
}

/** Example payback (solar only, some shading) for each illustrative bill. Never throws. */
export function exampleRows(
  city: City,
  bills: readonly number[],
  ctx: Omit<CalcContext, 'production' | 'lookupZip'> | null,
  production: CityProduction | null,
  zip = city.coords_zcta,
): ExampleRow[] {
  return bills.map((bill) => {
    if (!ctx || !production) return { bill, result: null };
    try {
      const r = calculate(
        { zip, utilityId: city.default_utility_id, avgMonthlyBill: bill, battery: 0, shading: 'some' },
        { ...ctx, lookupZip, production: { annualKwhPerKw: production.annual_kwh_per_kw, monthlyKwhPerKw: production.monthly_kwh_per_kw } },
      );
      return { bill, result: r.ok ? { size: r.size, cost: r.cost, paybackYears: r.paybackYears } : null };
    } catch {
      return { bill, result: null };
    }
  });
}

export function formatYears(y: number | null, max: number): string {
  return y === null ? `more than ${max}` : String(y);
}
