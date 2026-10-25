/**
 * Lead dedupe, Do-Not-Sell suppression, buyer routing, delivery (webhook / email / crm) with retries, and owner
 * notifications. All decisions come from the pure functions in src/lib/routing/*; this file only does I/O.
 * Uses the server-only SUPABASE_SECRET_KEY. Never logs lead values (names, emails, phones, addresses).
 */
import { adminInsert, adminSelect, adminUpdate, type AdminEnv } from './admin-db';
import { sendEmail, type EmailEnv } from './email';
import {
  DELIVERY_ID_HEADER, EVENT_HEADER, INLINE_BACKOFF_MS, MAX_TOTAL_ATTEMPTS, SIGNATURE_HEADER, WEBHOOK_EVENT,
  buildLeadEmail, buildPayload, classifyResponse, excerpt, nextAttemptAt, signBody, validEmailTarget, validWebhookUrl,
  type LeadRecord, type ResponseClass,
} from '../routing/delivery';
import {
  chooseBuyers, countByBuyer, dedupeCutoff, findDuplicate, isSuppressed, statusAfterRouting, utcDayStart, withinBusinessHours,
  type Buyer, type PriorLead, type RoutableLead, type RoutingOutcome,
} from '../routing/eligibility';

export interface RoutingEnv extends AdminEnv, EmailEnv {
  /** Owner's address for new-lead summaries and delivery-failure alerts. */
  OWNER_EMAIL?: string;
  /** Raw process.env, used only to resolve env-var NAMES stored on buyer rows (targets, secrets). */
  secrets?: Record<string, string | undefined>;
}

export const SITE_URL = 'https://rayvalue.com';
const WEBHOOK_TIMEOUT_MS = 8000;
const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ env-var references on buyer rows

const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Names a buyer row may never point at: our own credentials. */
const DENIED_PREFIXES = ['SUPABASE_', 'TWILIO_', 'RESEND_', 'ADMIN_', 'LEAD_SIGNING', 'CRON_', 'VERCEL', 'OWNER_', 'EMAIL_', 'NREL_', 'AWS_'];

/** The value of the env var a buyer row names, or undefined (unset, malformed name, or one of our own secrets). */
export function readEnvRef(secrets: Record<string, string | undefined> | undefined, name: string | null | undefined): string | undefined {
  if (!name || !ENV_NAME_RE.test(name) || DENIED_PREFIXES.some((p) => name.startsWith(p))) return undefined;
  const v = secrets?.[name];
  return v && v.trim() ? v.trim() : undefined;
}

// ------------------------------------------------------------------ dedupe + suppression

export type DuplicateCheck = { kind: 'unique' } | { kind: 'duplicate'; of: string } | { kind: 'unknown' };

/** Looks for an earlier lead with the same phone or email in the last 30 days. */
export async function checkDuplicate(env: RoutingEnv, lead: { phone: string; email: string }, fetchImpl: typeof fetch, now = new Date()): Promise<DuplicateCheck> {
  // phone is E.164 (+1...) and email passed validation (no commas, quotes or parens), so both are safe in a PostgREST filter.
  const rows = await adminSelect<PriorLead>(
    env,
    'leads',
    { select: 'id,created_at,status,phone,email', created_at: `gte.${dedupeCutoff(now)}`, or: `(phone.eq.${lead.phone},email.eq.${lead.email.toLowerCase()})`, order: 'created_at.asc', limit: '20' },
    fetchImpl,
  );
  if (!rows) return { kind: 'unknown' };
  const hit = findDuplicate(rows, lead, now);
  return hit ? { kind: 'duplicate', of: hit.id } : { kind: 'unique' };
}

