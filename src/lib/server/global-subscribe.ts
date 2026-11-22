/**
 * Global email sign-up (US / GB / DE / AU): "email me my payback report" and deadline-alert opt-ins. Double opt-in for
 * every country: a row is created unconfirmed and a confirmation email goes out through the email adapter (Resend,
 * email.ts); confirmed_at is set only when the person clicks the confirm link (src/pages/subscribe/confirm.astro).
 * Stored in public.email_subscribers (migration 0039) with the server-only secret key; nothing is readable by the public.
 *
 * Never reveals whether an address is already on the list: every accepted request gets the same answer. An address can
 * be emailed at most once per EMAIL_MIN_GAP_MS (stops the form being used to mail-bomb someone). Topics asked for again
 * by an already-confirmed address are held in pending_topics until that address confirms them. Deadline-alert SENDING
 * does not exist yet (see docs/LAUNCH.md, "Global email list"): only the opt-in is stored. SERVER ONLY.
 */
import { randomBytes } from 'node:crypto';
import { SIGNUP_CONSENT_VERSION, consentSentence, type SignupTopic } from '../i18n/signup';
import { reportUrl, type GlobalSignup } from '../subscribe/global';
import { adminInsert, adminSelect, adminUpdate, type AdminEnv } from './admin-db';
import { buildConfirmationEmail, buildReportEmail, type GlobalEmailInput } from './global-email';
import { sendEmail, type EmailEnv } from './email';

export type GlobalSubscribeEnv = AdminEnv & EmailEnv & { NURTURE_MAILING_ADDRESS?: string; SITE_URL?: string };

export const EMAIL_MIN_GAP_MS = 10 * 60 * 1000;
export const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export const newToken = (): string => randomBytes(32).toString('base64url');
export const isToken = (t: unknown): t is string => typeof t === 'string' && TOKEN_RE.test(t);
const siteOf = (env: GlobalSubscribeEnv) => (env.SITE_URL || 'https://rayvalue.com').replace(/\/+$/, '');

export type SubscribeOutcome = 'ok' | 'unavailable' | 'error';

interface Existing {
  id: string;
  topics: SignupTopic[];
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  last_email_at: string | null;
  confirm_token: string;
  unsubscribe_token: string;
}

const EXISTING_COLS = 'id,topics,confirmed_at,unsubscribed_at,last_email_at,confirm_token,unsubscribe_token';

function emailInput(v: GlobalSignup, env: GlobalSubscribeEnv, confirmToken: string, unsubscribeToken: string, topics: readonly SignupTopic[]): GlobalEmailInput {
  const site = siteOf(env);
  return {
    to: v.email,
    country: v.country,
    locale: v.locale,
    topics,
    confirmUrl: `${site}/subscribe/confirm?t=${encodeURIComponent(confirmToken)}`,
    unsubscribeUrl: `${site}/unsubscribe?s=${encodeURIComponent(unsubscribeToken)}`,
    reportUrl: topics.includes('report') ? reportUrl(site, v.country, v.params) : null,
    siteUrl: site,
    mailingAddress: env.NURTURE_MAILING_ADDRESS?.trim() || null,
  };
}

