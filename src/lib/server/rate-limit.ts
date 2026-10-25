/**
 * Best-effort rate limiting without Vercel Pro: a Postgres fixed-window counter (function rate_limit_hit, migration
 * 0007) keyed by a hash of scope + IP, so raw IPs are never stored. Shared by all function instances (unlike an
 * in-memory counter). Fails OPEN (allows the request) if the database cannot be reached, so an outage never blocks
 * real people; the Vercel Firewall rule on /api/ (see docs/LAUNCH.md) is the outer limit.
 */
import { createHash } from 'node:crypto';
import { DB_TIMEOUT_MS, adminHeaders, type AdminEnv } from './admin-db';

export const rateLimitKey = (scope: string, ip: string): string => `${scope}:${createHash('sha256').update(`${scope}|${ip}`).digest('hex').slice(0, 40)}`;

/** true = allowed. No IP (header absent) = allowed: a shared "unknown" bucket would block everyone together. */
export async function allowRequest(env: AdminEnv, scope: string, ip: string | null, windowSeconds: number, max: number, fetchImpl: typeof fetch): Promise<boolean> {
  if (!ip || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return true;
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: adminHeaders(env.SUPABASE_SECRET_KEY),
      body: JSON.stringify({ p_key: rateLimitKey(scope, ip), p_window_seconds: windowSeconds, p_max: max }),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`rate_limit_hit: supabase status ${res.status}`);
      return true;
    }
    return (await res.json().catch(() => true)) !== false;
  } catch (e) {
    console.error('rate_limit_hit: request failed', e instanceof Error ? e.name : 'error');
    return true;
  }
}

/** Limits per client IP. The lead form is a handful of submits at most per person. */
export const LEAD_LIMIT = { windowSeconds: 600, max: 8 } as const;
export const ADMIN_FAIL_LIMIT = { windowSeconds: 900, max: 10 } as const;