/** true = suppressed (do not resell), false = fine, null = the check failed (caller must not sell). */
export async function checkSuppressed(env: RoutingEnv, lead: { phone: string; email: string }, fetchImpl: typeof fetch): Promise<boolean | null> {
  const sameFone = await adminSelect<{ email: string }>(env, 'leads', { select: 'email', phone: `eq.${lead.phone}`, limit: '50' }, fetchImpl);
  if (!sameFone) return null;
  const emails = [...new Set([lead.email.toLowerCase(), ...sameFone.map((r) => r.email.toLowerCase())])].filter((e) => /^[^\s,()"]+$/.test(e));
  const reqs = await adminSelect<{ email: string; request: string; status: string }>(
    env,
    'data_requests',
    { select: 'email,request,status', email: `in.(${emails.map((e) => `"${e}"`).join(',')})`, request: 'in.(do_not_sell,delete)', limit: '50' },
    fetchImpl,
  );
  return reqs ? isSuppressed(reqs, emails) : null;
}

// ------------------------------------------------------------------ owner notifications

const adminUrl = `${SITE_URL}/admin/leads`;

export async function notifyOwner(env: RoutingEnv, subject: string, lines: string[], fetchImpl: typeof fetch): Promise<void> {
  if (!env.OWNER_EMAIL) return;
  await sendEmail(env, { to: env.OWNER_EMAIL, subject, text: [...lines, '', `Admin: ${adminUrl}`].join('\n') }, fetchImpl);
}

export interface NewLeadSummary {
  id: string;
  status: string;
  reason: string | null;
  state: string;
  source: string;
  timeline: string;
  bill_bucket: string | null;
  phone_verified: boolean;
  buyers: string[];
}

/** One summary per new lead. Summary only: no name, email, phone or address. */
export function newLeadMessage(s: NewLeadSummary): { subject: string; lines: string[] } {
  return {
    subject: `RayValue lead: ${s.status}${s.reason ? ` (${s.reason})` : ''} - ${s.state}`,
    lines: [
      `Lead ${s.id}`,
      `Status: ${s.status}${s.reason ? ` (${s.reason})` : ''}`,
      `State: ${s.state} | Source: ${s.source} | Timeline: ${s.timeline} | Bill: ${s.bill_bucket ?? 'n/a'}`,
      `Phone verified at submit: ${s.phone_verified ? 'yes' : 'no'}`,
      `Delivered/queued to: ${s.buyers.length ? s.buyers.join(', ') : 'nobody'}`,
    ],
  };
}

// ------------------------------------------------------------------ delivery

interface DeliveryRow {
  id: string;
  lead_id: string;
  buyer_id: string;
  method: 'email' | 'webhook' | 'crm';
  status: 'queued' | 'delivered' | 'failed' | 'abandoned';
  attempts: number;
}

interface Attempt {
  cls: ResponseClass;
  status: number | null;
  excerpt: string | null;
  error: string | null;
}

const fail = (error: string, cls: ResponseClass = 'permanent', status: number | null = null, body: string | null = null): Attempt => ({ cls, status, excerpt: body ? excerpt(body) : null, error });

/** One delivery attempt to a buyer. Misconfiguration is a permanent failure with a stated reason. */
export async function attemptDelivery(env: RoutingEnv, buyer: Buyer, lead: LeadRecord, deliveryId: string, fetchImpl: typeof fetch, nowMs = Date.now()): Promise<Attempt> {
  const target = readEnvRef(env.secrets, buyer.delivery_target_env) ?? buyer.delivery_target;
  if (buyer.delivery_method === 'email') {
    const to = validEmailTarget(target);
    if (!to) return fail('email target missing or invalid');
    const msg = buildLeadEmail(lead, buyer.name);
    const r = await sendEmail(env, { to, ...msg }, fetchImpl);
    if (r === 'sent') return { cls: 'ok', status: null, excerpt: null, error: null };
    // Provider not configured: retryable, so a later configuration lets the retry job send it.
    return fail(r === 'disabled' ? 'email provider not configured' : 'email provider error', 'retry');
  }
  const url = validWebhookUrl(target);
  if (!url) return fail('webhook url missing or not a public https url');
  const secret = readEnvRef(env.secrets, buyer.webhook_secret_env);
  if (!secret) return fail('webhook secret env var not set');
  const body = JSON.stringify(buildPayload(lead, deliveryId));
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        [SIGNATURE_HEADER]: signBody(secret, body, nowMs),
        [DELIVERY_ID_HEADER]: deliveryId,
        [EVENT_HEADER]: WEBHOOK_EVENT,
        'User-Agent': 'RayValue-Webhook/1',
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => '');
    const cls = classifyResponse(res.status);
    return { cls, status: res.status, excerpt: excerpt(text) || null, error: cls === 'ok' ? null : `webhook responded ${res.status}` };
  } catch (e) {
    return fail(`webhook request failed (${e instanceof Error ? e.name : 'error'})`, 'retry');
  }
}

export interface DeliveryResult {
  buyer: string;
  state: 'delivered' | 'queued' | 'failed';
}

/** Email fallback for a webhook buyer that keeps failing. true = sent. */
async function sendFallback(env: RoutingEnv, buyer: Buyer, lead: LeadRecord, fetchImpl: typeof fetch): Promise<boolean> {
  const to = validEmailTarget(readEnvRef(env.secrets, buyer.fallback_email_env));
  if (!to || buyer.delivery_method === 'email') return false;
  return (await sendEmail(env, { to, ...buildLeadEmail(lead, buyer.name) }, fetchImpl)) === 'sent';
}

/**
 * Run attempts for one delivery row: `inline` = several tries with backoff (first delivery, inside the request);
 * otherwise a single try (retry job). Writes the outcome to lead_deliveries and alerts the owner on failure.
 */
