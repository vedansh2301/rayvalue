/**
 * Unsubscribe links for nurture email. A token is `<kind>.<row id>.<HMAC>` (kind e = estimate_requests,
 * l = leads), signed with UNSUBSCRIBE_SECRET, so a link can only be made by us and carries no email address.
 * Using it adds the address to email_suppressions (which the nurture job checks for every recipient, whichever
 * table the address came from) and marks the person's estimate requests unsubscribed. SERVER ONLY.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { adminInsert, adminSelect, adminUpdate, type AdminEnv } from './admin-db';

export type TokenKind = 'e' | 'l';
const TABLE: Record<TokenKind, string> = { e: 'estimate_requests', l: 'leads' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MIN_SECRET_LENGTH = 16;

const mac = (kind: TokenKind, id: string, secret: string) => createHmac('sha256', secret).update(`unsub:${kind}:${id}`).digest('base64url').slice(0, 32);

export function signUnsubscribeToken(kind: TokenKind, id: string, secret: string): string {
  return `${kind}.${id}.${mac(kind, id, secret)}`;
}

export function verifyUnsubscribeToken(token: unknown, secret: string | undefined): { kind: TokenKind; id: string } | null {
  if (typeof token !== 'string' || token.length > 120 || !secret || secret.length < MIN_SECRET_LENGTH) return null;
  const [kind, id, sig, extra] = token.split('.');
  if (extra !== undefined || (kind !== 'e' && kind !== 'l') || !id || !UUID_RE.test(id) || !sig) return null;
  const want = Buffer.from(mac(kind, id, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { kind, id: id.toLowerCase() };
}

export const unsubscribeUrl = (siteUrl: string, token: string) => `${siteUrl}/unsubscribe?t=${encodeURIComponent(token)}`;

export type UnsubscribeResult = 'ok' | 'invalid' | 'error';

export async function applyUnsubscribe(env: AdminEnv & { UNSUBSCRIBE_SECRET?: string }, token: unknown, fetchImpl: typeof fetch = fetch): Promise<UnsubscribeResult> {
  const t = verifyUnsubscribeToken(token, env.UNSUBSCRIBE_SECRET);
  if (!t) return 'invalid';
  const rows = await adminSelect<{ email: string }>(env, TABLE[t.kind], { select: 'email', id: `eq.${t.id}` }, fetchImpl);
  if (rows === null) return 'error';
  const email = rows[0]?.email;
  if (!email) return 'invalid';
  const ins = await adminInsert(env, 'email_suppressions', { email: email.toLowerCase(), reason: 'unsubscribe' }, fetchImpl, 'email');
  if (ins === null) return 'error'; // conflict (already suppressed) is fine
  // Best effort: also mark the person's estimate sign-ups, so the rest of the data shows the opt-out.
  await adminUpdate(env, 'estimate_requests', { email: `eq.${email}`, unsubscribed_at: 'is.null' }, { nurture: false, unsubscribed_at: new Date().toISOString() }, fetchImpl);
  return 'ok';
}
