/**
 * Orchestration for one source: fetch -> extract -> change detection -> snapshot -> fact re-check -> news.
 * All I/O goes through `Store` and `Fetcher`, so it is testable with fakes. Published values are never touched:
 * only facts_staging rows change status.
 */
import { extract } from './extract';
import { checkFact } from './factcheck';
import { Fetcher } from './fetcher';
import { toNewsRows, type NewsRow } from './news';
import { contentHash, type Access } from './normalise';

export interface SourceRow {
  id: string;
  country: string;
  url: string;
  type: string;
  access: Access;
  robots_ok: 'yes' | 'no' | 'unknown';
  language: string | null;
  cadence_days: number;
  content_hash: string | null;
  etag: string | null;
  last_modified: string | null;
  consecutive_failures: number;
}
export interface FactRow {
  id: string;
  status: 'new' | 'changed' | 'confirmed' | 'rejected';
  value: string | null;
  unit: string | null;
  excerpt: string | null;
}
export interface SnapshotRow {
  source_id: string;
  content_hash: string;
  fetched_at: string;
  http_status: number;
  byte_length: number;
  text_length: number;
  text_excerpt: string;
}

export interface Store {
  /** Due sources (active, next_due_at null or past), oldest first. */
  listDue(limit: number, now: Date): Promise<SourceRow[]>;
  /** Push next_due_at out so overlapping runs skip this source. */
  claim(id: string, until: Date): Promise<void>;
  updateSource(id: string, patch: Record<string, unknown>): Promise<void>;
  insertSnapshot(row: SnapshotRow): Promise<void>;
  listFacts(sourceId: string): Promise<FactRow[]>;
  updateFact(id: string, patch: Record<string, unknown>): Promise<void>;
  upsertNews(rows: NewsRow[]): Promise<void>;
}

export type Outcome = 'unchanged' | 'changed' | 'first_fetch' | 'not_modified' | 'blocked' | 'unsupported' | 'error';
export interface ProcessResult {
  id: string;
  url: string;
  outcome: Outcome;
  status: number;
  factsConfirmed: number;
  factsChanged: number;
  newsItems: number;
}

const DAY = 86_400_000;
export const STATUS_BLOCKED = -1;
export const STATUS_UNSUPPORTED = -2;

