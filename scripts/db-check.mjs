// Validates every calculator table in the LIVE database exactly as the site reads it:
// publishable key -> PostgREST -> src/lib/db mappers -> Zod schemas, plus cross-table checks.
//   npm run db:check        (reads SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY; npm loads .env.local)
// Exits 1 if anything is invalid or unreachable. Run before deploying and after editing values.
import { createRepo } from '../src/lib/db/repo.ts';

const repo = createRepo();
const problems = [];
const report = (what, r) => {
  if (r.ok) return r.value;
  problems.push(`${what}: ${r.error.kind}: ${r.error.message}${r.error.issues ? `\n      ${r.error.issues.join('\n      ')}` : ''}`);
  return null;
};

const utilities = report('utilities', await repo.loadUtilities());
const cities = report('cities', await repo.loadCities());
const summary = [];
for (const state of ['FL', 'CA']) {
  const cfg = report(`calc config ${state}`, await repo.loadCalcConfig(state));
  const production = report(`pvwatts_city_production ${state}`, await repo.loadProduction(state));
  if (cfg) summary.push(`${state}: ${cfg.utilities.length} utilities, offer ${cfg.offer ? cfg.offer.partner_name : 'none'}`);
  if (production) summary.push(`${state}: ${production.length} production rows`);
  if (cfg && production && cities) {
    const losses = new Set(Object.values(cfg.assumptions.pvwatts_system_loss_pct).filter((v) => typeof v === 'number'));
    const known = new Set(cities.map((c) => `${c.state}/${c.slug}`));
    for (const p of production) {
      if (!losses.has(p.losses)) problems.push(`pvwatts_city_production ${p.state}/${p.slug}@${p.losses}: losses is not a pvwatts_system_loss_pct value`);
      if (!known.has(`${p.state}/${p.slug}`)) problems.push(`pvwatts_city_production ${p.state}/${p.slug}: unknown city`);
    }
  }
}
if (utilities && cities) {
  for (const c of cities) {
    const u = utilities.find((x) => x.id === c.default_utility_id);
    if (!u) problems.push(`cities ${c.state}/${c.slug}: default_utility_id ${c.default_utility_id} does not exist`);
    else if (u.state !== c.state) problems.push(`cities ${c.state}/${c.slug}: default utility ${u.id} is in ${u.state}`);
  }
  for (const s of ['FL', 'CA']) if (!cities.some((c) => c.state === s)) problems.push(`cities: none in ${s}`);
  summary.push(`${utilities.length} utilities, ${cities.length} cities in total`);
}

if (problems.length) {
  console.error(`db:check FAILED (${problems.length})`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('db:check OK');
for (const s of summary) console.log(`  ${s}`);
