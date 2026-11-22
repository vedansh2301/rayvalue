/**
 * Fetch the per-place open data for the France and Netherlands packs and write it as place_facts rows:
 *
 *   FR  INSEE Melodi dataset DS_RP_LOGEMENT_PRINC (Recensement de la population 2023, by commune):
 *         owner_occupied_share_pct  = main homes occupied by their owner / all main homes
 *         house_share_pct           = main homes that are houses (maisons) / all main homes
 *       ODRE (RTE / distribution grid operators) "Registre national des installations de production et de stockage
 *       d'electricite" at 30 Sep 2026: photovoltaic installations and capacity connected in the commune
 *         pv_installations_cumulative, pv_capacity_mw_cumulative
 *       Commune codes come from geo.api.gouv.fr (point-in-commune lookup of the pack's own city coordinates).
 *   NL  CBS StatLine, municipality (gemeente) level:
 *         86286NED  koopwoningen / totale woningvoorraad, 1 Jan 2026      -> owner_occupied_share_pct
 *         83704NED  eengezinswoningen / totale woningvoorraad, 1 Jan 2026 -> house_share_pct
 *         85005NED  zonnestroom bij woningen, end of 2025                 -> pv_installations_cumulative, pv_capacity_mw_cumulative
 *
 *   npm run places:fetch-local -- --dir <packs dir> --cities <cities.tsv> [--country fr|nl]
 *
 * <cities.tsv> is the pack's city list: cc, region slug, city slug, city name, lat, lon (tab separated). Writes, per country,
 * <dir>/<cc>/raw/cities.csv (read by places:fetch-yield for PVGIS coordinates), raw/<source>.json (the exact extracts used) and
 * <dir>/<cc>/places_local.csv (facts.csv format, read by places:import). Every ratio is computed here from two counts that are
 * printed in the row's excerpt; the page prints the stored number and does no arithmetic. A figure that cannot be fetched
 * is simply absent (never estimated), so the place falls under the 3-section gate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvObjects } from '../../src/lib/scrape/csv';

const arg = (name: string): string[] => process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
const dir = arg('dir')[0] ?? process.env.RVPLAN_COUNTRIES_DIR;
const citiesPath = arg('cities')[0];
const only = new Set(arg('country'));
const UA = 'Mozilla/5.0 (compatible; research-bot)';
const TODAY = new Date().toISOString().slice(0, 10);
if (!dir || !existsSync(dir) || !citiesPath || !existsSync(citiesPath)) {
  console.error('usage: fetch-local-fr-nl --dir <countries dir> --cities <cities.tsv> [--country fr|nl]');
  process.exit(2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (header: readonly string[], rows: string[][]): string => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
const HEADER = ['key', 'region', 'value', 'unit', 'valid_from', 'valid_to', 'source_url', 'publisher', 'retrieved_on', 'excerpt', 'confidence'] as const;
const round = (n: number, d: number): number => Math.round(n * 10 ** d) / 10 ** d;
const fmt = (n: number): string => String(Math.round(n));

async function getJson<T>(url: string, tries = 4): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

interface City { cc: string; region: string; slug: string; name: string; lat: number; lon: number }
const cityRows: City[] = readFileSync(citiesPath, 'utf8').split('\n').filter(Boolean).map((l) => {
  const [cc, region, slug, name, lat, lon] = l.split('\t');
  return { cc: cc!, region: region!, slug: slug!, name: name!, lat: Number(lat), lon: Number(lon) };
});

/** Place names as they appear in the pack's page titles. */
const pageSlugs = (root: string): Set<string> => new Set(parseCsvObjects(readFileSync(join(root, 'pages.csv'), 'utf8')).filter((r) => r.page_type === 'city').map((r) => (r.url ?? '').split('/').pop()!));

function writeRaw(root: string, name: string, data: unknown): void {
  mkdirSync(join(root, 'raw'), { recursive: true });
  writeFileSync(join(root, 'raw', name), JSON.stringify(data, null, 1) + '\n');
}

