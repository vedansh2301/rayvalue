/**
 * Affiliate offers: row shape, "is it live" rule, redirect destination, click-log helpers.
 * Pure functions, no I/O. Offers never touch calculator numbers (CLAUDE.md rule 4 and the 50/30/20 stance).
 * The affiliate ID lives only inside destination_url_template in the offers table; the page never sees it.
 */
import { z } from 'zod';

export const OFFER_CATEGORIES = ['battery', 'portable_power', 'solar_marketplace', 'other'] as const;
export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

/** Row as read from public.offers for kind = 'affiliate' (only the columns the site uses). */
export const AffiliateOfferRowSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  brand: z.string().min(1),
  program: z.string().nullable(),
  network: z.string().nullable(),
  country: z.string().regex(/^[A-Z]{2}$/).nullable(),
  category: z.enum(OFFER_CATEGORIES).nullable(),
  destination_url_template: z.string().startsWith('https://').nullable(),
  cta_text: z.string().min(1),
  headline: z.string().nullable(),
  description: z.string().nullable(),
  price_text: z.string().nullable(),
  price_source_url: z.string().nullable(),
  price_verified_on: z.string().nullable(),
  disclosure_key: z.string().min(1),
  active: z.boolean(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
});
export type AffiliateOfferRow = z.infer<typeof AffiliateOfferRowSchema>;

export const OFFER_SELECT =
  'id,slug,brand,program,network,country,category,destination_url_template,cta_text,headline,description,price_text,price_source_url,price_verified_on,disclosure_key,active,starts_at,ends_at';

/** What a page component may know about an offer: display text only. No destination, no affiliate ID. */
export interface PublicOffer {
  slug: string;
  brand: string;
  category: OfferCategory | null;
  ctaText: string;
  headline: string | null;
  description: string | null;
  /** Only set when the row carries a source and check date (also enforced by a DB constraint). */
  priceText: string | null;
  disclosureKey: string;
}

const ms = (iso: string | null): number | null => {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
};

/** Active, has a destination, and inside its starts/ends window. An unparseable date fails closed. */
export function isLive(o: AffiliateOfferRow, now: Date): boolean {
  if (!o.active || !o.destination_url_template) return false;
  const start = ms(o.starts_at);
  const end = ms(o.ends_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  if (start !== null && now.getTime() < start) return false;
  if (end !== null && now.getTime() >= end) return false;
  return true;
}

export function toPublicOffer(o: AffiliateOfferRow): PublicOffer {
  const priceOk = o.price_text !== null && o.price_text.trim() !== '' && o.price_source_url !== null && o.price_verified_on !== null;
  return {
    slug: o.slug,
    brand: o.brand,
    category: o.category,
    ctaText: o.cta_text,
    headline: o.headline?.trim() || null,
    description: o.description?.trim() || null,
    priceText: priceOk ? (o.price_text as string).trim() : null,
    disclosureKey: o.disclosure_key,
  };
}

/** Live offers (optionally one country and some categories) as public shapes, in a stable order. */
export function livePublicOffers(rows: readonly AffiliateOfferRow[], now: Date, opts: { categories?: readonly OfferCategory[]; country?: string } = {}): PublicOffer[] {
  return rows
    .filter((r) => isLive(r, now))
    .filter((r) => !opts.categories || (r.category !== null && opts.categories.includes(r.category)))
    .filter((r) => !opts.country || r.country === null || r.country === opts.country)
    .sort((a, b) => a.brand.localeCompare(b.brand))
    .map(toPublicOffer);
}

// ------------------------------------------------------------------ paths and redirect

/** A page path from `?p=` (or a same-origin Referer): "/..." only, no query/hash, safe characters, <= 200 chars. Else null. */
export function cleanPagePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const path = raw.split(/[?#]/)[0] ?? '';
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 200) return null;
  return /^[A-Za-z0-9/_\-.~%]+$/.test(path) ? path : null;
}

/** The link href for an offer on a page. Plain internal URL; the redirect route logs and forwards. */
export const outHref = (slug: string, pagePath: string): string => {
  const p = cleanPagePath(pagePath);
  return `/go/out/${slug}${p ? `?p=${encodeURIComponent(p)}` : ''}`;
};

/** Fills {slug} and {page} in the template. Null unless the result is a clean https URL with no placeholder left. */
export function resolveDestination(template: string | null, slug: string, pagePath: string | null): string | null {
  if (!template) return null;
  const filled = template.replaceAll('{slug}', encodeURIComponent(slug)).replaceAll('{page}', encodeURIComponent(pagePath ?? ''));
  if (/[{}]/.test(filled)) return null;
  try {
    const u = new URL(filled);
    return u.protocol === 'https:' && u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ click log

export type UaClass = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'other';

/** Coarse device class from the User-Agent. The string itself is never stored. */
export function classifyUa(ua: string | null | undefined): UaClass {
  if (!ua) return 'other';
  if (/bot|crawl|spider|slurp|preview|facebookexternalhit|headless|curl|wget|python-requests|go-http-client/i.test(ua)) return 'bot';
  if (/ipad|tablet|kindle|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(ua)) return 'mobile';
  if (/windows|macintosh|x11|linux|cros/i.test(ua)) return 'desktop';
  return 'other';
}

/** Two-letter country code from the host's geo header, or null. */
export const cleanCountry = (raw: string | null | undefined): string | null => (raw && /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null);

export interface ClickRow {
  offer_id: string;
  page_path: string | null;
  ua_class: UaClass;
  clicked_at: string;
}

export interface OfferClickSummary {
  offerId: string;
  slug: string;
  brand: string;
  clicks: number;
  botClicks: number;
}
export interface PageClickSummary {
  offerId: string;
  slug: string;
  page: string;
  clicks: number;
}

/** Human clicks (bots excluded) per offer and per offer+page, most clicks first. Offers with no clicks still listed. */
export function summariseClicks(
  offers: readonly { id: string; slug: string; brand: string }[],
  clicks: readonly ClickRow[],
): { byOffer: OfferClickSummary[]; byPage: PageClickSummary[] } {
  const byId = new Map(offers.map((o) => [o.id, o]));
  const offerAgg = new Map<string, OfferClickSummary>(offers.map((o) => [o.id, { offerId: o.id, slug: o.slug, brand: o.brand, clicks: 0, botClicks: 0 }]));
  const pageAgg = new Map<string, PageClickSummary>();
  for (const c of clicks) {
    const o = byId.get(c.offer_id);
    const a = offerAgg.get(c.offer_id);
    if (!o || !a) continue;
    if (c.ua_class === 'bot') {
      a.botClicks += 1;
      continue;
    }
    a.clicks += 1;
    const page = c.page_path ?? '(unknown)';
    const key = `${c.offer_id}\n${page}`;
    const p = pageAgg.get(key) ?? { offerId: o.id, slug: o.slug, page, clicks: 0 };
    p.clicks += 1;
    pageAgg.set(key, p);
  }
  const byOffer = [...offerAgg.values()].sort((x, y) => y.clicks - x.clicks || x.slug.localeCompare(y.slug));
  const byPage = [...pageAgg.values()].sort((x, y) => y.clicks - x.clicks || x.slug.localeCompare(y.slug) || x.page.localeCompare(y.page));
  return { byOffer, byPage };
}
