/**
 * GET /go/out/<slug>: log one click, then 302 to the merchant. Cookieless: no Set-Cookie, no IP, no user-agent string
 * stored (only a coarse device class), no personal data. The log write uses the service-role key, server side only.
 * Never blocks the visitor: if the log write fails the redirect still happens; if the offer is not live the visitor
 * goes to the home page.
 */
import { selectRows, siteDbEnv } from '../db/client';
import { adminInsertMany, type AdminEnv } from './admin-db';
import { AffiliateOfferRowSchema, OFFER_SELECT, classifyUa, cleanCountry, cleanPagePath, isLive, resolveDestination } from '../offers/offers';

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
} as const;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function handleOut(
  request: Request,
  slug: string,
  env: AdminEnv,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
  readEnv = siteDbEnv(),
): Promise<Response> {
  const home = new Response(null, { status: 302, headers: { ...HEADERS, Location: '/' } });
  if (!SLUG.test(slug) || slug.length > 60) return new Response('Not found', { status: 404, headers: HEADERS });

  const r = await selectRows<unknown>(readEnv, 'offers', { select: OFFER_SELECT, kind: 'eq.affiliate', slug: `eq.${slug}`, limit: '1' }, fetchImpl);
  const parsed = r.ok && r.value[0] ? AffiliateOfferRowSchema.safeParse(r.value[0]) : null;
  if (!parsed?.success || !isLive(parsed.data, now)) return home;
  const offer = parsed.data;

  const url = new URL(request.url);
  let page = cleanPagePath(url.searchParams.get('p'));
  if (!page) {
    const ref = request.headers.get('referer');
    try {
      if (ref && new URL(ref).origin === url.origin) page = cleanPagePath(new URL(ref).pathname);
    } catch {
      /* ignore a malformed Referer */
    }
  }

  const dest = resolveDestination(offer.destination_url_template, offer.slug, page);
  if (!dest) return home;

  // HEAD (link checkers, previews) is forwarded but not counted.
  if (request.method === 'GET') {
    await adminInsertMany(
      env,
      'affiliate_clicks',
      [{ offer_id: offer.id, page_path: page, country: cleanCountry(request.headers.get('x-vercel-ip-country')), ua_class: classifyUa(request.headers.get('user-agent')) }],
      fetchImpl,
    );
  }
  return new Response(null, { status: 302, headers: { ...HEADERS, Location: dest } });
}
