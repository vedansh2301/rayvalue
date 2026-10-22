/**
 * Tiny read-only PostgREST client (no supabase-js). SERVER-ONLY: the site uses
 * SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY, which RLS limits to SELECT on reference tables.
 * Admin scripts may pass a different key (they read it from their own env); site code never does.
 */

export interface DbEnv {
  /** Project URL, e.g. https://<ref>.supabase.co */
  url: string;
  /** API key sent as the `apikey` header. */
  key: string;
}

export type DbErrorKind = 'not_configured' | 'network' | 'http' | 'bad_response' | 'invalid' | 'not_found';

export interface DbError {
  kind: DbErrorKind;
  /** Short, log-safe description (never contains the key). */
  message: string;
  /** Zod issue summaries for `invalid`. */
  issues?: string[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DbError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (kind: DbErrorKind, message: string, issues?: string[]): { ok: false; error: DbError } => ({
  ok: false,
  error: issues ? { kind, message, issues } : { kind, message },
});

export const DB_TIMEOUT_MS = 8000;

/**
 * Site runtime env (publishable key). Works under Astro/Vite (import.meta.env) and plain Node (process.env).
 * Returns null when either variable is missing.
 */
export function siteDbEnv(): DbEnv | null {
  // process.env first (Vercel Functions runtime); import.meta.env covers `astro dev` reading .env.local.
  // import.meta.env is undefined when an admin script runs this file with plain Node.
  const proc: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {};
  const url = proc.SUPABASE_URL || import.meta.env?.SUPABASE_URL;
  const key = proc.SUPABASE_PUBLISHABLE_KEY || import.meta.env?.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

/** Build the REST URL for `table` with PostgREST query params (select, filters, order). */
export function restUrl(env: DbEnv, table: string, params: Record<string, string>): string {
  const u = new URL(`${env.url.replace(/\/+$/, '')}/rest/v1/${encodeURIComponent(table)}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** GET rows from a table or view. Never throws. */
export async function selectRows<T>(
  env: DbEnv | null,
  table: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<T[]>> {
  if (!env) return err('not_configured', 'SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not set');
  let res: Response;
  try {
    res = await fetchImpl(restUrl(env, table, params), {
      headers: { apikey: env.key, Accept: 'application/json' },
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
  } catch (e) {
    return err('network', `${table}: request failed (${e instanceof Error ? e.name : 'error'})`);
  }
  if (!res.ok) return err('http', `${table}: HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return err('bad_response', `${table}: response is not JSON`);
  }
  if (!Array.isArray(body)) return err('bad_response', `${table}: expected an array of rows`);
  return ok(body as T[]);
}
