/** Admin leads page and CSV: access guard and database calls (server only; uses SUPABASE_SECRET_KEY). */
import { adminConfigured, checkBasicAuth } from '../admin/auth';
import { ADMIN_SELECT, EXPORT_LIMIT, LIST_LIMIT, type AdminLead } from '../admin/leads';
import type { LeadStatus } from '../routing/eligibility';
import { adminSelect, adminUpdate, type AdminEnv } from './admin-db';
import { clientIp } from './http';
import { ADMIN_FAIL_LIMIT, allowRequest } from './rate-limit';

export interface AdminPageEnv extends AdminEnv {
  ADMIN_PASSWORD?: string;
}

export const NOINDEX_HEADERS = { 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Cache-Control': 'no-store' } as const;

/**
 * null = authorized. Otherwise the Response to send: 404 when admin is not configured (the page does not exist),
 * 401 with a Basic challenge for a missing/wrong password, 429 after too many wrong passwords from one IP.
 */
export async function guardAdmin(request: Request, env: AdminPageEnv, fetchImpl: typeof fetch = fetch): Promise<Response | null> {
  if (!adminConfigured(env.ADMIN_PASSWORD)) return new Response('Not found', { status: 404, headers: NOINDEX_HEADERS });
  const header = request.headers.get('authorization');
  if (header && checkBasicAuth(header, env.ADMIN_PASSWORD)) return null;
  // Count only failed or missing credentials, so a correct password is never locked out by its own successes.
  if (header && !(await allowRequest(env, 'admin-fail', clientIp(request), ADMIN_FAIL_LIMIT.windowSeconds, ADMIN_FAIL_LIMIT.max, fetchImpl))) {
    return new Response('Too many attempts', { status: 429, headers: { ...NOINDEX_HEADERS, 'Retry-After': String(ADMIN_FAIL_LIMIT.windowSeconds) } });
  }
  return new Response('Authentication required', { status: 401, headers: { ...NOINDEX_HEADERS, 'WWW-Authenticate': 'Basic realm="RayValue admin", charset="UTF-8"' } });
}

/** Newest leads (optionally one status) with their deliveries. null on database failure. */
export async function fetchAdminLeads(env: AdminEnv, status: LeadStatus | null, fetchImpl: typeof fetch = fetch, limit = LIST_LIMIT): Promise<AdminLead[] | null> {
  return adminSelect<AdminLead>(env, 'leads', { select: ADMIN_SELECT, order: 'created_at.desc', limit: String(Math.min(limit, EXPORT_LIMIT)), ...(status ? { status: `eq.${status}` } : {}) }, fetchImpl);
}

/** Mark a sent lead returned with a reason note. 'ok' | 'not_sent' (wrong status or unknown id) | 'error'. */
export async function markLeadReturned(env: AdminEnv, id: string, reason: string, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<'ok' | 'not_sent' | 'error'> {
  const n = await adminUpdate(env, 'leads', { id: `eq.${id}`, status: 'eq.sent' }, { status: 'returned', returned_at: now.toISOString(), return_reason: reason }, fetchImpl);
  return n === null ? 'error' : n === 0 ? 'not_sent' : 'ok';
}
