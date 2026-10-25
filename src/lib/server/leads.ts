/**
 * Quote-request (lead) and privacy data-request endpoints (logic; testable).
 * Routes: src/pages/api/leads.ts, src/pages/api/data-requests.ts.
 *
 * Leads are written with the server-only SUPABASE_SECRET_KEY (anon has no INSERT on public.leads since migration
 * 0006), because the server alone decides status, consent text, installer list, consent IP, and verification
 * state. The consent text is recomputed here from the installers the database says serve the ZIP; text sent by
 * the client is ignored. Never logs submitted values.
 */
import { consentFor } from '../leads/consent';
import { leadStatus } from '../leads/status';
import { validateDataRequest, validateLead, type FieldErrors } from '../leads/validate';
import { adminInsert, type AdminEnv } from './admin-db';
import { clientIp, cleanPageUrl, json, readBody, MAX_BODY_BYTES } from './http';
import { lookupInstallers, type InstallersEnv } from './installers';
import { isSameOrigin, prefersHtml } from './subscribe';
import { signLeadToken, verificationEnabled, type VerifyEnv } from './verify';

export { readBody, MAX_BODY_BYTES };
export const SUPABASE_TIMEOUT_MS = 8000;
export const LEADS_THANKS = '/quotes/thank-you';
export const DATA_REQUEST_THANKS = '/privacy/request/thanks';

export interface LeadsEnv extends InstallersEnv, AdminEnv, VerifyEnv {}

const redirect = (to: string, error: boolean) =>
  new Response(null, { status: 303, headers: { Location: error ? `${to}?error=1` : to, 'Cache-Control': 'no-store' } });

/** A TrustedForm certificate URL as TrustedForm issues it; anything else is dropped. */
export const TRUSTEDFORM_RE = /^https:\/\/cert\.trustedform\.com\/[0-9a-f]{20,64}$/i;
export const cleanCertUrl = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().split('?')[0]!;
  return TRUSTEDFORM_RE.test(s) ? s : null;
};

function installerList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n): n is string => typeof n === 'string').map((n) => n.trim()).filter(Boolean);
}
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * POST /api/leads (JSON).
 *  200 { ok:true, disqualified:'renter' }              renter: nothing stored
 *  200 { ok:true, status, serviced, installers, lead_id, verify: { token } | null }
 *  400 { ok:false, fieldErrors }   409 { ok:false, consent_changed:true, installers }   403 / 502
 * Plain form posts (Accept prefers text/html) are redirected to the thank-you page (the multi-step form needs
 * JavaScript, so this only serves odd clients).
 */
export async function handleLead(
  request: Request,
  env: LeadsEnv,
  fetchImpl: typeof fetch = fetch,
  extraAllowedOrigins: readonly string[] = [],
  nowMs: number = Date.now(),
): Promise<Response> {
  const html = prefersHtml(request);
  if (!isSameOrigin(request, extraAllowedOrigins)) return json(403, { ok: false, error: 'Cross-origin requests are not allowed.' });
  const fields = await readBody(request);
  if (!fields) return html ? redirect(LEADS_THANKS, true) : json(400, { ok: false, fieldErrors: { form: 'Could not read the form. Please try again.' } });

  const v = validateLead(fields);
  // Bots get the same answer as people, so the honeypot is not revealed.
  if (v.kind === 'honeypot') return html ? redirect(LEADS_THANKS, false) : json(200, { ok: true });
  if (v.kind === 'disqualified') return json(200, { ok: true, disqualified: v.reason });
  if (v.kind === 'invalid') return html ? redirect(LEADS_THANKS, true) : json(400, { ok: false, fieldErrors: v.fieldErrors satisfies FieldErrors });
  const lead = v.lead;

  const installers = await lookupInstallers(env, lead.zip, lead.state, fetchImpl);
  if (!installers) return json(502, { ok: false, error: 'Something went wrong — please try again.' });
  // The person must have seen the wording that will be stored: if the installer list changed since the form showed
  // it, ask them to review the new wording instead of silently storing different text.
  if (!sameList(installerList(fields.consent_installers), installers)) return json(409, { ok: false, consent_changed: true, installers });

  const consent = consentFor(installers);
  const serviced = installers.length > 0;
  const status = leadStatus({ serviced, timeline: lead.timeline });
  const origins = [new URL(request.url).origin, ...extraAllowedOrigins];
  const row = {
    ...lead,
    status,
    consent_text: consent.text,
    consent_version: consent.version,
    consented_installers: consent.installers,
    consent_ip: clientIp(request),
    consent_page_url: cleanPageUrl(fields.page_url, origins) ?? cleanPageUrl(request.headers.get('referer'), origins),
    trustedform_cert_url: cleanCertUrl(fields.trustedform_cert_url),
    user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
    phone_verified: false,
  };

  let res = await adminInsert<{ id: string }>(env, 'leads', row, fetchImpl);
  // An unknown utility_id (e.g. a renamed utility) must not lose the lead: keep it without the utility.
  if (res && 'conflict' in res && res.conflict.code === '23503' && row.utility_id !== null) res = await adminInsert<{ id: string }>(env, 'leads', { ...row, utility_id: null }, fetchImpl);
  if (!res || 'conflict' in res) return html ? redirect(LEADS_THANKS, true) : json(502, { ok: false, error: 'Something went wrong — please try again.' });

  const leadId = res.row.id;
  const verify = verificationEnabled(env) ? { token: signLeadToken(env.LEAD_SIGNING_SECRET!, leadId, nowMs) } : null;
  return html ? redirect(LEADS_THANKS, false) : json(200, { ok: true, status, serviced, installers, lead_id: leadId, verify });
}

/** POST /api/data-requests: JSON 200/400/502; form posts 303 -> /privacy/request/thanks (or ?error=1). Anon key (insert-only). */
export async function handleDataRequest(request: Request, env: LeadsEnv, fetchImpl: typeof fetch = fetch, extraAllowedOrigins: readonly string[] = []): Promise<Response> {
  const html = prefersHtml(request);
  if (!isSameOrigin(request, extraAllowedOrigins)) return json(403, { ok: false, error: 'Cross-origin requests are not allowed.' });
  const fields = await readBody(request);
  if (!fields) return html ? redirect(DATA_REQUEST_THANKS, true) : json(400, { ok: false, fieldErrors: { form: 'Could not read the form. Please try again.' } });
  const v = validateDataRequest(fields);
  if (v.kind === 'honeypot') return html ? redirect(DATA_REQUEST_THANKS, false) : json(200, { ok: true });
  if (v.kind === 'invalid') return html ? redirect(DATA_REQUEST_THANKS, true) : json(400, { ok: false, fieldErrors: v.fieldErrors });
  if (await insertAnon(env, 'data_requests', v.value, fetchImpl)) return html ? redirect(DATA_REQUEST_THANKS, false) : json(200, { ok: true });
  return html ? redirect(DATA_REQUEST_THANKS, true) : json(502, { ok: false, error: 'Something went wrong — please try again.' });
}

export function insertRequest(env: { url: string; key: string }, table: 'data_requests', row: object) {
  return {
    url: `${env.url.replace(/\/+$/, '')}/rest/v1/${table}`,
    init: {
      method: 'POST',
      headers: { apikey: env.key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    } satisfies RequestInit,
  };
}

async function insertAnon(env: LeadsEnv, table: 'data_requests', row: object, fetchImpl: typeof fetch): Promise<boolean> {
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
