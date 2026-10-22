/**
 * Quote-request (lead) and privacy data-request endpoints (logic; testable).
 * Routes: src/pages/api/leads.ts, src/pages/api/data-requests.ts. Same pattern as subscribe.ts:
 * same-origin check, body size cap, honeypot, timeout, no-store, PostgREST insert with the publishable key
 * (anon has column-level INSERT only). Never logs submitted values.
 */
import { CONSENT_TEXT, CONSENT_VERSION } from '../leads/consent';
import { validateDataRequest, validateLead, type FieldErrors, type LeadInput } from '../leads/validate';
import { isSameOrigin, prefersHtml } from './subscribe';

export const MAX_BODY_BYTES = 8192;
export const SUPABASE_TIMEOUT_MS = 8000;
export const LEADS_THANKS = '/quotes/thanks';
export const DATA_REQUEST_THANKS = '/privacy/request/thanks';

export interface LeadsEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const redirect = (to: string, error: boolean) =>
  new Response(null, { status: 303, headers: { Location: error ? `${to}?error=1` : to, 'Cache-Control': 'no-store' } });

/** Reads a JSON or form body (any fields) up to the size cap; null when unreadable or too big. */
export async function readBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown> | null> {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > maxBytes) return null;
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > maxBytes) return null;
    if (type.includes('application/json')) {
      const v = JSON.parse(text);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    }
    if (type.includes('application/x-www-form-urlencoded')) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of new URLSearchParams(text)) out[k] = v;
      return out;
    }
  } catch {
    return null;
  }
  return null;
}

/** The row inserted into public.leads: the validated lead plus server-side consent and user agent. */
export function leadRow(lead: LeadInput, userAgent: string | null) {
  return { ...lead, consent_text: CONSENT_TEXT, consent_version: CONSENT_VERSION, user_agent: userAgent ? userAgent.slice(0, 300) : null };
}

export function insertRequest(env: { url: string; key: string }, table: 'leads' | 'data_requests', row: object) {
  return {
    url: `${env.url.replace(/\/+$/, '')}/rest/v1/${table}`,
    init: {
      method: 'POST',
      headers: { apikey: env.key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    } satisfies RequestInit,
  };
}

async function insert(env: LeadsEnv, table: 'leads' | 'data_requests', row: object, fetchImpl: typeof fetch): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return false;
  const { url, init } = insertRequest({ url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY }, table, row);
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS) });
    if (res.ok) return true;
    console.error(`${table}: supabase status ${res.status}`);
  } catch (e) {
    console.error(`${table}: supabase request failed`, e instanceof Error ? e.name : 'error');
  }
  return false;
}

type Validated<T> = { kind: 'honeypot' } | { kind: 'invalid'; fieldErrors: Record<string, string | undefined> } | { kind: 'ok'; row: T };

async function handle<T extends object>(
  request: Request,
  env: LeadsEnv,
  fetchImpl: typeof fetch,
  extraAllowedOrigins: readonly string[],
  table: 'leads' | 'data_requests',
  thanks: string,
  validate: (fields: Record<string, unknown>) => Validated<T>,
): Promise<Response> {
  const html = prefersHtml(request);
  if (!isSameOrigin(request, extraAllowedOrigins)) return json(403, { ok: false, error: 'Cross-origin requests are not allowed.' });
  const fields = await readBody(request);
  if (!fields) return html ? redirect(thanks, true) : json(400, { ok: false, fieldErrors: { form: 'Could not read the form. Please try again.' } });
  const v = validate(fields);
  // Bots get the same answer as people, so the honeypot is not revealed.
  if (v.kind === 'honeypot') return html ? redirect(thanks, false) : json(200, { ok: true });
  if (v.kind === 'invalid') return html ? redirect(thanks, true) : json(400, { ok: false, fieldErrors: v.fieldErrors });
  if (await insert(env, table, v.row, fetchImpl)) return html ? redirect(thanks, false) : json(200, { ok: true });
  return html ? redirect(thanks, true) : json(502, { ok: false, error: 'Something went wrong — please try again.' });
}

/**
 * POST /api/leads. JSON: 200 {ok:true} | 400 {ok:false, fieldErrors} | 403 | 502 {ok:false, error}.
 * Plain form posts (Accept prefers text/html): 303 -> /quotes/thanks (or ?error=1).
 */
export function handleLead(request: Request, env: LeadsEnv, fetchImpl: typeof fetch = fetch, extraAllowedOrigins: readonly string[] = []) {
  const ua = request.headers.get('user-agent');
  return handle(request, env, fetchImpl, extraAllowedOrigins, 'leads', LEADS_THANKS, (f) => {
    const v = validateLead(f);
    return v.kind === 'ok' ? { kind: 'ok', row: leadRow(v.lead, ua) } : (v as { kind: 'honeypot' } | { kind: 'invalid'; fieldErrors: FieldErrors });
  });
}

/** POST /api/data-requests: same contract; form posts 303 -> /privacy/request/thanks (or ?error=1). */
export function handleDataRequest(request: Request, env: LeadsEnv, fetchImpl: typeof fetch = fetch, extraAllowedOrigins: readonly string[] = []) {
  return handle(request, env, fetchImpl, extraAllowedOrigins, 'data_requests', DATA_REQUEST_THANKS, (f) => {
    const v = validateDataRequest(f);
    return v.kind === 'ok' ? { kind: 'ok', row: v.value } : v;
  });
}
