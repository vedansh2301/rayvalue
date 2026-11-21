/**
 * Load every country pack (<dir>/<cc>/sources.csv + facts.csv) into the sources and facts_staging tables.
 * Idempotent: sources upsert on (country,url) touching only registry columns (never fetch state); facts upsert on
 * natural_key, and a changed value flags the row status='changed' with previous_value instead of overwriting silently.
 *
 *   npm run scrape:import -- --dir <packs dir> --dry-run      # counts only, no network, no env needed
 *   npm run scrape:import -- --dir <packs dir>                # needs SUPABASE_URL + SUPABASE_SECRET_KEY
 *   options: --country de (repeatable), --no-derive (skip sources derived from facts.csv URLs)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { derivedSources, factsFromCsv, planFactUpserts, sourceId, sourcesFromCsv, type ExistingFact, type FactIn, type SourceIn } from '../../src/lib/scrape/import';
import { postRows, selectAll } from '../../src/lib/scrape/store';

function arg(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]!);
  });
  return out;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const dir = arg('dir')[0] ?? process.env.RVPLAN_COUNTRIES_DIR;
if (!dir || !existsSync(dir)) {
  console.error('usage: import-packs --dir <countries dir> [--dry-run] [--country cc] [--no-derive]');
  process.exit(2);
}
const only = new Set(arg('country'));
const dry = flag('dry-run');

const packSources: SourceIn[] = [];
const facts: FactIn[] = [];
const perCountry: Record<string, { sources: number; skippedSources: number; facts: number; skippedFacts: number }> = {};
for (const cc of readdirSync(dir).filter((d) => /^[a-z]{2}$/.test(d) && (only.size === 0 || only.has(d))).sort()) {
  const s = join(dir, cc, 'sources.csv');
  const f = join(dir, cc, 'facts.csv');
  const sr = existsSync(s) ? sourcesFromCsv(cc, readFileSync(s, 'utf8')) : { rows: [], skipped: 0 };
  const fr = existsSync(f) ? factsFromCsv(cc, readFileSync(f, 'utf8')) : { rows: [], skipped: [] };
  packSources.push(...sr.rows);
  facts.push(...fr.rows);
  perCountry[cc] = { sources: sr.rows.length, skippedSources: sr.skipped, facts: fr.rows.length, skippedFacts: fr.skipped.length };
  if (fr.skipped.length) console.warn(`skipped facts ${cc}: ${fr.skipped.slice(0, 5).join(', ')}${fr.skipped.length > 5 ? ' ...' : ''}`);
}
const derived = flag('no-derive') ? [] : derivedSources(facts, new Set(packSources.map((s) => sourceId(s.country, s.url))));

console.log(dry ? 'DRY RUN (no database access)' : 'IMPORT');
console.table(perCountry);
const sum = (k: 'sources' | 'skippedSources' | 'facts' | 'skippedFacts') => Object.values(perCountry).reduce((n, c) => n + c[k], 0);
console.log(`countries: ${Object.keys(perCountry).length}`);
console.log(`sources: ${sum('sources')} from sources.csv (+${sum('skippedSources')} skipped), +${derived.length} derived from facts.csv URLs`);
console.log(`facts: ${sum('facts')} (+${sum('skippedFacts')} skipped)`);
const by = (k: 'access' | 'robots_ok' | 'type') => packSources.reduce<Record<string, number>>((m, s) => ((m[s[k]] = (m[s[k]] ?? 0) + 1), m), {});
console.log('access:', by('access'), 'robots_ok:', by('robots_ok'));

if (dry) process.exit(0);

const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY };
if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY are required (use --dry-run to only count).');
  process.exit(2);
}

await postRows(env, 'sources', packSources, 'country,url', false);
await postRows(env, 'sources', derived, 'country,url', true); // never overwrite a pack row or fetch state
const registry = await selectAll<{ id: string; country: string; url: string }>(env, 'sources', { select: 'id,country,url', order: 'id' }, fetch, 50);
if (!registry) throw new Error('could not read sources back');
const ids = new Map(registry.map((r) => [sourceId(r.country, r.url), r.id]));

const existingRows = await selectAll<ExistingFact>(env, 'facts_staging', { select: 'natural_key,value,valid_to,publisher,retrieved_on,excerpt,confidence', order: 'natural_key' }, fetch, 100);
if (!existingRows) throw new Error('could not read facts_staging');
const plan = planFactUpserts(facts, new Map(existingRows.map((r) => [r.natural_key, r])), ids);

// PostgREST bulk upserts need identical keys per request, so post each shape separately.
const shape = (r: { status?: string; previous_value?: unknown }) => (r.status === 'new' ? 'new' : r.status === 'changed' ? 'changed' : 'meta');
for (const s of ['new', 'changed', 'meta']) {
  const rows = plan.upserts.filter((r) => shape(r) === s);
  if (rows.length) await postRows(env, 'facts_staging', rows, 'natural_key', false);
}
console.log(`facts_staging: ${plan.created} new, ${plan.changedValue} value-changed (flagged), ${plan.metadataOnly} metadata-only, ${plan.unchanged} unchanged`);