export async function processDelivery(
  env: RoutingEnv,
  row: DeliveryRow,
  buyer: Buyer,
  lead: LeadRecord,
  fetchImpl: typeof fetch,
  opts: { inline: boolean; now?: Date; sleep?: (ms: number) => Promise<void> } = { inline: true },
): Promise<DeliveryResult> {
  const sleep = opts.sleep ?? sleepReal;
  const now = opts.now ?? new Date();
  const delays = opts.inline ? INLINE_BACKOFF_MS : [0];
  let attempts = row.attempts;
  let last: Attempt = fail('no attempt made', 'retry');
  for (const d of delays) {
    if (d) await sleep(d);
    attempts++;
    last = await attemptDelivery(env, buyer, lead, row.id, fetchImpl, Date.now());
    if (last.cls !== 'retry') break;
  }
  const base = { attempts, last_attempt_at: new Date().toISOString(), response_status: last.status, response_excerpt: last.excerpt, error: last.error };
  if (last.cls === 'ok') {
    await adminUpdate(env, 'lead_deliveries', { id: `eq.${row.id}` }, { ...base, status: 'delivered', delivered_at: new Date().toISOString(), next_attempt_at: null }, fetchImpl);
    return { buyer: buyer.name, state: 'delivered' };
  }
  // Failed: try the buyer's fallback email, then (for retryable failures) schedule another attempt.
  if (await sendFallback(env, buyer, lead, fetchImpl)) {
    await adminUpdate(env, 'lead_deliveries', { id: `eq.${row.id}` }, { ...base, status: 'delivered', delivered_at: new Date().toISOString(), next_attempt_at: null, used_fallback: true, error: `${last.error ?? 'failed'}; delivered by fallback email` }, fetchImpl);
    await notifyOwner(env, `RayValue: delivery to ${buyer.name} used the email fallback`, [`Lead ${lead.id}`, `Primary delivery failed: ${last.error ?? 'unknown'}`, 'It was delivered to the buyer\'s fallback email instead.'], fetchImpl);
    return { buyer: buyer.name, state: 'delivered' };
  }
  const next = last.cls === 'retry' ? nextAttemptAt(attempts, now) : null;
  if (next) {
    await adminUpdate(env, 'lead_deliveries', { id: `eq.${row.id}` }, { ...base, status: 'failed', next_attempt_at: next.toISOString() }, fetchImpl);
    if (attempts <= INLINE_BACKOFF_MS.length) await notifyOwner(env, `RayValue: delivery to ${buyer.name} failed, will retry`, [`Lead ${lead.id}`, `Error: ${last.error ?? 'unknown'}`, `Attempts so far: ${attempts}. Next try: ${next.toISOString()}`], fetchImpl);
    return { buyer: buyer.name, state: 'failed' };
  }
  await adminUpdate(env, 'lead_deliveries', { id: `eq.${row.id}` }, { ...base, status: 'abandoned', next_attempt_at: null }, fetchImpl);
  await notifyOwner(env, `RayValue: delivery to ${buyer.name} FAILED permanently`, [`Lead ${lead.id}`, `Error: ${last.error ?? 'unknown'}`, `Attempts: ${attempts}. This lead has NOT reached ${buyer.name}; deliver it by hand from the admin page.`], fetchImpl);
  return { buyer: buyer.name, state: 'failed' };
}

// ------------------------------------------------------------------ routing

const toRoutable = (l: LeadRecord): RoutableLead => ({ zip: l.zip, state: l.state, homeowner: l.homeowner, timeline: l.timeline, bill_bucket: l.bill_bucket, consented_installers: l.consented_installers });

/**
 * Route a stored lead (status 'new') to up to 3 eligible, consented, active buyers and deliver. Updates the lead's
 * status ('sent' when at least one buyer has or will get it). Returns the summary used for the owner notification.
 */
