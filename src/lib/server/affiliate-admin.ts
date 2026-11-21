/** Affiliate click report data for /admin/kpi (server only; SUPABASE_SECRET_KEY). Read-only. */
import { adminSelectAll, type AdminEnv } from './admin-db';
import { summariseClicks, type ClickRow, type OfferClickSummary, type PageClickSummary } from '../offers/offers';

export interface AffiliateReport {
  byOffer: OfferClickSummary[];
  byPage: PageClickSummary[];
  /** Offer id -> active flag, for the "turned on?" column. */
  active: Record<string, boolean>;
}

/** Clicks since `from` (YYYY-MM-DD). null when the tables cannot be read (e.g. migration 0032 not applied). */
export async function loadAffiliateReport(env: AdminEnv, from: string, fetchImpl: typeof fetch = fetch): Promise<AffiliateReport | null> {
  const [offers, clicks] = await Promise.all([
    adminSelectAll<{ id: string; slug: string; brand: string; active: boolean }>(env, 'offers', { select: 'id,slug,brand,active', kind: 'eq.affiliate' }, fetchImpl),
    adminSelectAll<ClickRow>(env, 'affiliate_clicks', { select: 'offer_id,page_path,ua_class,clicked_at', clicked_at: `gte.${from}T00:00:00Z`, order: 'clicked_at.asc' }, fetchImpl),
  ]);
  if (!offers || !clicks) return null;
  return { ...summariseClicks(offers, clicks), active: Object.fromEntries(offers.map((o) => [o.id, o.active])) };
}
