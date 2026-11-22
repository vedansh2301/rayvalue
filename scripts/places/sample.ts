/**
 * Prints the page a place WOULD render (headings, lines with sources) from a pack, offline: the same plan the import builds,
 * run through the real view model with every place treated as published. Used to eyeball one place per country.
 *
 *   npx tsx scripts/places/sample.ts --dir <packs dir> --country es --place almeria
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLACE_COUNTRIES, placeCountryByCode } from '../../src/lib/places/config';
import { coordsFromCsv, planCountry } from '../../src/lib/places/import-plan';
import { packFactsFromCsv, parsePackPlaces, regionsFromMigration } from '../../src/lib/places/pack';
import type { PlaceFact, PlaceWithFacts } from '../../src/lib/places/schema';
import { buildPlaceView } from '../../src/lib/places/view';

const arg = (name: string): string | undefined => process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]!] : []))[0];
const dir = arg('dir') ?? process.env.RVPLAN_COUNTRIES_DIR;
const cc = (arg('country') ?? '').toUpperCase();
const slug = arg('place');
const country = PLACE_COUNTRIES.find((c) => c.code === cc);
if (!dir || !country || !slug) { console.error('usage: sample --dir <packs dir> --country es --place almeria'); process.exit(2); }

const root = join(dir, cc.toLowerCase());
const read = (f: string): string => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '');
const regions = ['0033_places.sql', '0034_places_europe.sql'].flatMap((f) => regionsFromMigration(readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')));
const plan = planCountry(country.code, parsePackPlaces(country.code, read('pages.csv')), regions, packFactsFromCsv(read('facts.csv')), packFactsFromCsv(read('places_yield.csv')), coordsFromCsv(read('places_coords.csv')));
const p = plan.places.find((x) => x.slug === slug);
if (!p) { console.error(`no place ${slug}; try ${plan.places.slice(0, 5).map((x) => x.slug).join(', ')}`); process.exit(1); }
const region = regions.find((r) => r.country === cc && r.code === p.region_code)!;
const facts: PlaceFact[] = plan.facts.filter((f) => f.place === `${cc}/${region.slug}/${slug}`).map(({ place: _p, ...f }) => ({ ...f, status: 'agent_sourced' as const }));
const place: PlaceWithFacts = { id: 'sample', country: cc, region_code: p.region_code, slug, name: p.name, lat: null, lon: null, published: true, updated_at: null, place_facts: facts };
const view = buildPlaceView(place, region);
if (!view) { console.log(`${cc}/${slug}: does NOT pass the gate`); process.exit(0); }
console.log(`https://rayvalue.com${view.path}  (lang=${view.lang}, locale=${placeCountryByCode(cc)!.locale})`);
console.log(`<title> ${view.title}\n<h1> ${view.h1}\n${view.intro}`);
console.log(`KEY NUMBERS: ${view.keyNumbers.answer ?? ''}`);
for (const s of view.sections) {
  console.log(`\n## ${s.heading}${s.chart ? ` [chart ${s.chart.monthly.length} months; ${s.chart.method}]` : ''}`);
  for (const l of s.lines) console.log(`  - ${l.label}: ${l.value}${l.note ? ` (${l.note})` : ''} | ${l.source?.label ?? 'n/a'} | checked ${l.checkedIso ?? 'n/a'}`);
}
