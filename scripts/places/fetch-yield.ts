/**
 * Fetch coordinates and PVGIS solar yield for every city in a country pack, using the SAME logic as the /api/pvgis
 * proxy (src/lib/server/pvgis.ts): equator-facing (north in the southern hemisphere) at PVGIS's optimal tilt, 1 kWp,
 * v5_3 pinned. This replaces the pack's own yield rows, which for AU were fetched with a flat / wrong azimuth.
 *
 *   npm run places:fetch-yield -- --dir <packs dir> [--country gb|de|au|es|ie|se|dk|no|fi|pl|cz|ro|fr|nl|it|ch ...] [--losses 14] [--dry-run]
 *
 * Writes <dir>/<cc>/places_coords.csv and <dir>/<cc>/places_yield.csv (facts.csv format) for scripts/places/import-pack.ts.
 * No keys needed (PVGIS and Wikidata are open). Sequential, ~8 requests per second, well under PVGIS's 30 per second.
 * Coordinates: AU from the pack's wiki_places.json; GB from the pack's own PVGIS rows (source matched in coords.json,
 * else Wikidata by GSS code); DE from Wikidata by municipality key (AGS, property P439).
 * ES, IE, SE, DK, NO, FI, PL, CZ, RO, FR, NL: the packs carry no coordinate source, so the coordinates the pack itself used for PVGIS
 * (raw/cities.csv, else the lat/lon in its own PVGIS request URL) are reused and stored WITHOUT a source: the place row then
 * has no coordinates (the table requires a source for any), while the yield fact cites the exact PVGIS request URL.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvObjects } from '../../src/lib/scrape/csv';
import { buildUpstreamUrl, mapPvgisResponse, type PvgisQuery } from '../../src/lib/server/pvgis';
import { round2 } from '../../src/lib/server/pvwatts';
import { packFactsFromCsv, parsePackPlaces, placeLocator, type PackFact, type PackPlace } from '../../src/lib/places/pack';
import { coordsFromPvgisUrl, parseWktPoint, yieldFactRows } from '../../src/lib/places/yield-rows';
import type { PlaceCountryCode } from '../../src/lib/places/config';

const arg = (name: string): string[] => process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
const dir = arg('dir')[0] ?? process.env.RVPLAN_COUNTRIES_DIR;
const losses = Number(arg('losses')[0] ?? 14);
const dry = process.argv.includes('--dry-run');
const only = new Set(arg('country'));
const UA = 'place-data-fetch/1.0';
const TODAY = new Date().toISOString().slice(0, 10);
if (!dir || !existsSync(dir) || !Number.isFinite(losses)) {
  console.error('usage: fetch-yield --dir <countries dir> [--country gb|de|au] [--losses 14] [--dry-run]');
  process.exit(2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (header: string[], rows: string[][]): string => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
const jsonFile = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null);

interface Coord { lat: number; lon: number; source: string }

async function wikidataBy(property: 'P439' | 'P836', codes: string[]): Promise<Map<string, Coord>> {
  const out = new Map<string, Coord>();
  if (codes.length === 0) return out;
  const query = `SELECT ?code ?item ?coord WHERE { VALUES ?code { ${codes.map((c) => `"${c}"`).join(' ')} } ?item wdt:${property} ?code . ?item wdt:P625 ?coord . }`;
  const res = await fetch('https://query.wikidata.org/sparql', { method: 'POST', headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ query }) });
  if (!res.ok) throw new Error(`wikidata HTTP ${res.status}`);
  const body = (await res.json()) as { results: { bindings: { code: { value: string }; item: { value: string }; coord: { value: string } }[] } };
  for (const b of body.results.bindings) {
    const pt = parseWktPoint(b.coord.value);
    if (pt && !out.has(b.code.value)) out.set(b.code.value, { ...pt, source: `https://www.wikidata.org/wiki/${b.item.value.split('/').pop()}` });
  }
  return out;
}

async function coordsFor(cc: PlaceCountryCode, root: string, places: PackPlace[], facts: PackFact[]): Promise<Map<string, Coord>> {
  const out = new Map<string, Coord>();
  const key = (p: PackPlace) => `${p.regionSlug}/${p.slug}`;
  if (cc === 'AU') {
    const wiki = jsonFile<Record<string, { lat: number; lon: number; url: string }>>(join(root, 'raw/wiki_places.json')) ?? {};
    for (const p of places) { const w = wiki[p.slug]; if (w) out.set(key(p), { lat: w.lat, lon: w.lon, source: w.url }); }
  } else if (cc === 'DE') {
    const pages = parseCsvObjects(readFileSync(join(root, 'pages.csv'), 'utf8'));
    const ags = new Map<string, string>();
    for (const r of pages) { const m = /MaStR AGS (\d{8})/.exec(r.notes ?? ''); if (r.page_type === 'city' && m) ags.set(r.url!.split('/').pop()!, m[1]!); }
    const found = await wikidataBy('P439', [...new Set(ags.values())]);
    for (const p of places) { const c = found.get(ags.get(p.slug) ?? ''); if (c) out.set(key(p), c); }
  } else if (cc !== 'GB') {
    // ES, IE, Nordic, CEE: raw/cities.csv by slug, else the pack's own PVGIS request URL (by locator, or by place name).
    const csvPath = join(root, 'raw/cities.csv');
    const cities = new Map(existsSync(csvPath) ? parseCsvObjects(readFileSync(csvPath, 'utf8')).map((r) => [r.slug!, r] as const) : []);
    for (const p of places) {
      const c = cities.get(p.slug);
      if (c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon))) { out.set(key(p), { lat: Number(c.lat), lon: Number(c.lon), source: '' }); continue; }
      const row = facts.find((f) => f.key === 'solar_yield_kwh_per_kwp' && (f.region === placeLocator(p) || f.region === p.name));
      const pt = row ? coordsFromPvgisUrl(row.source_url) : null;
      if (pt) out.set(key(p), { ...pt, source: '' });
    }
  } else {
    // GB: the pack fetched PVGIS at town coordinates; keep them and find their Wikipedia source in coords.json.
    const wiki = jsonFile<Record<string, { lat: number; lon: number; src: string }>>(join(root, 'raw/coords.json')) ?? {};
    const meta = jsonFile<Record<string, { la_code?: string }>>(join(root, 'raw/place_meta.json')) ?? {};
    const need: PackPlace[] = [];
    for (const p of places) {
      const row = facts.find((f) => f.key === 'solar_yield_kwh_per_kwp' && f.region === placeLocator(p));
      const pt = row ? coordsFromPvgisUrl(row.source_url) : null;
      const src = pt ? Object.values(wiki).find((w) => Math.abs(w.lat - pt.lat) < 2e-4 && Math.abs(w.lon - pt.lon) < 2e-4)?.src : undefined;
      if (pt && src) out.set(key(p), { ...pt, source: src });
      else need.push(p);
    }
    const codes = need.map((p) => meta[p.slug]?.la_code).filter((c): c is string => !!c);
    const found = await wikidataBy('P836', [...new Set(codes)]);
    for (const p of need) { const c = found.get(meta[p.slug]?.la_code ?? ''); if (c) out.set(key(p), c); }
  }
  return out;
}

async function pvgis(q: PvgisQuery): Promise<{ url: string; result: ReturnType<typeof mapPvgisResponse> } | null> {
  const url = buildUpstreamUrl(q).toString();
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 || res.status === 529) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) return null;
    try { return { url, result: mapPvgisResponse(await res.json()) }; } catch { return null; }
  }
  return null;
}

const COUNTRIES: Record<string, PlaceCountryCode> = { gb: 'GB', de: 'DE', au: 'AU', es: 'ES', ie: 'IE', se: 'SE', dk: 'DK', no: 'NO', fi: 'FI', pl: 'PL', cz: 'CZ', ro: 'RO', fr: 'FR', nl: 'NL', it: 'IT', ch: 'CH' };
for (const [dirName, cc] of Object.entries(COUNTRIES)) {
  if (only.size && !only.has(dirName)) continue;
  const root = join(dir, dirName);
  const places = parsePackPlaces(cc, readFileSync(join(root, 'pages.csv'), 'utf8'));
  const facts = packFactsFromCsv(readFileSync(join(root, 'facts.csv'), 'utf8'));
  if (dry) { console.log(`${cc}: ${places.length} places (dry run, no network)`); continue; }
  const coords = await coordsFor(cc, root, places, facts);
  const coordRows: string[][] = [];
  const yieldRows: PackFact[] = [];
  const failed: string[] = [];
  for (const p of places) {
    const c = coords.get(`${p.regionSlug}/${p.slug}`);
    if (!c) { failed.push(`${p.slug} (no coordinates)`); continue; }
    coordRows.push([p.regionSlug, p.slug, String(c.lat), String(c.lon), c.source]);
    const got = await pvgis({ country: cc, lat: round2(c.lat), lon: round2(c.lon), losses });
    await sleep(120);
    if (!got) { failed.push(`${p.slug} (PVGIS failed)`); continue; }
    yieldRows.push(...yieldFactRows(placeLocator(p), got.url, got.result, losses, TODAY));
  }
  writeFileSync(join(root, 'places_coords.csv'), toCsv(['region', 'slug', 'lat', 'lon', 'source_url'], coordRows));
  const H = ['key', 'region', 'value', 'unit', 'valid_from', 'valid_to', 'source_url', 'publisher', 'retrieved_on', 'excerpt', 'confidence'] as const;
  writeFileSync(join(root, 'places_yield.csv'), toCsv([...H], yieldRows.map((f) => H.map((h) => f[h]))));
  console.log(`${cc}: ${places.length} places, ${coordRows.length} with coordinates, ${yieldRows.filter((f) => f.key === 'solar_yield_kwh_per_kwp').length} with yield${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
}