const row = (key: string, loc: string, value: number, unit: string, from: string, to: string, url: string, publisher: string, excerpt: string): string[] =>
  [key, loc, String(value), unit, from, to, url, publisher, TODAY, excerpt, 'primary'];

// ---------------------------------------------------------------- France

const ODRE = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/registre-national-installation-production-stockage-electricite-agrege';
const MELODI = 'https://api.insee.fr/melodi/data/DS_RP_LOGEMENT_PRINC';
/** Paris, Lyon and Marseille are registered in ODRE by arrondissement; INSEE has the whole commune. */
const ARRONDISSEMENTS: Record<string, string[]> = {
  '75056': Array.from({ length: 20 }, (_, i) => String(75101 + i)),
  '69123': Array.from({ length: 9 }, (_, i) => String(69381 + i)),
  '13055': Array.from({ length: 16 }, (_, i) => String(13201 + i)),
};
const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function fetchFr(root: string): Promise<void> {
  const slugs = pageSlugs(root);
  const cities = cityRows.filter((c) => c.cc === 'fr' && slugs.has(c.slug));
  writeFileSync(join(root, 'raw', 'cities.csv'), toCsv(['slug', 'lat', 'lon', 'region', 'name'], cities.map((c) => [c.slug, String(c.lat), String(c.lon), c.region, c.name])));

  const geo: { slug: string; code: string | null; nom: string | null; url: string }[] = [];
  for (const c of cities) {
    const url = `https://geo.api.gouv.fr/communes?lat=${c.lat}&lon=${c.lon}&fields=code,nom`;
    const body = await getJson<{ code: string; nom: string }[]>(url);
    const hit = body?.[0];
    // The point must fall in the commune the page is about; a different name is reported and skipped, never guessed.
    const ok = hit && norm(hit.nom) === norm(c.name);
    geo.push({ slug: c.slug, code: ok ? hit.code : null, nom: hit?.nom ?? null, url });
    if (!ok) console.warn(`FR ${c.slug}: coordinates fall in "${hit?.nom ?? 'nothing'}", expected "${c.name}": skipped`);
    await sleep(120);
  }
  writeRaw(root, 'geo-api-gouv-communes.json', geo);
  const codeOf = new Map(geo.filter((g) => g.code).map((g) => [g.slug, g.code!]));

  // INSEE Melodi: one request per commune returns every combination; the three cells used are picked from it.
  const insee: Record<string, unknown>[] = [];
  const out: string[][] = [];
  for (const c of cities) {
    const code = codeOf.get(c.slug);
    if (!code) continue;
    const url = `${MELODI}?maxResult=1000&GEO=2026-COM-${code}&TIME_PERIOD=2023&CARS=_T&BUILD_END=_T&NRG_SRC=_T&CARPARK=_T&NOR=_T&L_STAY=_T&RP_MEASURE=DWELLINGS`;
    const body = await getJson<{ observations?: { dimensions: Record<string, string>; measures: { OBS_VALUE_NIVEAU: { value: number } } }[] }>(url);
    await sleep(2200);
    const obs = body?.observations ?? [];
    const cell = (ocs: string, tsh: string, tdw: string): number | null => obs.find((o) => o.dimensions.OCS === ocs && o.dimensions.TSH === tsh && o.dimensions.TDW === tdw)?.measures.OBS_VALUE_NIVEAU.value ?? null;
    const total = cell('DW_MAIN', '_T', '_T');
    const owners = cell('DW_MAIN', '100', '_T');
    const houses = cell('DW_MAIN', '_T', '1');
    insee.push({ slug: c.slug, commune: code, url, total_main_homes: total, owner_occupied: owners, houses });
    const loc = `city:${c.slug}`;
    if (total && total > 0 && owners !== null) out.push(row('owner_occupied_share_pct', loc, round((owners / total) * 100, 1), '% of main homes', '2023', '', url, 'INSEE (Recensement de la population 2023)', `${c.name} (commune ${code}): ${fmt(owners)} of ${fmt(total)} residences principales are occupied by their owner (RP 2023, INSEE Melodi DS_RP_LOGEMENT_PRINC, TSH 100 / total).`));
    if (total && total > 0 && houses !== null) out.push(row('house_share_pct', loc, round((houses / total) * 100, 1), '% of main homes', '2023', '', url, 'INSEE (Recensement de la population 2023)', `${c.name} (commune ${code}): ${fmt(houses)} of ${fmt(total)} residences principales are houses (maisons) (RP 2023, INSEE Melodi DS_RP_LOGEMENT_PRINC, TDW 1 / total).`));
  }
  writeRaw(root, 'insee-melodi-rp2023-logement-communes.json', insee);

  // ODRE: PV installations and capacity per commune code (arrondissements summed for Paris, Lyon, Marseille).
  const wanted = new Map<string, string[]>();
  for (const [slug, code] of codeOf) wanted.set(slug, ARRONDISSEMENTS[code] ?? [code]);
  const allCodes = [...new Set([...wanted.values()].flat())];
  const sums = new Map<string, { n: number; kw: number }>();
  const odre: { codes: string[]; url: string; rows: unknown[] }[] = [];
  for (let i = 0; i < allCodes.length; i += 25) {
    const batch = allCodes.slice(i, i + 25);
    const q = new URLSearchParams({
      where: `filiere="Solaire" and technologie="Photovoltaïque" and codeinseecommune in (${batch.map((b) => `"${b}"`).join(',')})`,
      select: 'codeinseecommune,sum(nbinstallations) as n,sum(puismaxinstallee) as kw',
      group_by: 'codeinseecommune',
      limit: '100',
    });
    const url = `${ODRE}/records?${q.toString()}`;
    const body = await getJson<{ results: { codeinseecommune: string; n: number; kw: number }[] }>(url);
    odre.push({ codes: batch, url, rows: body?.results ?? [] });
    for (const r of body?.results ?? []) sums.set(r.codeinseecommune, { n: r.n, kw: r.kw });
    await sleep(500);
  }
  writeRaw(root, 'odre-registre-national-pv-par-commune.json', odre);
  for (const c of cities) {
    const codes = wanted.get(c.slug);
    if (!codes) continue;
    const parts = codes.map((k) => sums.get(k)).filter((x): x is { n: number; kw: number } => !!x);
    // A commune with no register row at all is not reported (zero and unknown are not the same).
    if (parts.length === 0) continue;
    const n = parts.reduce((a, p) => a + p.n, 0);
    const kw = parts.reduce((a, p) => a + p.kw, 0);
    const where = `filiere="Solaire" and technologie="Photovoltaïque" and codeinseecommune in (${codes.map((k) => `"${k}"`).join(',')})`;
    const url = `${ODRE}/records?${new URLSearchParams({ where, select: 'codeinseecommune,sum(nbinstallations) as n,sum(puismaxinstallee) as kw', group_by: 'codeinseecommune', limit: '100' }).toString()}`;
    const loc = `city:${c.slug}`;
    const scope = codes.length > 1 ? `, summed over its ${codes.length} arrondissements` : '';
    out.push(row('pv_installations_cumulative', loc, n, 'installations', '2026-09-30', '', url, 'ODRE (RTE and distribution network operators)', `${c.name}: ${fmt(n)} photovoltaic installations of all sizes connected to the public grid at 30 Sep 2026 (registre national des installations de production et de stockage d'electricite${scope}).`));
    out.push(row('pv_capacity_mw_cumulative', loc, round(kw / 1000, 2), 'MW', '2026-09-30', '', url, 'ODRE (RTE and distribution network operators)', `${c.name}: ${round(kw, 0)} kW maximum installed photovoltaic capacity at 30 Sep 2026 (same register${scope}); shown in MW.`));
  }
  writeFileSync(join(root, 'places_local.csv'), toCsv(HEADER, out));
  console.log(`FR: ${cities.length} cities, ${codeOf.size} matched to a commune code, ${out.length} fact rows`);
}

