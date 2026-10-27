/**
 * Vercel Web Analytics `beforeSend`: drop the query string and fragment from every event URL, except the standard
 * UTM campaign tags. Shared calculator links carry the ZIP code and bill in the query, which must not reach analytics;
 * UTMs on inbound ad/social links (e.g. ?utm_source=meta&utm_campaign=fl_reel) are kept so visits can be attributed.
 * Internal links never carry UTMs (SEO: one clean URL per page; canonicals already drop the query).
 */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/** Short token-shaped values only: no '@', spaces or long digit runs, so personal data cannot ride along in a UTM. */
const UTM_VALUE_RE = /^[A-Za-z0-9_.-]{1,60}$/;
const LONG_DIGITS_RE = /\d{5,}/;

/** URL without query or fragment, plus any valid UTM tags (in canonical order). Everything else is dropped. */
export function keepUtmOnly(url: string): string {
  const base = stripQuery(url);
  const qStart = url.indexOf('?');
  if (qStart === -1) return base;
  const hash = url.indexOf('#', qStart);
  const q = new URLSearchParams(url.slice(qStart + 1, hash === -1 ? undefined : hash));
  const kept = new URLSearchParams();
  for (const k of UTM_KEYS) {
    const v = q.get(k);
    if (v && UTM_VALUE_RE.test(v) && !LONG_DIGITS_RE.test(v)) kept.set(k, v);
  }
  const s = kept.toString();
  return s ? `${base}?${s}` : base;
}

export interface AnalyticsEvent {
  type: string;
  url: string;
  [k: string]: unknown;
}

export const beforeSend = <E extends AnalyticsEvent>(event: E): E => ({ ...event, url: keepUtmOnly(event.url) });
