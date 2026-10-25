/**
 * Phone verification with Twilio Verify (SMS one-time codes). Optional: enabled only when TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID and LEAD_SIGNING_SECRET are all set; otherwise the quote form skips
 * the step. The verified flag is written here, server-side, after Twilio approves a code for the phone number stored
 * with the lead. The client never sends the phone number again and cannot set the flag.
 *
 * Limits: at most 3 codes sent per lead, 30 s between sends, at most 3 code checks per lead.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { adminSelect, adminUpdate, type AdminEnv } from './admin-db';
import { isSameOrigin } from './subscribe';
import { MAX_CHECKS, MAX_SENDS, RESEND_AFTER_SECONDS } from '../leads/verify-limits';
import { json, readBody } from './http';

export interface VerifyEnv extends AdminEnv {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;
  /** Random server secret that signs the short-lived token proving a browser just created this lead. */
  LEAD_SIGNING_SECRET?: string;
}

export { MAX_CHECKS, MAX_SENDS, RESEND_AFTER_SECONDS };
export const TOKEN_TTL_SECONDS = 30 * 60;

export const verificationEnabled = (env: VerifyEnv): boolean =>
  !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID && env.LEAD_SIGNING_SECRET && env.SUPABASE_SECRET_KEY && env.SUPABASE_URL);

const sign = (secret: string, leadId: string, exp: number) => createHmac('sha256', secret).update(`${leadId}.${exp}`).digest('hex');

/** A token tying a browser to one lead for 30 minutes: "<expiry seconds>.<hmac>". */
export function signLeadToken(secret: string, leadId: string, nowMs: number): string {
  const exp = Math.floor(nowMs / 1000) + TOKEN_TTL_SECONDS;
  return `${exp}.${sign(secret, leadId, exp)}`;
}