export async function routeLead(env: RoutingEnv, leadId: string, fetchImpl: typeof fetch, now = new Date(), sleep?: (ms: number) => Promise<void>): Promise<NewLeadSummary | null> {
  const leads = await adminSelect<LeadRecord & { status: string }>(env, 'leads', { id: `eq.${leadId}`, select: '*' }, fetchImpl);
  const lead = leads?.[0];
  if (!lead) return null;
  const summary: NewLeadSummary = { id: lead.id, status: lead.status, reason: null, state: lead.state, source: lead.source, timeline: lead.timeline, bill_bucket: lead.bill_bucket, phone_verified: lead.phone_verified, buyers: [] };
  if (lead.status !== 'new') return summary;

  const [buyers, today] = await Promise.all([
    adminSelect<Buyer>(env, 'buyers', { active: 'eq.true', select: '*' }, fetchImpl),
    adminSelect<{ buyer_id: string; status: string }>(env, 'lead_deliveries', { created_at: `gte.${utcDayStart(now)}`, select: 'buyer_id,status', limit: '5000' }, fetchImpl),
  ]);
  if (!buyers || !today) {
    // Could not read buyers/caps: do not guess. Leave the lead 'new' for manual routing.
    await adminUpdate(env, 'leads', { id: `eq.${lead.id}` }, { status_reason: 'routing_lookup_failed' }, fetchImpl);
    return { ...summary, reason: 'routing_lookup_failed' };
  }
  const decision = chooseBuyers(buyers, toRoutable(lead), countByBuyer(today));
  let outcome: RoutingOutcome = { kind: 'no_buyers' };
  const results: DeliveryResult[] = [];
  if (decision.buyers.length) {
    const settled = await Promise.all(
      decision.buyers.map(async (b): Promise<DeliveryResult | null> => {
        const open = withinBusinessHours(b.business_hours, now);
        const ins = await adminInsert<DeliveryRow>(
          env,
          'lead_deliveries',
          { lead_id: lead.id, buyer_id: b.id, method: b.delivery_method, status: 'queued', price: b.price, next_attempt_at: new Date(now.getTime() + (open ? 5 * 60_000 : 0)).toISOString() },
          fetchImpl,
          'id,lead_id,buyer_id,method,status,attempts',
        );
        if (!ins || 'conflict' in ins) return null; // already routed to this buyer (unique lead+buyer) or write failed
        if (!open) return { buyer: b.name, state: 'queued' }; // the retry job sends it when the window opens
        return processDelivery(env, ins.row, b, lead, fetchImpl, { inline: true, now, sleep });
      }),
    );
    for (const r of settled) if (r) results.push(r);
    outcome = {
      kind: 'results',
      delivered: results.filter((r) => r.state === 'delivered').length,
      queued: results.filter((r) => r.state === 'queued').length,
      failed: results.filter((r) => r.state === 'failed').length,
    };
  }
  const fin = statusAfterRouting(outcome);
  await adminUpdate(env, 'leads', { id: `eq.${lead.id}` }, { status: fin.status, status_reason: fin.reason, routed_at: fin.status === 'sent' ? now.toISOString() : null }, fetchImpl);
  return { ...summary, status: fin.status, reason: fin.reason, buyers: results.filter((r) => r.state !== 'failed').map((r) => r.buyer) };
}

/** Retry job: due 'queued'/'failed' deliveries, one attempt each (respecting each buyer's business hours). */
export async function retryDueDeliveries(env: RoutingEnv, fetchImpl: typeof fetch, now = new Date()): Promise<{ checked: number; delivered: number }> {
  const due = await adminSelect<DeliveryRow>(
    env,
    'lead_deliveries',
    { status: 'in.(queued,failed)', next_attempt_at: `lte.${now.toISOString()}`, select: 'id,lead_id,buyer_id,method,status,attempts', order: 'next_attempt_at.asc', limit: '50' },
    fetchImpl,
  );
  if (!due?.length) return { checked: 0, delivered: 0 };
  let delivered = 0;
  for (const d of due) {
    const [buyers, leads] = await Promise.all([
      adminSelect<Buyer>(env, 'buyers', { id: `eq.${d.buyer_id}`, select: '*' }, fetchImpl),
      adminSelect<LeadRecord>(env, 'leads', { id: `eq.${d.lead_id}`, select: '*' }, fetchImpl),
    ]);
    const buyer = buyers?.[0];
    const lead = leads?.[0];
    if (!buyer || !lead) continue;
    if (!withinBusinessHours(buyer.business_hours, now)) continue;
    // Claim: compare-and-set on the attempt count so two overlapping job runs cannot both send.
    const claimed = await adminUpdate(env, 'lead_deliveries', { id: `eq.${d.id}`, attempts: `eq.${d.attempts}` }, { next_attempt_at: new Date(now.getTime() + 10 * 60_000).toISOString() }, fetchImpl);
    if (claimed !== 1) continue;
    if (d.attempts >= MAX_TOTAL_ATTEMPTS) {
      await adminUpdate(env, 'lead_deliveries', { id: `eq.${d.id}` }, { status: 'abandoned', next_attempt_at: null }, fetchImpl);
      continue;
    }
    const r = await processDelivery(env, d, buyer, lead, fetchImpl, { inline: false, now });
    if (r.state === 'delivered') {
      delivered++;
      // A delivery that finally got through makes the lead 'sent' (it was 'new' while every buyer was failing/queued).
      await adminUpdate(env, 'leads', { id: `eq.${lead.id}`, status: 'eq.new' }, { status: 'sent', status_reason: null, routed_at: now.toISOString() }, fetchImpl);
    }
  }
  return { checked: due.length, delivered };
}
