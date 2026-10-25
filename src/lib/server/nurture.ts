/**
 * Nurture email job (5 emails over ~3 weeks). Called once a day by the Vercel cron route /api/cron/nurture.
 * Off unless the owner sets everything it needs (see nurtureReadiness): NURTURE_ENABLED=true, an email provider
 * (RESEND_API_KEY + EMAIL_FROM), NURTURE_MAILING_ADDRESS (CAN-SPAM) and UNSUBSCRIBE_SECRET. Sends nothing to
 * anyone on the suppression list or with a delete / do-not-sell request, and at most one email per person per run.
 * Leads with status 'nurture' are included only with NURTURE_INCLUDE_LEADS=true (their consent wording needs
 * attorney sign-off first). SERVER ONLY.
 */
import { renderNurtureEmail } from '../../emails/nurture';
import { dueStep, NURTURE_MAX_AGE_DAYS } from '../nurture/schedule';
import { parseSnapshot, type EstimateSnapshot } from '../leads/validate';
import { adminSelectAll, adminUpdate, type AdminEnv } from './admin-db';
import { emailEnabled, sendEmail, unsubscribeHeaders, type EmailEnv } from './email';
import { MIN_SECRET_LENGTH, signUnsubscribeToken, unsubscribeUrl, type TokenKind } from './unsubscribe';

export interface NurtureEnv extends AdminEnv, EmailEnv {
  NURTURE_ENABLED?: string;
  NURTURE_MAILING_ADDRESS?: string;
  NURTURE_INCLUDE_LEADS?: string;
  UNSUBSCRIBE_SECRET?: string;
  SITE_URL?: string;
}

export const MAX_SENDS_PER_RUN = 100;
const DEFAULT_SITE = 'https://rayvalue.com';

/** What is missing before nurture email can send (empty = ready). Names only; never values. */
export function nurtureMissing(env: NurtureEnv): string[] {
  const out: string[] = [];
  if (env.NURTURE_ENABLED !== 'true') out.push('NURTURE_ENABLED=true');
  if (!emailEnabled(env)) out.push('RESEND_API_KEY and EMAIL_FROM');
  if (!env.NURTURE_MAILING_ADDRESS?.trim()) out.push('NURTURE_MAILING_ADDRESS');
  if (!env.UNSUBSCRIBE_SECRET || env.UNSUBSCRIBE_SECRET.length < MIN_SECRET_LENGTH) out.push('UNSUBSCRIBE_SECRET (16+ chars)');
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) out.push('SUPABASE_URL and SUPABASE_SECRET_KEY');
  return out;
}

interface Recipient {
  kind: TokenKind;
  id: string;
  email: string;
  state: 'FL' | 'CA' | null;
  snapshot: EstimateSnapshot | null;
  created_at: string;
  nurture_step: number;
  nurture_last_sent_at: string | null;
  email_status: string | null;
}

interface RawRow {
  id: string;
  email: string;
  state: string | null;
  estimate_snapshot: unknown;
  created_at: string;
  nurture_step: number;
  nurture_last_sent_at: string | null;
  email_status?: string | null;
}

const toRecipient = (kind: TokenKind, r: RawRow): Recipient => ({
  kind,
  id: r.id,
  email: r.email,
  state: r.state === 'FL' || r.state === 'CA' ? r.state : null,
  snapshot: parseSnapshot(r.estimate_snapshot),
  created_at: r.created_at,
  nurture_step: r.nurture_step,
  nurture_last_sent_at: r.nurture_last_sent_at,
  email_status: r.email_status ?? null,
});

export interface NurtureOutcome {
  disabled?: string[];
  checked?: number;
  sent?: number;
  failed?: number;
  error?: string;
}

export async function runNurture(env: NurtureEnv, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<NurtureOutcome> {
  const missing = nurtureMissing(env);
  if (missing.length) return { disabled: missing };

  const since = new Date(now.getTime() - NURTURE_MAX_AGE_DAYS * 86_400_000).toISOString();
  const cols = 'id,email,state,estimate_snapshot,created_at,nurture_step,nurture_last_sent_at';
  const [estimates, leads, suppressed, requests] = await Promise.all([
    adminSelectAll<RawRow>(env, 'estimate_requests', { select: `${cols},email_status`, nurture: 'eq.true', unsubscribed_at: 'is.null', nurture_step: 'lt.5', created_at: `gte.${since}`, order: 'created_at.asc' }, fetchImpl),
    env.NURTURE_INCLUDE_LEADS === 'true'
      ? adminSelectAll<RawRow>(env, 'leads', { select: cols, status: 'eq.nurture', nurture_step: 'lt.5', created_at: `gte.${since}`, order: 'created_at.asc' }, fetchImpl)
      : Promise.resolve([] as RawRow[]),
    adminSelectAll<{ email: string }>(env, 'email_suppressions', { select: 'email' }, fetchImpl),
    adminSelectAll<{ email: string }>(env, 'data_requests', { select: 'email', request: 'in.(delete,do_not_sell)' }, fetchImpl),
  ]);
  // Without the suppression list we cannot know who opted out, so send nothing.
  if (!estimates || !leads || !suppressed || !requests) return { error: 'database read failed' };

  const blocked = new Set([...suppressed, ...requests].map((r) => r.email.toLowerCase()));
  const seen = new Set<string>();
  const due: { r: Recipient; step: number }[] = [];
  for (const r of [...estimates.map((x) => toRecipient('e', x)), ...leads.map((x) => toRecipient('l', x))]) {
    const key = r.email.toLowerCase();
    if (blocked.has(key) || seen.has(key)) continue;
    seen.add(key);
    const step = dueStep(r, now);
    if (step) due.push({ r, step });
  }

  const site = (env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, '');
  let sent = 0;
  let failed = 0;
  for (const { r, step } of due.slice(0, MAX_SENDS_PER_RUN)) {
    const url = unsubscribeUrl(site, signUnsubscribeToken(r.kind, r.id, env.UNSUBSCRIBE_SECRET!));
    const mail = renderNurtureEmail(step, { siteUrl: site, state: r.state, snapshot: r.snapshot, unsubscribeUrl: url, mailingAddress: env.NURTURE_MAILING_ADDRESS!.trim() });
    if (!mail || mail.text.includes('{{')) {
      failed++;
      continue;
    }
    const result = await sendEmail(env, { to: r.email, subject: mail.subject, text: mail.text, headers: unsubscribeHeaders(url) }, fetchImpl);
    if (result !== 'sent') {
      failed++;
      continue;
    }
    sent++;
    const table = r.kind === 'e' ? 'estimate_requests' : 'leads';
    const patch = { nurture_step: step, nurture_last_sent_at: now.toISOString(), ...(r.kind === 'e' && step === 1 ? { email_status: 'sent' } : {}) };
    const n = await adminUpdate(env, table, { id: `eq.${r.id}` }, patch, fetchImpl);
    if (n === null) console.error('nurture: sent but could not record the step; this person may get the same email again');
  }
  return { checked: due.length, sent, failed };
}