export function checkLeadToken(secret: string, leadId: string, token: unknown, nowMs: number): boolean {
  if (typeof token !== 'string') return false;
  const m = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp * 1000 < nowMs) return false;
  const a = Buffer.from(m[2]!, 'hex');
  const b = Buffer.from(sign(secret, leadId, exp), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const twilioBase = (sid: string) => `https://verify.twilio.com/v2/Services/${encodeURIComponent(sid)}`;
const twilioAuth = (env: VerifyEnv) => `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;

async function twilioPost(env: VerifyEnv, path: 'Verifications' | 'VerificationCheck', form: Record<string, string>, fetchImpl: typeof fetch): Promise<{ status?: string } | null> {
  try {
    const res = await fetchImpl(`${twilioBase(env.TWILIO_VERIFY_SERVICE_SID!)}/${path}`, {
      method: 'POST',
      headers: { Authorization: twilioAuth(env), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(8000),
    });
    // Twilio answers 404 for a check on an expired/finished verification: that is "not approved", not an outage.
    if (res.status === 404 && path === 'VerificationCheck') return { status: 'expired' };
    if (!res.ok) {
      console.error(`twilio verify ${path}: status ${res.status}`);
      return null;
    }
    return (await res.json().catch(() => null)) as { status?: string } | null;
  } catch (e) {
    console.error(`twilio verify ${path}: request failed`, e instanceof Error ? e.name : 'error');
    return null;
  }
}

interface LeadVerifyRow {
  id: string;
  phone: string;
  phone_verified: boolean;
  verify_sends: number;
  verify_checks: number;
  verify_last_sent_at: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/leads/verify  { lead_id, token, action: 'send' | 'check', code? }
 * -> 200 { ok:true, sent:true, retry_after } | { ok:true, verified:boolean, attempts_left } | 4xx/5xx { ok:false, error, retry_after? }
 */
export async function handleVerify(request: Request, env: VerifyEnv, fetchImpl: typeof fetch = fetch, extraAllowedOrigins: readonly string[] = [], nowMs: number = Date.now()): Promise<Response> {
  if (!isSameOrigin(request, extraAllowedOrigins)) return json(403, { ok: false, error: 'Cross-origin requests are not allowed.' });
  if (!verificationEnabled(env)) return json(503, { ok: false, error: 'Phone verification is not available.' });
  const body = await readBody(request, 2048);
  if (!body) return json(400, { ok: false, error: 'Could not read the request.' });
  const leadId = typeof body.lead_id === 'string' ? body.lead_id : '';
  if (!UUID_RE.test(leadId) || !checkLeadToken(env.LEAD_SIGNING_SECRET!, leadId, body.token, nowMs)) return json(403, { ok: false, error: 'This verification link expired. You can skip this step.' });
  const action = body.action;
  if (action !== 'send' && action !== 'check') return json(400, { ok: false, error: 'Unknown action.' });

  const rows = await adminSelect<LeadVerifyRow>(env, 'leads', { id: `eq.${leadId}`, select: 'id,phone,phone_verified,verify_sends,verify_checks,verify_last_sent_at' }, fetchImpl);
  const lead = rows?.[0];
  if (!lead) return json(rows ? 404 : 502, { ok: false, error: 'Something went wrong — please try again.' });
  if (lead.phone_verified) return json(200, { ok: true, verified: true, attempts_left: 0 });

  if (action === 'send') {
    if (lead.verify_sends >= MAX_SENDS) return json(429, { ok: false, error: 'Too many codes sent. You can skip this step.' });
    const last = lead.verify_last_sent_at ? Date.parse(lead.verify_last_sent_at) : 0;
    const wait = Math.ceil((last + RESEND_AFTER_SECONDS * 1000 - nowMs) / 1000);
    if (last && wait > 0) return json(429, { ok: false, error: `Please wait ${wait} seconds before asking for another code.`, retry_after: wait });
    // Count the send first (compare-and-set on the previous count, so two parallel requests cannot both pass).
    const claimed = await adminUpdate(env, 'leads', { id: `eq.${leadId}`, verify_sends: `eq.${lead.verify_sends}` }, { verify_sends: lead.verify_sends + 1, verify_last_sent_at: new Date(nowMs).toISOString() }, fetchImpl);
    if (claimed === 0) return json(429, { ok: false, error: 'Please wait a moment and try again.', retry_after: RESEND_AFTER_SECONDS });
    if (claimed === null) return json(502, { ok: false, error: 'Something went wrong — please try again.' });
    const r = await twilioPost(env, 'Verifications', { To: lead.phone, Channel: 'sms' }, fetchImpl);
    if (!r) return json(502, { ok: false, error: 'We could not send the code. You can skip this step.' });
    return json(200, { ok: true, sent: true, retry_after: RESEND_AFTER_SECONDS, sends_left: MAX_SENDS - (lead.verify_sends + 1) });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!/^\d{4,10}$/.test(code)) return json(400, { ok: false, error: 'Enter the code from the text message.' });
  if (lead.verify_checks >= MAX_CHECKS) return json(429, { ok: false, error: 'Too many attempts. You can skip this step.' });
  const claimed = await adminUpdate(env, 'leads', { id: `eq.${leadId}`, verify_checks: `eq.${lead.verify_checks}` }, { verify_checks: lead.verify_checks + 1 }, fetchImpl);
  if (claimed === 0) return json(429, { ok: false, error: 'Please wait a moment and try again.' });
  if (claimed === null) return json(502, { ok: false, error: 'Something went wrong — please try again.' });
  const r = await twilioPost(env, 'VerificationCheck', { To: lead.phone, Code: code }, fetchImpl);
  if (!r) return json(502, { ok: false, error: 'We could not check the code. You can skip this step.' });
  const attemptsLeft = MAX_CHECKS - (lead.verify_checks + 1);
  if (r.status !== 'approved') return json(200, { ok: true, verified: false, attempts_left: attemptsLeft });
  // Only here, after Twilio approved a code for the phone stored with this lead, is the flag set.
  const done = await adminUpdate(env, 'leads', { id: `eq.${leadId}` }, { phone_verified: true }, fetchImpl);
  if (!done) return json(502, { ok: false, error: 'Something went wrong — please try again.' });
  return json(200, { ok: true, verified: true, attempts_left: attemptsLeft });
}
