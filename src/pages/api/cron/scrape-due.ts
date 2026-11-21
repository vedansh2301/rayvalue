import type { APIRoute } from 'astro';
import { cronGuard, cronJson } from '../../../lib/server/cron';
import { Fetcher } from '../../../lib/scrape/fetcher';
import { runDue } from '../../../lib/scrape/pipeline';
import { dbStore } from '../../../lib/scrape/store';

export const prerender = false;

const BATCH = 6;

/**
 * GET /api/cron/scrape-due — fetches a few due sources (policy / tariff pages, PDFs, feeds), detects content
 * changes, re-checks staged facts and ingests news. pg_cron calls it every 10 minutes (migration 0031) with the
 * Bearer CRON_SECRET. Stays inside the 60 s function limit: no new source starts after 28 s and fetches stop
 * waiting at 52 s. Never writes to published tables. The reply holds counts only.
 */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronGuard(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY };
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return cronJson(503, { ok: false, error: 'database not configured' });

  const t0 = Date.now();
  try {
    const { processed, remainingDue } = await runDue({
      store: dbStore(env),
      fetcher: new Fetcher({ timeoutMs: 8000, retries: 1, backoffMs: 500 }),
      limit: BATCH,
      startCutoff: t0 + 28_000,
      deadline: t0 + 52_000,
    });
    const count = (o: string) => processed.filter((p) => p.outcome === o).length;
    return cronJson(200, {
      ok: true,
      processed: processed.length,
      remainingDue,
      changed: count('changed') + count('first_fetch'),
      errors: count('error'),
      blocked: count('blocked'),
      factsConfirmed: processed.reduce((n, p) => n + p.factsConfirmed, 0),
      factsChanged: processed.reduce((n, p) => n + p.factsChanged, 0),
      newsItems: processed.reduce((n, p) => n + p.newsItems, 0),
      ms: Date.now() - t0,
    });
  } catch (e) {
    console.error('scrape-due failed', e instanceof Error ? e.message : 'error');
    return cronJson(500, { ok: false, error: 'scrape run failed' });
  }
};
