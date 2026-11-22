/**
 * Load country-pack city data into `places` and `place_facts` (migration 0033). Idempotent: places upsert on
 * (country, region_code, slug) WITHOUT touching `published` (new rows are unpublished; the owner publishes), facts upsert
 * on (place_id, key, period, unit). Only facts with a source_url, a value and a retrieved_on date are imported; secondary
 * confidence is kept and flagged.
 *
 *   npm run places:import -- --dir <packs dir> --dry-run     # plan + 3-section gate report, no network, no env
 *   npm run places:import -- --dir <packs dir>               # needs SUPABASE_URL + SUPABASE_SECRET_KEY
 *   options: --country gb|de|au (repeatable)
 *
 * Optional pack files written by `npm run places:fetch-yield`: <dir>/<cc>/places_coords.csv, places_yield.csv. Their PVGIS
 * rows replace the pack's own yield rows. Run the fetch first (the dry run then reports the real gate numbers).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coordsFromCsv, planCountry, type CountryPlan } from '../../src/lib/places/import-plan';
import { packFactsFromCsv, parsePackPlaces, regionsFromMigration } from '../../src/lib/places/pack';
import type { PlaceCountryCode } from '../../src/lib/places/config';
import { selectAll, postRows } from '../../src/lib/scrape/store';

const arg = (name: string): string[] => process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
const dir = arg('dir')[0] ?? process.env.RVPLAN_COUNTRIES_DIR;
const dry = process.argv.includes('--dry-run');
const only = new Set(arg('country'));
if (!dir || !existsSync(dir)) {
  console.error('usage: import-pack --dir <countries dir> [--dry-run] [--country gb|de|au]');
  process.exit(2);
}

const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY };
if (!dry && (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)) {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY are required (use --dry-run to only plan).');
  process.exit(2);
}

// Regions: from the database on a real run, from the migration seed on a dry run (no network).
let regions: { country: string; code: string; name: string; slug: string }[];
if (dry) {
  regions = regionsFromMigration(readFileSync(new URL('../../supabase/migrations/0033_places.sql', import.meta.url), 'utf8'));
} else {
  const rows = await selectAll<{ country: string; code: string; name: string; slug: string }>(env as never, 'regions', { select: 'country,code,name,slug', order: 'country,code' }, fetch, 5);
  if (!rows) throw new Error('could not read regions (is migration 0033 applied?)');
  regions = rows;
}

const COUNTRIES: Record<string, PlaceCountryCode> = { gb: 'GB', de: 'DE', au: 'AU' };
const plans: CountryPlan[] = [];
for (const [d, cc] of Object.entries(COUNTRIES)) {
  if (only.size && !only.has(d)) continue;
  const root = join(dir, d);
  const read = (f: string): string | null => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : null);
  const pages = read('pages.csv');
  const facts = read('facts.csv');
  if (!pages || !facts) { console.warn(`skip ${cc}: pages.csv / facts.csv missing in ${root}`); continue; }
  const yieldCsv = read('places_yield.csv');
  const coordsCsv = read('places_coords.csv');
  if (!yieldCsv) console.warn(`${cc}: no places_yield.csv; using the pack's own yield rows (run places:fetch-yield for PVGIS monthly data and the chart)`);
  plans.push(planCountry(cc, parsePackPlaces(cc, pages), regions, packFactsFromCsv(facts), yieldCsv ? packFactsFromCsv(yieldCsv) : [], coordsCsv ? coordsFromCsv(coordsCsv) : []));
}

console.log(dry ? 'DRY RUN (no database access)' : 'IMPORT');
console.table(plans.map((p) => ({
  country: p.country, places: p.places.length, withCoords: p.places.filter((x) => x.lat !== null).length, facts: p.facts.length,
  secondary: p.facts.filter((f) => f.confidence === 'secondary').length, passGate: p.gate.pass, failGate: p.gate.fail,
})));
for (const p of plans) {
  console.log(`${p.country}: places by number of sourced sections`, p.gate.bySectionCount, 'section totals', p.gate.sectionTotals);
  if (p.unknownRegion.length) console.warn(`${p.country}: ${p.unknownRegion.length} places skipped, region not in regions table: ${p.unknownRegion.slice(0, 5).join(', ')}`);
  console.log(`${p.country}: pack rows not imported`, p.skippedFacts);
}
if (dry) process.exit(0);

for (const p of plans) {
  await postRows(env as never, 'places', p.places, 'country,region_code,slug', false); // `published` is never sent: existing rows keep it
  const ids = await selectAll<{ id: string; region_code: string; slug: string }>(env as never, 'places', { select: 'id,region_code,slug', country: `eq.${p.country}`, order: 'id' }, fetch, 20);
  if (!ids) throw new Error('could not read places back');
  const idOf = new Map(ids.map((r) => [`${r.region_code}/${r.slug}`, r.id]));
  const regionCodeBySlug = new Map(regions.filter((r) => r.country === p.country).map((r) => [r.slug, r.code]));
  const rows = p.facts.flatMap((f) => {
    const [, regionSlug, slug] = f.place.split('/');
    const id = idOf.get(`${regionCodeBySlug.get(regionSlug!)}/${slug}`);
    if (!id) return [];
    const { place: _place, ...rest } = f;
    return [{ ...rest, place_id: id }];
  });
  await postRows(env as never, 'place_facts', rows, 'place_id,key,period,unit', false);
  console.log(`${p.country}: ${p.places.length} places, ${rows.length} facts upserted`);
}
