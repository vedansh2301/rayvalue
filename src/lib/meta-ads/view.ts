/** Display helpers for /admin/ads (pure, unit tested). A missing value renders as an em dash, never as 0. */
import type { AdObject, InsightRow } from './types';

export const DASH = '—';

export const inr = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : DASH);
export const count = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : DASH);
export const decimal = (n: number | null | undefined, digits = 2) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : DASH);
export const pct = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}%` : DASH);

/** Seconds between two ISO times (>= 0). */
export const ageSeconds = (iso: string, now: Date) => Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));

export interface TreeRow {
  object: AdObject;
  depth: 0 | 1 | 2;
  /** Ads visible under this campaign / ad set (null for ads). */
  childAds: number | null;
}

/**
 * Campaign -> ad set -> ad order for the delivery table. Ad sets or ads whose parent is not visible through the API
 * (e.g. a draft parent) are listed at the end at depth 0, so nothing returned by Meta is hidden.
 */
export function deliveryTree(campaigns: AdObject[], adsets: AdObject[], ads: AdObject[]): TreeRow[] {
  const out: TreeRow[] = [];
  const seen = new Set<string>();
  const adsOf = (pred: (a: AdObject) => boolean) => ads.filter(pred).length;
  for (const c of campaigns) {
    out.push({ object: c, depth: 0, childAds: adsOf((a) => a.campaignId === c.id) });
    seen.add(c.id);
    for (const s of adsets.filter((x) => x.campaignId === c.id)) {
      out.push({ object: s, depth: 1, childAds: adsOf((a) => a.adsetId === s.id) });
      seen.add(s.id);
      for (const a of ads.filter((x) => x.adsetId === s.id)) {
        out.push({ object: a, depth: 2, childAds: null });
        seen.add(a.id);
      }
    }
  }
  for (const s of adsets.filter((x) => !seen.has(x.id))) {
    out.push({ object: s, depth: 0, childAds: adsOf((a) => a.adsetId === s.id) });
    seen.add(s.id);
  }
  for (const a of ads.filter((x) => !seen.has(x.id))) out.push({ object: a, depth: 0, childAds: null });
  return out;
}

/** Every date from since to until (YYYY-MM-DD, inclusive). */
export function datesBetween(since: string, until: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${until}T00:00:00Z`);
  for (let t = Date.parse(`${since}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Daily rows indexed by object id then date (date_start). */
export function byIdAndDate(rows: InsightRow[]): Map<string, Map<string, InsightRow>> {
  const m = new Map<string, Map<string, InsightRow>>();
  for (const r of rows) {
    if (!r.dateStart) continue;
    const inner = m.get(r.id) ?? new Map<string, InsightRow>();
    inner.set(r.dateStart, r);
    m.set(r.id, inner);
  }
  return m;
}

/** Labels for Meta statuses that need attention. */
export function statusTone(status: string | null): 'good' | 'warn' | 'bad' | 'neutral' {
  if (!status) return 'neutral';
  if (status === 'ACTIVE') return 'good';
  if (['WITH_ISSUES', 'DISAPPROVED', 'PENDING_BILLING_INFO'].includes(status)) return 'bad';
  if (['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'ARCHIVED', 'DELETED'].includes(status)) return 'neutral';
  return 'warn';
}

/** Meta ad account_status codes (https://developers.facebook.com/docs/marketing-api/reference/ad-account/). */
export const ACCOUNT_STATUS: Record<number, string> = {
  1: 'active',
  2: 'disabled',
  3: 'unsettled',
  7: 'pending risk review',
  8: 'pending settlement',
  9: 'in grace period',
  100: 'pending closure',
  101: 'closed',
  201: 'any active',
  202: 'any closed',
};
