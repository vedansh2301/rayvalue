/**
 * First-touch attribution for leads: UTMs, click IDs, landing page and referrer, captured on the first page view of a
 * browser session, kept in sessionStorage (never cookies; gone when the tab closes), and attached to a quote request on
 * submit. Pure parsing/sanitizing here; the storage wrapper is the only browser-touching code and is fail-safe.
 */
export const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'landing_page', 'referrer'] as const;
export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];
export type Attribution = Partial<Record<AttributionKey, string>>;

export const STORAGE_KEY = 'rv_attribution';
const MAX_LEN = 200;
const URL_MAX_LEN = 300;

/** Printable ASCII/Latin text only, trimmed and capped; control chars and markup-ish characters removed. */
const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f\u007f<>"'`\\]/g, '').trim().slice(0, max);
  return s ? s : undefined;
};

/** Server- and client-side sanitizer: keeps only the known keys, as short clean strings. */
export function sanitizeAttribution(raw: unknown): Attribution {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Attribution = {};
  for (const k of ATTRIBUTION_KEYS) {
    const v = clean(o[k], k === 'landing_page' || k === 'referrer' ? URL_MAX_LEN : MAX_LEN);
    if (v) out[k] = v;
  }
  return out;
}

/** origin + path of a URL (no query, no hash), or undefined when unparseable. */
function originAndPath(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? `${u.origin}${u.pathname}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What to remember about the first page view. `search` is location.search, `pageUrl` the current URL, `referrer`
 * document.referrer. The landing page and referrer drop their query strings (they can carry a ZIP or a bill); a
 * referrer from our own site is not recorded.
 */
export function parseAttribution(search: string, pageUrl: string, referrer: string): Attribution {
  const q = new URLSearchParams(search);
  const raw: Record<string, unknown> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const) raw[k] = q.get(k) ?? undefined;
  raw.landing_page = originAndPath(pageUrl);
  const ref = referrer ? originAndPath(referrer) : undefined;
  let own = false;
  try {
    own = !!ref && new URL(ref).origin === new URL(pageUrl).origin;
  } catch {
    own = false;
  }
  raw.referrer = own ? undefined : ref;
  return sanitizeAttribution(raw);
}

/** Capture on the first page view of the session; later pages never overwrite it. Safe when storage is blocked. */
export function captureAttribution(w: Pick<Window, 'location' | 'document' | 'sessionStorage'> = window): void {
  try {
    if (w.sessionStorage.getItem(STORAGE_KEY)) return;
    w.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parseAttribution(w.location.search, w.location.href, w.document.referrer)));
  } catch {
    /* storage unavailable: leads simply carry no attribution */
  }
}

/** The stored attribution for attaching to a submit (empty object when none). */
export function readAttribution(w: Pick<Window, 'sessionStorage'> = window): Attribution {
  try {
    const raw = w.sessionStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeAttribution(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}
