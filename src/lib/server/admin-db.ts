/**
 * Server-only PostgREST helpers that use SUPABASE_SECRET_KEY (service_role). Used where the publishable (anon) key
 * is deliberately not enough: writing leads, estimate requests and verification state, reading a lead's phone for
 * the OTP. The key is read from process.env on the server only and never reaches client code or logs.
 */
export interface AdminEnv {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

export const DB_TIMEOUT_MS = 8000;

const base = (url: string) => url.replace(/\/+$/, '');

export function adminHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: key, 'Content-Type': 'application/json', ...extra };
}

/** INSERT one row, returning the columns in `returning` (default "id"). Result: the row, 'conflict' for 409, or null on any other failure. */
export async function adminInsert<T extends object = { id: string }>(
  env: AdminEnv,
  table: string,
  row: object,
  fetchImpl: typeof fetch,
  returning = 'id',
): Promise<{ row: T } | { conflict: { code: string | null } } | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  try {
    const res = await fetchImpl(`${base(env.SUPABASE_URL)}/rest/v1/${table}?select=${encodeURIComponent(returning)}`, {
      method: 'POST',
      headers: adminHeaders(env.SUPABASE_SECRET_KEY, { Prefer: 'return=representation' }),
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    if (res.status === 409) {
      const code = ((await res.json().catch(() => null)) as { code?: unknown } | null)?.code;
      return { conflict: { code: typeof code === 'string' ? code : null } };
    }
    if (!res.ok) {
      console.error(`${table}: supabase status ${res.status}`);
      return null;
    }
    const body = (await res.json().catch(() => null)) as T[] | null;
    return Array.isArray(body) && body[0] ? { row: body[0] } : null;
  } catch (e) {
    console.error(`${table}: supabase request failed`, e instanceof Error ? e.name : 'error');
    return null;
  }
}

/** SELECT rows with PostgREST filters (e.g. { id: 'eq.<uuid>', select: 'phone' }). null on failure. */
export async function adminSelect<T>(env: AdminEnv, table: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<T[] | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  const u = new URL(`${base(env.SUPABASE_URL)}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  try {
    const res = await fetchImpl(u.toString(), { headers: { apikey: env.SUPABASE_SECRET_KEY, Accept: 'application/json' }, signal: AbortSignal.timeout(DB_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`${table}: supabase status ${res.status}`);
      return null;
    }
    const body = await res.json().catch(() => null);
    return Array.isArray(body) ? (body as T[]) : null;
  } catch (e) {
    console.error(`${table}: supabase request failed`, e instanceof Error ? e.name : 'error');
    return null;
  }
}

/** PATCH rows matching `filter`; returns how many rows were changed (0 when the filter did not match), or null on failure. */
export async function adminUpdate(env: AdminEnv, table: string, filter: Record<string, string>, patch: object, fetchImpl: typeof fetch): Promise<number | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  const u = new URL(`${base(env.SUPABASE_URL)}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(filter)) u.searchParams.set(k, v);
  u.searchParams.set('select', 'id');
  try {
    const res = await fetchImpl(u.toString(), {
      method: 'PATCH',
      headers: adminHeaders(env.SUPABASE_SECRET_KEY, { Prefer: 'return=representation' }),
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`${table}: supabase status ${res.status}`);
      return null;
    }
    const body = await res.json().catch(() => null);
    return Array.isArray(body) ? body.length : null;
  } catch (e) {
    console.error(`${table}: supabase request failed`, e instanceof Error ? e.name : 'error');
    return null;
  }
}

/** INSERT ... ON CONFLICT (`onConflict`) DO UPDATE one row. true when written, false on any failure. */
export async function adminUpsert(env: AdminEnv, table: string, row: object, onConflict: string, fetchImpl: typeof fetch): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return false;
  try {
    const res = await fetchImpl(`${base(env.SUPABASE_URL)}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST',
      headers: adminHeaders(env.SUPABASE_SECRET_KEY, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`${table}: supabase status ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error(`${table}: supabase request failed`, e instanceof Error ? e.name : 'error');
    return false;
  }
}

const PAGE_SIZE = 1000;

/** SELECT every matching row, paging with limit/offset (Supabase returns at most 1000 rows per request). null on failure. */
export async function adminSelectAll<T>(env: AdminEnv, table: string, params: Record<string, string>, fetchImpl: typeof fetch, maxPages = 20): Promise<T[] | null> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await adminSelect<T>(env, table, { ...params, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) }, fetchImpl);
    if (rows === null) return null;
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}