export async function processSource(src: SourceRow, deps: { fetcher: Fetcher; store: Store; now?: () => Date; deadline?: number }): Promise<ProcessResult> {
  const { fetcher, store } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const iso = now.toISOString();
  const due = (days: number) => new Date(now.getTime() + days * DAY).toISOString();
  const result: ProcessResult = { id: src.id, url: src.url, outcome: 'error', status: 0, factsConfirmed: 0, factsChanged: 0, newsItems: 0 };
  const fetched = { last_fetched_at: iso, updated_at: iso };

  if (src.robots_ok === 'no') {
    await store.updateSource(src.id, { ...fetched, last_status: STATUS_BLOCKED, last_error: 'registry says robots_ok=no', next_due_at: due(Math.max(src.cadence_days, 30)) });
    return { ...result, outcome: 'blocked', status: STATUS_BLOCKED };
  }
  if (src.access === 'xlsx') {
    await store.updateSource(src.id, { ...fetched, last_status: STATUS_UNSUPPORTED, last_error: 'xlsx is not extracted', next_due_at: due(Math.max(src.cadence_days, 30)) });
    return { ...result, outcome: 'unsupported', status: STATUS_UNSUPPORTED };
  }

  const res = await fetcher.get(src.url, { etag: src.etag, lastModified: src.last_modified, deadline: deps.deadline });

  if (res.kind === 'blocked') {
    await store.updateSource(src.id, { ...fetched, last_status: STATUS_BLOCKED, last_error: res.reason, next_due_at: due(Math.max(src.cadence_days, 7)) });
    return { ...result, outcome: 'blocked', status: STATUS_BLOCKED };
  }
  if (res.kind === 'error') {
    const failures = src.consecutive_failures + 1;
    // Back off 1, 2, 3 ... days (never longer than the cadence) so a dead URL does not eat the batch.
    await store.updateSource(src.id, { ...fetched, last_status: res.status, last_error: res.error, consecutive_failures: failures, next_due_at: due(Math.min(failures, Math.max(1, src.cadence_days))) });
    return { ...result, outcome: 'error', status: res.status };
  }
  if (res.kind === 'not_modified') {
    await store.updateSource(src.id, { ...fetched, last_status: 304, last_error: null, consecutive_failures: 0, next_due_at: due(src.cadence_days) });
    return { ...result, outcome: 'not_modified', status: 304 };
  }

  const ex = await extract(res.body, res.contentType, src.access, res.finalUrl).catch((e: unknown) => ({ error: e instanceof Error ? e.message.slice(0, 160) : 'extract failed' }));
  if ('error' in ex) {
    await store.updateSource(src.id, { ...fetched, last_status: res.status, last_error: `extract: ${ex.error}`, consecutive_failures: src.consecutive_failures + 1, next_due_at: due(src.cadence_days) });
    return { ...result, outcome: 'error', status: res.status };
  }
  if (ex.format === 'unsupported' || ex.text === '') {
    await store.updateSource(src.id, { ...fetched, last_status: STATUS_UNSUPPORTED, last_error: ex.format === 'unsupported' ? 'unsupported content type' : 'no extractable text (scanned PDF or JS-rendered page)', next_due_at: due(Math.max(src.cadence_days, 30)) });
    return { ...result, outcome: 'unsupported', status: STATUS_UNSUPPORTED };
  }

  const hash = contentHash(ex.text);
  const previouslySeen = src.content_hash !== null;
  const changed = hash !== src.content_hash;
  const base = { ...fetched, last_status: res.status, last_error: null, consecutive_failures: 0, next_due_at: due(src.cadence_days), etag: res.etag, last_modified: res.lastModified };

  if (changed) {
    await store.insertSnapshot({ source_id: src.id, content_hash: hash, fetched_at: iso, http_status: res.status, byte_length: res.body.byteLength, text_length: ex.text.length, text_excerpt: ex.text.slice(0, 4000) });
    await store.updateSource(src.id, { ...base, content_hash: hash, last_changed_at: iso });
  } else {
    await store.updateSource(src.id, base);
  }

  // Re-check facts: everything when the page changed (or is seen for the first time), only still-unchecked facts otherwise.
  const facts = (await store.listFacts(src.id)).filter((f) => f.status !== 'rejected' && (changed || f.status === 'new'));
  for (const f of facts) {
    const v = checkFact({ value: f.value, unit: f.unit, excerpt: f.excerpt }, ex.text);
    const stamp = { checked_by: 'auto:factcheck', checked_at: iso, updated_at: iso };
    if (v.verdict === 'match') {
      if (f.status !== 'confirmed') await store.updateFact(f.id, { ...stamp, status: 'confirmed', check_note: v.reason });
      result.factsConfirmed++;
    } else if (v.verdict === 'mismatch' || (previouslySeen && changed)) {
      // The live page disagrees with the stored value, or the page changed and no longer supports it: a human re-checks.
      await store.updateFact(f.id, { ...stamp, status: 'changed', check_note: `${previouslySeen && changed ? 'source changed; ' : ''}${v.verdict}: ${v.reason}` });
      result.factsChanged++;
    } else {
      await store.updateFact(f.id, { ...stamp, check_note: `${v.verdict}: ${v.reason}` });
    }
  }

  if (ex.format === 'feed' && changed) {
    const rows = toNewsRows(ex.feedItems, { id: src.id, country: src.country, language: src.language });
    await store.upsertNews(rows);
    result.newsItems = rows.length;
  }

  return { ...result, outcome: !changed ? 'unchanged' : previouslySeen ? 'changed' : 'first_fetch', status: res.status };
}

export interface RunOptions {
  store: Store;
  fetcher: Fetcher;
  limit: number;
  /** Epoch ms; no new source starts after startCutoff, and in-flight fetches stop waiting at deadline. */
  startCutoff: number;
  deadline: number;
  now?: () => Date;
  /** Claim window so overlapping runs skip a source being processed. */
  claimMinutes?: number;
}

export async function runDue(o: RunOptions): Promise<{ processed: ProcessResult[]; remainingDue: boolean }> {
  const clock = o.now ?? (() => new Date());
  const due = await o.store.listDue(o.limit, clock());
  const processed: ProcessResult[] = [];
  for (const src of due) {
    if (clock().getTime() > o.startCutoff) break;
    await o.store.claim(src.id, new Date(clock().getTime() + (o.claimMinutes ?? 30) * 60_000));
    processed.push(await processSource(src, { fetcher: o.fetcher, store: o.store, now: o.now, deadline: o.deadline }));
  }
  return { processed, remainingDue: processed.length < due.length };
}
