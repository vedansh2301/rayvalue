/**
 * Delivery payloads, signatures, retry schedule and email text (pure; node:crypto only). Server-side use.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BILL_BUCKET_LABELS, TIMELINE_LABELS, type BillBucket, type Timeline } from '../leads/options';

export const SIGNATURE_HEADER = 'X-RayValue-Signature';
export const DELIVERY_ID_HEADER = 'X-RayValue-Delivery-Id';
export const EVENT_HEADER = 'X-RayValue-Event';
export const WEBHOOK_EVENT = 'lead.created';

/** Attempts made inside the request that created the lead (delay before each, ms), then the retry job continues. */
export const INLINE_BACKOFF_MS: readonly number[] = [0, 1000, 3000];
/** Delay before retry-job attempt N (minutes after the previous attempt). Total attempts allowed = inline + these. */
export const RETRY_JOB_DELAYS_MIN: readonly number[] = [5, 30, 120, 720, 1440];
export const MAX_TOTAL_ATTEMPTS = INLINE_BACKOFF_MS.length + RETRY_JOB_DELAYS_MIN.length;

export interface LeadRecord {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string;
  phone_verified: boolean;
  street_address: string | null;
  zip: string;
  state: string;
  utility_id: string | null;
  bill_bucket: string | null;
  avg_monthly_bill: number | string | null;
  homeowner: boolean;
  roof_age: string | null;
  shading: string | null;
  battery: number | null;
  battery_interest: string | null;
  pay_method: string | null;
  timeline: string;
  estimate_snapshot: unknown;
  source: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  landing_page: string | null;
  referrer: string | null;
  consent_text: string;
  consent_version: string;
  consent_at: string;
  consent_ip: string | null;
  consent_page_url: string | null;
  trustedform_cert_url: string | null;
  consented_installers: string[];
}

/** The JSON a buyer receives. Includes the consent evidence (text, version, time, TrustedForm certificate URL). */
export function buildPayload(lead: LeadRecord, deliveryId: string) {
  return {
    event: WEBHOOK_EVENT,
    delivery_id: deliveryId,
    lead_id: lead.id,
    created_at: lead.created_at,
    contact: {
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      phone_verified: lead.phone_verified,
    },
    property: {
      street_address: lead.street_address,
      zip: lead.zip,
      state: lead.state,
      homeowner: lead.homeowner,
      utility_id: lead.utility_id,
      roof_age: lead.roof_age,
      shading: lead.shading,
    },
    project: {
      timeline: lead.timeline,
      bill_bucket: lead.bill_bucket,
      avg_monthly_bill: lead.avg_monthly_bill === null ? null : Number(lead.avg_monthly_bill),
      battery: lead.battery,
      battery_interest: lead.battery_interest,
      pay_method: lead.pay_method,
    },
    estimate_snapshot: lead.estimate_snapshot ?? null,
    source: {
      source: lead.source,
      utm_source: lead.utm_source,
      utm_medium: lead.utm_medium,
      utm_campaign: lead.utm_campaign,
      utm_term: lead.utm_term,
      utm_content: lead.utm_content,
      gclid: lead.gclid,
      fbclid: lead.fbclid,
      landing_page: lead.landing_page,
      referrer: lead.referrer,
    },
    consent: {
      text: lead.consent_text,
      version: lead.consent_version,
      timestamp: lead.consent_at,
      ip: lead.consent_ip,
      page_url: lead.consent_page_url,
      trustedform_cert_url: lead.trustedform_cert_url,
      installers: lead.consented_installers,
    },
  };
}
export type DeliveryPayload = ReturnType<typeof buildPayload>;

const sigOf = (secret: string, t: number, body: string) => createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

/** Header value "t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">". Buyers verify it with the shared secret. */
export function signBody(secret: string, body: string, nowMs: number): string {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v1=${sigOf(secret, t, body)}`;
}

/** Reference verifier (documented for buyers, used in tests): constant-time compare, `toleranceSec` replay window. */
export function verifySignature(secret: string, body: string, header: string, nowMs: number, toleranceSec = 300): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const a = Buffer.from(m[2]!, 'hex');
  const b = Buffer.from(sigOf(secret, t, body), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ResponseClass = 'ok' | 'retry' | 'permanent';
/** 2xx ok; 408/425/429/5xx retry; any other status is the buyer rejecting the request (retrying will not help). */
export function classifyResponse(status: number): ResponseClass {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retry';
  return 'permanent';
}

/** When the retry job should next try, given how many attempts have been made. null = no more attempts. */
export function nextAttemptAt(attemptsMade: number, from: Date): Date | null {
  const idx = attemptsMade - INLINE_BACKOFF_MS.length;
  if (attemptsMade >= MAX_TOTAL_ATTEMPTS) return null;
  const minutes = RETRY_JOB_DELAYS_MIN[Math.max(0, idx)];
  return minutes === undefined ? null : new Date(from.getTime() + minutes * 60_000);
}

/** Webhook targets must be https URLs with a public-looking host (no credentials, no localhost/private literals). */
export function validWebhookUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return null;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(':')) return null; // IP literals (v4, v6)
    if (!h.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export const validEmailTarget = (raw: string | null | undefined): string | null => (raw && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(raw) && raw.length <= 254 ? raw : null);

/** Truncate a buyer's response for the log (kept short; may contain anything the buyer returned). */
export const excerpt = (s: string, max = 300): string => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

/** Plain-text lead email to a buyer (email delivery, and the webhook fallback). */
export function buildLeadEmail(lead: LeadRecord, buyerName: string): { subject: string; text: string } {
  const bill = lead.bill_bucket ? (BILL_BUCKET_LABELS[lead.bill_bucket as BillBucket] ?? lead.bill_bucket) : 'not given';
  const timeline = TIMELINE_LABELS[lead.timeline as Timeline] ?? lead.timeline;
  const rows: [string, string | null | undefined][] = [
    ['Name', `${lead.first_name} ${lead.last_name ?? ''}`.trim()],
    ['Phone', `${lead.phone}${lead.phone_verified ? ' (verified by SMS code)' : ' (not verified)'}`],
    ['Email', lead.email],
    ['Address', [lead.street_address, lead.zip, lead.state].filter(Boolean).join(', ')],
    ['Owns the home', lead.homeowner ? 'Yes' : 'No'],
    ['Monthly electric bill', bill],
    ['Utility', lead.utility_id],
    ['Roof age', lead.roof_age],
    ['Shade', lead.shading],
    ['Battery interest', lead.battery_interest],
    ['Payment preference', lead.pay_method],
    ['Timeline', timeline],
    ['Source', lead.source],
  ];
  const consent = [
    'Consent evidence',
    `Consent version: ${lead.consent_version}`,
    `Consented at: ${lead.consent_at}`,
    `Consent page: ${lead.consent_page_url ?? 'n/a'}`,
    `TrustedForm certificate: ${lead.trustedform_cert_url ?? 'n/a'}`,
    `Consent text: ${lead.consent_text}`,
  ];
  return {
    subject: `New RayValue solar lead (${lead.state}, ${lead.zip})`,
    text: [
      `New solar quote request for ${buyerName}.`,
      `Lead ID: ${lead.id}`,
      '',
      ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
      '',
      ...consent,
      '',
      'This person asked for quotes and agreed to be contacted by the installers named in the consent text above.',
    ].join('\n'),
  };
}
