/**
 * Process due sources from the command line (same code path as /api/cron/scrape-due, no 60 s limit).
 *   npm run scrape:run -- --limit 20
 * Needs SUPABASE_URL + SUPABASE_SECRET_KEY. Writes only sources, source_snapshots, facts_staging, news_items.
 */
import { Fetcher } from '../../src/lib/scrape/fetcher';
import { runDue } from '../../src/lib/scrape/pipeline';
import { dbStore } from '../../src/lib/scrape/store';

const i = process.argv.indexOf('--limit');
const limit = i > 0 ? Math.max(1, Math.min(500, Number(process.argv[i + 1]) || 10)) : 10;
const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY };
if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
  process.exit(2);
}
const far = Date.now() + 6 * 3600_000;
const { processed } = await runDue({ store: dbStore(env), fetcher: new Fetcher(), limit, startCutoff: far, deadline: far });
for (const p of processed) console.log(`${p.outcome.padEnd(12)} ${String(p.status).padStart(4)}  +${p.factsConfirmed} confirmed ${p.factsChanged} changed ${p.newsItems} news  ${p.url}`);
console.log(`${processed.length} source(s) processed`);
