/** PostgREST-backed Store (service role). Server / script only: needs SUPABASE_URL + SUPABASE_SECRET_KEY. */
import { adminHeaders, adminSelect, adminSelectAll, adminUpdate, adminUpsert, DB_TIMEOUT_MS, type AdminEnv } from '../server/admin-db';
import type { NewsRow } from './news';
import type { FactRow, SnapshotRow, SourceRow, Store } from './pipeline';

const SOURCE_COLS = 'id,country,url,type,access,robots_ok,language,cadence_days,content_hash,etag,last_modified,consecutive_failures';

export function dbStore(env: AdminEnv, f: typeof fetch = fetch): Store {
  const must = <T>(v: T | null, what: string): T => {
    if (v === null) throw new Error(`database call failed: ${what}`);
    return v;
  };
  return {
    async listDue(limit, now) {
      const rows = await adminSelect<SourceRow>(env, 'sources', { select: SOURCE_COLS, active: 'eq.true', or: `(next_due_at.is.null,next_due_at.lte.${now.toISOString()})`, order: 'next_due_at.asc.nullsfirst', limit: String(limit) }, f);
      return must(rows, 'list due sources');
    },
    async claim(id, until) {
      must(await adminUpdate(env, 'sources', { id: `eq.${id}` }, { next_due_at: until.toISOString() }, f), 'claim source');
    },
    async updateSource(id, patch) {
      must(await adminUpdate(env, 'sources', { id: `eq.${id}` }, patch, f), 'update source');
    },
    async insertSnapshot(row: SnapshotRow) {
      if (!(await adminUpsert(env, 'source_snapshots', row, 'source_id,content_hash', f))) throw new Error('database call failed: snapshot');
    },
    async listFacts(sourceId) {
      return must(await adminSelect<FactRow>(env, 'facts_staging', { select: 'id,status,value,unit,excerpt', source_id: `eq.${sourceId}`, limit: '1000' }, f), 'list facts');
    },
    async updateFact(id, patch) {
      must(await adminUpdate(env, 'facts_staging', { id: `eq.${id}` }, patch, f), 'update fact');
    },
    async upsertNews(rows: NewsRow[]) {
      if (rows.length === 0) return;
      if (!(await adminUpsert(env, 'news_items', rows, 'source_id,url', f))) throw new Error('database call failed: news');
    },
  };
}

/** POST rows in chunks. `ignoreDuplicates` keeps existing rows untouched on conflict. Throws on failure. */
export async function postRows(env: AdminEnv, table: string, rows: object[], onConflict: string, ignoreDuplicates: boolean, f: typeof fetch = fetch, chunk = 500): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY not set');
  const base = env.SUPABASE_URL.replace(/\/+$/, '');
  for (let i = 0; i < rows.length; i += chunk) {
    const res = await f(`${base}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST',
      headers: adminHeaders(env.SUPABASE_SECRET_KEY, { Prefer: `resolution=${ignoreDuplicates ? 'ignore' : 'merge'}-duplicates,return=minimal` }),
      body: JSON.stringify(rows.slice(i, i + chunk)),
      signal: AbortSignal.timeout(Math.max(DB_TIMEOUT_MS, 30_000)),
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }
}

export const selectAll = adminSelectAll;