// ---------------------------------------------------------------- Netherlands

const CBS = 'https://opendata.cbs.nl/ODataApi/odata';
/** City page slug -> the CBS gemeente title (CBS RegioS Title, trimmed) the page's figures describe. */
const GEMEENTE: Record<string, string> = {
  'den-haag': "'s-Gravenhage (gemeente)", utrecht: 'Utrecht (gemeente)', groningen: 'Groningen (gemeente)', middelburg: 'Middelburg (Z.)',
  's-hertogenbosch': "'s-Hertogenbosch", sneek: 'Súdwest-Fryslân', delfzijl: 'Eemsdelta', haarlemmermeer: 'Haarlemmermeer',
};
interface Regio { Key: string; Title: string }
type Rec = Record<string, string | number | null>;

async function fetchNl(root: string): Promise<void> {
  const slugs = pageSlugs(root);
  const cities = cityRows.filter((c) => c.cc === 'nl' && slugs.has(c.slug));
  writeFileSync(join(root, 'raw', 'cities.csv'), toCsv(['slug', 'lat', 'lon', 'region', 'name'], cities.map((c) => [c.slug, String(c.lat), String(c.lon), c.region, c.name])));

  const regio = await getJson<{ value: Regio[] }>(`${CBS}/86286NED/RegioS?$format=json`);
  if (!regio) throw new Error('CBS RegioS not available');
  const gm = new Map(regio.value.filter((r) => r.Key.startsWith('GM')).map((r) => [r.Title.trim(), r.Key.trim()]));
  const keyOf = new Map<string, string>();
  for (const c of cities) {
    // The pack names a gemeente as "Sneek" or "Súdwest-Fryslân (Sneek)": match the CBS title exactly, never loosely.
    const want = GEMEENTE[c.slug] ?? c.name.replace(/\s*\(.*\)$/, '');
    const k = gm.get(want);
    if (!k) console.warn(`NL ${c.slug}: no CBS gemeente titled "${want}": skipped`); else keyOf.set(c.slug, k);
  }
  const codes = [...new Set(keyOf.values())];
  const inList = (col: string) => `(${codes.map((k) => `${col} eq '${k}'`).join(' or ')})`;
  const odata = (table: string, filter: string) => `${CBS}/${table}/TypedDataSet?$format=json&$filter=${encodeURIComponent(filter)}&$top=5000`;
  const one = (table: string, filter: string) => `${CBS}/${table}/TypedDataSet?$format=json&$filter=${encodeURIComponent(filter)}`;

  const stock = await getJson<{ value: Rec[] }>(odata('86286NED', `Perioden eq '2026JJ00' and StatusVanBewoning eq 'T001742' and ${inList('RegioS')}`));
  const types = await getJson<{ value: Rec[] }>(odata('83704NED', `Perioden eq '2026JJ00' and Oppervlakteklasse eq 'T001116' and (Woningtype eq 'T001100' or Woningtype eq 'ZW10290') and ${inList('RegioS')}`));
  const solar = await getJson<{ value: Rec[] }>(odata('85005NED', `Perioden eq '2025JJ00' and SectorEnVermogensklasse eq 'E007037' and ${inList('RegioS')}`));
  writeRaw(root, 'cbs-86286NED-voorraad-eigendom-gemeenten.json', stock?.value ?? []);
  writeRaw(root, 'cbs-83704NED-voorraad-woningtype-gemeenten.json', types?.value ?? []);
  writeRaw(root, 'cbs-85005NED-zonnestroom-woningen-gemeenten.json', solar?.value ?? []);

  const out: string[][] = [];
  const pub = (t: string) => `CBS StatLine ${t}`;
  for (const c of cities) {
    const k = keyOf.get(c.slug);
    if (!k) continue;
    const loc = `city:${c.slug}`;
    const gname = (GEMEENTE[c.slug] ?? c.name).replace(/ \(gemeente\)$/, '');
    const s = stock?.value.find((r) => (r.RegioS as string).trim() === k);
    if (s && typeof s.TotaleWoningvoorraad_1 === 'number' && typeof s.Koopwoningen_2 === 'number' && s.TotaleWoningvoorraad_1 > 0) {
      const url = one('86286NED', `RegioS eq '${k}' and Perioden eq '2026JJ00' and StatusVanBewoning eq 'T001742'`);
      out.push(row('owner_occupied_share_pct', loc, round((s.Koopwoningen_2 / s.TotaleWoningvoorraad_1) * 100, 1), '% of housing stock', '2026-01-01', '', url, pub('86286NED'), `Gemeente ${gname} (${k}): ${fmt(s.Koopwoningen_2)} koopwoningen of ${fmt(s.TotaleWoningvoorraad_1)} woningen on 1 Jan 2026. CBS counts a home as koopwoning when the (future) occupant owns it or it is a second home.`));
    }
    const tot = types?.value.find((r) => (r.RegioS as string).trim() === k && r.Woningtype === 'T001100');
    const eg = types?.value.find((r) => (r.RegioS as string).trim() === k && r.Woningtype === 'ZW10290');
    if (tot && eg && typeof tot.BeginstandWoningvoorraad_1 === 'number' && typeof eg.BeginstandWoningvoorraad_1 === 'number' && tot.BeginstandWoningvoorraad_1 > 0) {
      const url = one('83704NED', `RegioS eq '${k}' and Perioden eq '2026JJ00' and Oppervlakteklasse eq 'T001116' and (Woningtype eq 'T001100' or Woningtype eq 'ZW10290')`);
      out.push(row('house_share_pct', loc, round((eg.BeginstandWoningvoorraad_1 / tot.BeginstandWoningvoorraad_1) * 100, 1), '% of housing stock', '2026-01-01', '', url, pub('83704NED'), `Gemeente ${gname} (${k}): ${fmt(eg.BeginstandWoningvoorraad_1)} eengezinswoningen of ${fmt(tot.BeginstandWoningvoorraad_1)} woningen on 1 Jan 2026.`));
    }
    const z = solar?.value.find((r) => (r.RegioS as string).trim() === k);
    if (z && typeof z.Installaties_1 === 'number' && typeof z.OpgesteldVermogenVanZonnepanelen_2 === 'number') {
      const url = one('85005NED', `RegioS eq '${k}' and Perioden eq '2025JJ00' and SectorEnVermogensklasse eq 'E007037'`);
      out.push(row('pv_installations_cumulative', loc, z.Installaties_1, 'installations', '2025-12-31', '', url, pub('85005NED'), `Gemeente ${gname} (${k}): ${fmt(z.Installaties_1)} solar PV systems on homes at the end of 2025 (CBS 85005NED, sector Woningen; period 2025 is marked nader voorlopig).`));
      out.push(row('pv_capacity_mw_cumulative', loc, round(z.OpgesteldVermogenVanZonnepanelen_2 / 1000, 2), 'MW', '2025-12-31', '', url, pub('85005NED'), `Gemeente ${gname} (${k}): ${fmt(z.OpgesteldVermogenVanZonnepanelen_2)} kWp of solar panel capacity on homes at the end of 2025 (same table); shown in MW.`));
    }
  }
  writeFileSync(join(root, 'places_local.csv'), toCsv(HEADER, out));
  console.log(`NL: ${cities.length} cities, ${keyOf.size} matched to a gemeente, ${out.length} fact rows`);
}

for (const cc of ['fr', 'nl']) {
  if (only.size && !only.has(cc)) continue;
  const root = join(dir, cc);
  mkdirSync(join(root, 'raw'), { recursive: true });
  await (cc === 'fr' ? fetchFr(root) : fetchNl(root));
}
