/**
 * Transactional email through an env-gated adapter. Today one provider is implemented (Resend, REST API); with
 * RESEND_API_KEY or EMAIL_FROM unset nothing is sent and the caller records the request as 'pending'/'skipped'.
 * Plain text only; every value interpolated into a message is a short snapshot string already limited by
 * parseSnapshot, so a visitor cannot use the endpoint to send arbitrary content.
 */
import type { EstimateSnapshot, SnapshotValue } from '../leads/validate';

export interface EmailEnv {
  RESEND_API_KEY?: string;
  /** Verified sender, e.g. "RayValue <estimates@rayvalue.com>". */
  EMAIL_FROM?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe for nurture email. */
  headers?: Record<string, string>;
}

export const emailEnabled = (env: EmailEnv): boolean => !!(env.RESEND_API_KEY && env.EMAIL_FROM);

export type SendResult = 'sent' | 'disabled' | 'failed';

export async function sendEmail(env: EmailEnv, msg: EmailMessage, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  if (!emailEnabled(env)) return 'disabled';
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, ...(msg.headers ? { headers: msg.headers } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`email: provider status ${res.status}`);
    return res.ok ? 'sent' : 'failed';
  } catch (e) {
    console.error('email: provider request failed', e instanceof Error ? e.name : 'error');
    return 'failed';
  }
}

const LABELS: Record<string, string> = {
  payback: 'Payback',
  net_savings: 'Net savings over 25 years',
  upfront_cost: 'Upfront cost',
  system_size: 'System size',
};
const ORDER = ['payback', 'net_savings', 'upfront_cost', 'system_size'] as const;

/** The estimate rows of a snapshot as plain-text lines (empty when there is nothing to show). */
export function estimateLines(snapshot: EstimateSnapshot | null): string[] {
  return snapshot ? ORDER.flatMap((k) => (snapshot[k] ? [line(LABELS[k]!, snapshot[k]!)] : [])) : [];
}

const line = (label: string, v: SnapshotValue) => ('value' in v ? `${label}: ${v.value}` : `${label}: ${v.likely} likely (${v.low} to ${v.high})`);

/** The estimate email (null when the visitor has no estimate to send, e.g. a renter who never ran the calculator). */
export function buildEstimateEmail(
  to: string,
  snapshot: EstimateSnapshot | null,
  stateName: string | null,
  siteUrl = 'https://rayvalue.com',
  /** Unsubscribe link and mailing address for the footer (set when nurture email is configured). */
  footer: { unsubscribeUrl: string; mailingAddress: string } | null = null,
): EmailMessage | null {
  const rows = estimateLines(snapshot);
  if (!rows.length) return null;
  const calc = stateName ? `${siteUrl}/calculator/${stateName.toLowerCase()}` : siteUrl;
  return {
    to,
    subject: 'Your RayValue solar estimate',
    text: [
      'Here is the solar estimate you asked us to email you.',
      '',
      ...rows,
      '',
      'These are ranges, not a quote. No federal tax credit is applied. Installer prices and your actual usage will differ.',
      `Run it again or change your answers: ${calc}`,
      `How we calculate: ${siteUrl}/methodology`,
      '',
      'You are getting this because you asked for it on rayvalue.com and agreed to occasional solar updates.',
      `To stop emails or delete your data: ${siteUrl}/privacy/request`,
      ...(footer ? [`Unsubscribe: ${footer.unsubscribeUrl}`, `RayValue, ${footer.mailingAddress}`] : []),
    ].join('\n'),
    ...(footer ? { headers: unsubscribeHeaders(footer.unsubscribeUrl) } : {}),
  };
}

/** RFC 8058 one-click unsubscribe headers (the /unsubscribe page accepts the POST). */
export const unsubscribeHeaders = (url: string): Record<string, string> => ({
  'List-Unsubscribe': `<${url}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});
