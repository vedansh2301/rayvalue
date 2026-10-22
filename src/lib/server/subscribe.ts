/** Rate-alert signup logic (pure, testable). Endpoint: src/pages/api/subscribe.ts. */

export const STATES = ['FL', 'CA'] as const;
export type SignupState = (typeof STATES)[number];
export const MAX_BODY_BYTES = 4096;
export const SUPABASE_TIMEOUT_MS = 8000;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export interface SubscribeFields {
  email?: unknown;
  state?: unknown;
  website?: unknown;
}

export type Validation =
  | { kind: 'honeypot' }
  | { kind: 'invalid'; error: string }
  | { kind: 'ok'; email: string; state: SignupState };

export function validateSignup(f: SubscribeFields): Validation {
  if (typeof f.website === 'string' && f.website.trim() !== '') return { kind: 'honeypot' };
  const email = typeof f.email === 'string' ? f.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { kind: 'invalid', error: 'Please enter a valid email address.' };
  const state = typeof f.state === 'string' ? f.state.trim().toUpperCase() : '';
  if (!(STATES as readonly string[]).includes(state)) return { kind: 'invalid', error: 'State must be FL or CA.' };
  return { kind: 'ok', email, state: state as SignupState };
}

/** True when the browser says (or the Origin header shows) the POST came from our own site. */
export function isSameOrigin(request: Request, extraAllowed: readonly string[] = []): boolean {
  const own = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin) return origin === own || extraAllowed.includes(origin);
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const o = new URL(referer).origin;
      return o === own || extraAllowed.includes(o);
    } catch {
      return false;
    }
  }
  return true; // non-browser client (curl, server-to-server): no ambient credentials to abuse, no cookies exist anyway
}

export function prefersHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  const h = accept.indexOf('text/html');
  if (h === -1) return false;
  const j = accept.indexOf('application/json');
  return j === -1 || h < j;
}

export function supabaseInsertRequest(env: { url: string; key: string }, email: string, state: SignupState) {
  return {
    url: `${env.url.replace(/\/+$/, '')}/rest/v1/rate_alert_subscribers`,
    init: {
      method: 'POST',
      headers: { apikey: env.key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ email, state, source: `calculator-${state.toLowerCase()}` }),
    } satisfies RequestInit,
  };
}

const THANKS = '/alerts/thanks';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const redirect = (error: boolean) =>
  new Response(null, { status: 303, headers: { Location: error ? `${THANKS}?error=1` : THANKS, 'Cache-Control': 'no-store' } });

async function readFields(request: Request): Promise<SubscribeFields | null> {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BODY_BYTES) return null;
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  try {
    if (type.includes('application/json')) {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return null;
      const v = JSON.parse(text);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    }
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      const fd = await request.formData();
      return { email: fd.get('email') ?? undefined, state: fd.get('state') ?? undefined, website: fd.get('website') ?? undefined };
    }
  } catch {
    return null;
  }
  return null;
}

export interface SubscribeEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}

/**
 * POST handler. Success JSON: 200 { ok: true }. Errors: { ok: false, error }.
 * Plain form posts (Accept prefers text/html) get 303 -> /alerts/thanks (or ?error=1).
 */
export async function handleSubscribe(
  request: Request,
  env: SubscribeEnv,
  fetchImpl: typeof fetch = fetch,
  extraAllowedOrigins: readonly string[] = [],
): Promise<Response> {
  const html = prefersHtml(request);
  const fail = (status: number, error: string) => (html ? redirect(true) : json(status, { ok: false, error }));

  if (!isSameOrigin(request, extraAllowedOrigins)) return json(403, { ok: false, error: 'Cross-origin requests are not allowed.' });

  const fields = await readFields(request);
  if (!fields) return fail(400, 'Could not read the request body.');
  const v = validateSignup(fields);
  if (v.kind === 'honeypot') return html ? redirect(false) : json(200, { ok: true });
  if (v.kind === 'invalid') return fail(400, v.error);

  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return fail(503, 'Email alerts are temporarily unavailable. Please try again later.');
  }
  const { url, init } = supabaseInsertRequest({ url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY }, v.email, v.state);
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS) });
    // 201 = new; 409 (Postgres 23505 unique violation) = already subscribed: same answer, never reveal which.
    if (res.ok || res.status === 409) return html ? redirect(false) : json(200, { ok: true });
    console.error(`subscribe: supabase status ${res.status}`);
  } catch (e) {
    console.error('subscribe: supabase request failed', e instanceof Error ? e.name : 'error');
  }
  return fail(502, 'We could not save your signup. Please try again later.');
}
