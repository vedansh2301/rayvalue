/** Loads affiliate offers (anon key, read-only; RLS allows SELECT on offers). Build-time on static pages; failures mean "no offers". */
import { selectRows, siteDbEnv } from '../db/client';
import { AffiliateOfferRowSchema, OFFER_SELECT, livePublicOffers, type AffiliateOfferRow, type OfferCategory, type PublicOffer } from './offers';
import { placementFor, type PlacementContext } from './placement';

/** Active affiliate rows, validated. A row that fails validation is skipped (fail closed: never shown). */
export async function loadAffiliateRows(fetchImpl: typeof fetch = fetch): Promise<AffiliateOfferRow[]> {
  const r = await selectRows<unknown>(siteDbEnv(), 'offers', { select: OFFER_SELECT, kind: 'eq.affiliate', active: 'is.true' }, fetchImpl);
  if (!r.ok) {
    console.error(`affiliate offers: none shown (${r.error.kind}): ${r.error.message}`);
    return [];
  }
  const out: AffiliateOfferRow[] = [];
  for (const row of r.value) {
    const p = AffiliateOfferRowSchema.safeParse(row);
    if (p.success) out.push(p.data);
    else console.error('affiliate offers: row skipped (invalid)');
  }
  return out;
}

export function pickOffers(rows: readonly AffiliateOfferRow[], categories: readonly OfferCategory[], max: number, now: Date, country = 'us'): PublicOffer[] {
  // Offers with a country only show on that country's pages; an offer with no country is global.
  return livePublicOffers(rows, now, { categories, country: country.toUpperCase() }).slice(0, max);
}

/** The single entry point pages use: offers to show for this page context (empty array = render nothing). */
export async function offersForPage(ctx: PlacementContext, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<PublicOffer[]> {
  const place = placementFor(ctx);
  if (!place.show) return [];
  return pickOffers(await loadAffiliateRows(fetchImpl), place.categories, place.max, now, ctx.country ?? 'us');
}