/** Saves the sign-up and sends the confirmation (or, for a confirmed address, the report) email. */
export async function processGlobalSignup(v: GlobalSignup, env: GlobalSubscribeEnv, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<SubscribeOutcome> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return 'unavailable';
  const nowIso = now.toISOString();
  const consentText = consentSentence(v.locale, v.country, v.topics);
  const confirmToken = newToken();
  const unsubscribeToken = newToken();

  const ins = await adminInsert(
    env,
    'email_subscribers',
    {
      email: v.email,
      country: v.country,
      region: v.region,
      topics: v.topics,
      locale: v.locale,
      source: v.source,
      consent_text: consentText,
      consent_version: SIGNUP_CONSENT_VERSION,
      consent_at: nowIso,
      report_params: v.params,
      confirm_token: confirmToken,
      unsubscribe_token: unsubscribeToken,
    },
    fetchImpl,
  );
  if (ins === null) return 'error';

  let id: string;
  let mail: { kind: 'confirm' | 'report'; input: GlobalEmailInput } | null;
  if (!('conflict' in ins)) {
    id = ins.row.id;
    mail = { kind: 'confirm', input: emailInput(v, env, confirmToken, unsubscribeToken, v.topics) };
  } else {
    const rows = await adminSelect<Existing>(env, 'email_subscribers', { select: EXISTING_COLS, email: `eq.${v.email}`, country: `eq.${v.country}`, limit: '1' }, fetchImpl);
    const ex = rows?.[0];
    if (!ex) return 'error';
    id = ex.id;
    const throttled = ex.last_email_at !== null && now.getTime() - Date.parse(ex.last_email_at) < EMAIL_MIN_GAP_MS;
    const active = ex.confirmed_at !== null && ex.unsubscribed_at === null;
    if (throttled) {
      mail = null; // answer as usual, send nothing: the earlier email's links are still valid (nothing is rotated)
    } else if (active) {
      const fresh = v.topics.filter((t) => !ex.topics.includes(t));
      if (fresh.length > 0) {
        const n = await adminUpdate(env, 'email_subscribers', { id: `eq.${id}` }, { pending_topics: fresh, confirm_token: confirmToken, report_params: v.params ?? undefined, region: v.region ?? undefined }, fetchImpl);
        if (n === null) return 'error';
        mail = { kind: 'confirm', input: emailInput(v, env, confirmToken, ex.unsubscribe_token, fresh) };
      } else if (v.topics.includes('report')) {
        mail = { kind: 'report', input: emailInput(v, env, ex.confirm_token, ex.unsubscribe_token, ['report']) };
      } else mail = null;
    } else {
      // Not confirmed yet, or unsubscribed earlier: a fresh opt-in with the wording seen now and a new confirm link.
      const n = await adminUpdate(
        env,
        'email_subscribers',
        { id: `eq.${id}` },
        {
          topics: v.topics,
          pending_topics: null,
          region: v.region,
          locale: v.locale,
          source: v.source,
          consent_text: consentText,
          consent_version: SIGNUP_CONSENT_VERSION,
          consent_at: nowIso,
          report_params: v.params,
          confirm_token: confirmToken,
          confirmed_at: null,
          unsubscribed_at: null,
        },
        fetchImpl,
      );
      if (n === null) return 'error';
      mail = { kind: 'confirm', input: emailInput(v, env, confirmToken, ex.unsubscribe_token, v.topics) };
    }
  }

  if (!mail) return 'ok';
  const msg = mail.kind === 'confirm' ? buildConfirmationEmail(mail.input) : buildReportEmail(mail.input);
  const sent = await sendEmail(env, msg, fetchImpl);
  if (sent === 'disabled') return 'unavailable'; // never pretend: no provider configured means no email
  if (sent !== 'sent') return 'error';
  await adminUpdate(env, 'email_subscribers', { id: `eq.${id}` }, { last_email_at: nowIso }, fetchImpl);
  return 'ok';
}

export type ConfirmResult = 'ok' | 'invalid' | 'expired' | 'error';

interface ConfirmRow {
  id: string;
  topics: SignupTopic[];
  pending_topics: SignupTopic[] | null;
  confirmed_at: string | null;
  last_email_at: string | null;
}

/** Applies the confirm link: marks the address confirmed and moves any pending topics into its topics. Safe to repeat. */
export async function confirmSubscription(env: GlobalSubscribeEnv, token: unknown, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<ConfirmResult> {
  if (!isToken(token)) return 'invalid';
  const rows = await adminSelect<ConfirmRow>(env, 'email_subscribers', { select: 'id,topics,pending_topics,confirmed_at,last_email_at', confirm_token: `eq.${token}`, limit: '1' }, fetchImpl);
  if (rows === null) return 'error';
  const row = rows[0];
  if (!row) return 'invalid';
  const open = row.confirmed_at === null || (row.pending_topics?.length ?? 0) > 0;
  if (!open) return 'ok';
  if (row.last_email_at !== null && now.getTime() - Date.parse(row.last_email_at) > CONFIRM_TTL_MS) return 'expired';
  const topics = [...new Set([...row.topics, ...(row.pending_topics ?? [])])];
  const n = await adminUpdate(env, 'email_subscribers', { id: `eq.${row.id}` }, { confirmed_at: row.confirmed_at ?? now.toISOString(), topics, pending_topics: null, unsubscribed_at: null }, fetchImpl);
  return n === null ? 'error' : 'ok';
}

export type UnsubscribeOutcome = 'ok' | 'invalid' | 'error';

/** Applies an unsubscribe link of the global list: stops all emails to the address (and adds it to the shared suppression list). */
export async function unsubscribeSubscriber(env: GlobalSubscribeEnv, token: unknown, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<UnsubscribeOutcome> {
  if (!isToken(token)) return 'invalid';
  const rows = await adminSelect<{ id: string; email: string }>(env, 'email_subscribers', { select: 'id,email', unsubscribe_token: `eq.${token}`, limit: '1' }, fetchImpl);
  if (rows === null) return 'error';
  const row = rows[0];
  if (!row) return 'invalid';
  const n = await adminUpdate(env, 'email_subscribers', { id: `eq.${row.id}` }, { unsubscribed_at: now.toISOString(), pending_topics: null }, fetchImpl);
  if (n === null) return 'error';
  // The shared suppression list (checked by the nurture job) so no RayValue list mails this address again. A conflict means it is already there.
  const sup = await adminInsertSuppression(env, row.email, fetchImpl);
  return sup ? 'ok' : 'error';
}

async function adminInsertSuppression(env: GlobalSubscribeEnv, email: string, fetchImpl: typeof fetch): Promise<boolean> {
  const r = await adminInsert(env, 'email_suppressions', { email: email.toLowerCase(), reason: 'unsubscribe' }, fetchImpl, 'email');
  return r !== null;
}
