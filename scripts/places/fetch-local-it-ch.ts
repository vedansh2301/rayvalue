/**
 * Fetch the per-place open data for the Italy and Switzerland packs and write it as place_facts rows:
 *
 *   IT  ISTAT (esploradati.istat.it, SDMX), by comune:
 *         DF_DCSS_ABITAZIONI_TV_2  abitazioni occupate a titolo di proprieta / all occupied dwellings, same year (2019)
 *                                  -> owner_occupied_share_pct   (permanent-census sample estimates, so counts are not integers)
 *         DF_DCSS_HCUE_COM_7_COM   abitazioni in edifici con 1 o 2 abitazioni / all dwellings in residential buildings (2021)
 *                                  -> house_share_pct
 *       Comune codes: ISTAT "Elenco dei comuni italiani" (name + region match; an ambiguous name is skipped, never guessed).
 *       Coordinates for PVGIS: Wikidata by the ISTAT code (P635). The GSE / Terna Atlaimpianti per-comune PV register has no
 *       open download or API, so installs are not filled for Italy.
 *   CH  German-language pages only (/ch/photovoltaik/...):
 *         ElCom electricity price 2027 by Gemeinde (LINDAS cube elcom/electricityprice, category H4, standard product)
 *                                  -> electricity_price_h4_rp_per_kwh
 *         BFE "Elektrizitaetsproduktionsanlagen" (data.geo.admin.ch, Pronovo register), photovoltaic plants per Gemeinde
 *                                  -> pv_installations_cumulative, pv_capacity_mw_cumulative
 *       Gemeinde numbers and coordinates: Wikidata (P771 Swiss municipality code, P625).
 *
 *   npm run places:fetch-local-it-ch -- --dir <packs dir> [--country it|ch]
 *
 * Writes <dir>/<cc>/raw/cities.csv (read by places:fetch-yield for PVGIS coordinates), raw/<source>.json (the exact extracts
 * used), raw/sanity.json (every metric against the national total) and <dir>/<cc>/places_local.csv (facts.csv format, read by
 * places:import). Ratios are computed here from counts printed in the excerpt. A figure that cannot be fetched or that fails the
 * sanity check is absent (never estimated), so the place falls under the 3-section gate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvObjects } from '../../src/lib/scrape/csv';

const arg = (name: string): string[] => process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
const dir = arg('dir')[0] ?? process.env.RVPLAN_COUNTRIES_DIR;
const only = new Set(arg('country'));
const UA = 'Mozilla/5.0 (compatible; research-bot)';
const TODAY = new Date().toISOString().slice(0, 10);
if (!dir || !existsSync(dir)) {
  console.error('usage: fetch-local-it-ch --dir <countries dir> [--country it|ch]');
  process.exit(2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (header: readonly string[], rows: string[][]): string => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
const HEADER = ['key', 'region', 'value', 'unit', 'valid_from', 'valid_to', 'source_url', 'publisher', 'retrieved_on', 'excerpt', 'confidence'] as const;
const round = (n: number, d: number): number => Math.round(n * 10 ** d) / 10 ** d;
const fmt = (n: number): string => String(Math.round(n));
const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const row = (key: string, loc: string, value: number, unit: string, from: string, to: string, url: string, publisher: string, excerpt: string): string[] =>
  [key, loc, String(value), unit, from, to, url, publisher, TODAY, excerpt, 'primary'];

async function get(url: string, headers: Record<string, string>, init: RequestInit = {}, tries = 4): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, 'Accept-Language': 'en', ...headers }, signal: AbortSignal.timeout(120_000) });
      if (res.status === 429 || res.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      return res.ok ? res : null;
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

interface Pt { lat: number; lon: number; code: string; label: string }
/** Wikidata: coordinates (P625) of items found by a code property or by German label. */
async function wikidata(values: string, where: string): Promise<{ code: string; label: string; lat: number; lon: number }[]> {
  const q = `SELECT ?code ?label ?c WHERE { ${values} ${where} OPTIONAL { ?i rdfs:label ?label . FILTER(LANG(?label) IN ("de","it")) } ?i wdt:P625 ?c . FILTER NOT EXISTS { ?i wdt:P576 ?end } }`;
  const res = await get(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { Accept: 'application/sparql-results+json' });
  if (!res) return [];
  const j = (await res.json()) as { results: { bindings: { code: { value: string }; label?: { value: string }; c: { value: string } }[] } };
  return j.results.bindings.flatMap((b) => {
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.c.value);
    return m ? [{ code: b.code.value, label: b.label?.value ?? '', lat: Number(m[2]), lon: Number(m[1]) }] : [];
  });
}

const writeRaw = (root: string, name: string, data: unknown): void => { mkdirSync(join(root, 'raw'), { recursive: true }); writeFileSync(join(root, 'raw', name), JSON.stringify(data, null, 1) + '\n'); };

interface PackCity { slug: string; region: string; name: string }
const packCities = (root: string, nameRe: RegExp, segments: number): PackCity[] =>
  parseCsvObjects(readFileSync(join(root, 'pages.csv'), 'utf8')).flatMap((r) => {
    const p = (r.url ?? '').split('/');
    const name = nameRe.exec(r.title ?? '')?.[1]?.trim();
    return r.page_type === 'city' && p.length === segments && name ? [{ slug: p[segments - 1]!, region: p[segments - 2]!, name }] : [];
  });

interface Sanity { place: string; metric: string; value: number; national: number; delta: number; verdict: 'ok' | 'flag' }
const sanity: Sanity[] = [];
/** A place figure that departs from the national figure by more than `maxDelta` points is reported and NOT published. */
function plausible(place: string, metric: string, value: number, national: number, maxDelta: number): boolean {
  const delta = round(value - national, 1);
  const ok = value >= 0 && value <= 100 && Math.abs(delta) <= maxDelta;
  sanity.push({ place, metric, value, national: round(national, 1), delta, verdict: ok ? 'ok' : 'flag' });
  if (!ok) console.warn(`FLAG ${place} ${metric}: ${value} vs national ${round(national, 1)} (delta ${delta}); not published`);
  return ok;
}

// ---------------------------------------------------------------- Italy

const ISTAT = 'https://esploradati.istat.it/SDMXWS/rest/data/IT1';
const ISTAT_CSV = 'application/vnd.sdmx.data+csv;version=1.0.0';
/** Pack names that differ from ISTAT's official comune names. */
const IT_ALIAS: Record<string, string> = { 'Reggio Emilia': "Reggio nell'Emilia", 'Reggio Calabria': 'Reggio di Calabria' };
const IT_REGION: Record<string, string> = { 'valle-d-aosta': 'valledaostavalleedaoste', 'trentino-alto-adige': 'trentinoaltoadigesudtirol', 'friuli-venezia-giulia': 'friuliveneziagiulia' };

async function istat(flow: string, key: string, from: string): Promise<{ url: string; rows: Record<string, string>[] }> {
  const url = `${ISTAT}/${flow},1.0/${key}?startPeriod=${from}`;
  const res = await get(url, { Accept: ISTAT_CSV });
  await sleep(450);
  if (!res) return { url, rows: [] };
  return { url, rows: parseCsvObjects(await res.text()) };
}

async function fetchIt(root: string): Promise<void> {
  const cities = packCities(root, /^Fotovoltaico a (.+?): /, 5);
  const listRes = await get('https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv', {});
  if (!listRes) throw new Error('ISTAT Elenco comuni not available');
  const text = new TextDecoder('latin1').decode(await listRes.arrayBuffer());
  // Columns by position (the header has a multi-line cell): 6 name, 10 region, 15 numeric comune code (PRO_COM).
  const list = text.split(/\r?\n/).filter((l) => /^\d+;/.test(l)).map((l) => l.split(';')).map((c) => ({ name: (c[6] ?? '').replace(/^"|"$/g, ''), region: c[10] ?? '', code: (c[15] ?? '').replace(/\D/g, '').padStart(6, '0') }));

  const matched: (PackCity & { code: string })[] = [];
  for (const c of cities) {
    const want = IT_ALIAS[c.name] ?? c.name;
    const byName = list.filter((x) => norm(x.name.split('/')[0]!) === norm(want) || norm(x.name) === norm(want));
    const reg = IT_REGION[c.region] ?? norm(c.region);
    const hit = byName.length === 1 ? byName : byName.filter((x) => norm(x.region).startsWith(reg.slice(0, 8)));
    if (hit.length === 1) matched.push({ ...c, code: hit[0]!.code });
    else console.warn(`IT ${c.slug}: ${hit.length} comuni match "${c.name}" in ${c.region}: skipped`);
  }
  writeRaw(root, 'istat-elenco-comuni-matched.json', matched);

  // Coordinates for PVGIS: Wikidata by the ISTAT code.
  const pts = await wikidata(`VALUES ?code { ${matched.map((m) => `"${m.code}"`).join(' ')} }`, '?i wdt:P635 ?code .');
  const coord = new Map(pts.map((p) => [p.code, p] as const));
  writeFileSync(join(root, 'raw', 'cities.csv'), toCsv(['slug', 'lat', 'lon', 'region', 'name'], matched.filter((m) => coord.has(m.code)).map((m) => [m.slug, String(coord.get(m.code)!.lat), String(coord.get(m.code)!.lon), m.region, m.name])));
  writeRaw(root, 'wikidata-coordinates-by-istat-code.json', pts);

  // ISTAT's API is rate limited, so ONE request per table fetches every comune (SDMX "+" = OR) plus the national total. The URL
  // cited on each fact is the same query for that comune alone.
  const ownKey = (area: string) => `A.${area}.NUM_OCC_DW_AV.OWN+ALL.TOT.ALL.ALL.TOTAL.TOTAL`;
  const hcueKey = (area: string) => `A.${area}.NUM_DW_AV.T.ALL.WORLD.HH.FNUCLEI.TOT.N_DW_1+N_DW_2+RB`;
  const urlOf = (flow: string, key: string) => `${ISTAT}/${flow},1.0/${key}?startPeriod=2011`;
  const areas = ['IT', ...matched.map((m) => m.code)].join('+');
  const ownAll = await istat('DF_DCSS_ABITAZIONI_TV_2', ownKey(areas), '2011');
  const hcueAll = await istat('DF_DCSS_HCUE_COM_7_COM', hcueKey(areas), '2011');
  writeRaw(root, 'istat-DF_DCSS_ABITAZIONI_TV_2-ownership-comuni.json', { url: ownAll.url, rows: ownAll.rows.map((r) => ({ REF_AREA: r.REF_AREA, OWNERSHIP_TYPE: r.OWNERSHIP_TYPE, TIME_PERIOD: r.TIME_PERIOD, OBS_VALUE: r.OBS_VALUE })) });
  writeRaw(root, 'istat-DF_DCSS_HCUE_COM_7_COM-building-size-comuni.json', { url: hcueAll.url, rows: hcueAll.rows.map((r) => ({ REF_AREA: r.REF_AREA, TYPE_OF_BUILDING: r.TYPE_OF_BUILDING, TIME_PERIOD: r.TIME_PERIOD, OBS_VALUE: r.OBS_VALUE })) });
  if (ownAll.rows.length === 0 || hcueAll.rows.length === 0) throw new Error('ISTAT returned no rows (rate limited?); nothing written');
  const pick = (rows: Record<string, string>[], area: string, dim: string, val: string, year: string): number | null => {
    const v = rows.find((r) => r.REF_AREA === area && r[dim] === val && r.TIME_PERIOD === year)?.OBS_VALUE;
    return v !== undefined && v !== '' ? Number(v) : null;
  };
  const nOwn = pick(ownAll.rows, 'IT', 'OWNERSHIP_TYPE', 'OWN', '2019')!, nAll = pick(ownAll.rows, 'IT', 'OWNERSHIP_TYPE', 'ALL', '2019')!;
  const nOne = pick(hcueAll.rows, 'IT', 'TYPE_OF_BUILDING', 'N_DW_1', '2021')!, nTwo = pick(hcueAll.rows, 'IT', 'TYPE_OF_BUILDING', 'N_DW_2', '2021')!, nRb = pick(hcueAll.rows, 'IT', 'TYPE_OF_BUILDING', 'RB', '2021')!;
  const natOwner = (nOwn / nAll) * 100, natHouse = ((nOne + nTwo) / nRb) * 100;
  console.log(`IT national: owner-occupied ${round(natOwner, 1)}% (${fmt(nOwn)} / ${fmt(nAll)}, 2019); dwellings in 1-2 dwelling buildings ${round(natHouse, 1)}% (2021)`);

  const out: string[][] = [];
  for (const c of matched) {
    const loc = `city:${c.slug}`;
    const ownN = pick(ownAll.rows, c.code, 'OWNERSHIP_TYPE', 'OWN', '2019'), allN = pick(ownAll.rows, c.code, 'OWNERSHIP_TYPE', 'ALL', '2019');
    const one = pick(hcueAll.rows, c.code, 'TYPE_OF_BUILDING', 'N_DW_1', '2021'), two = pick(hcueAll.rows, c.code, 'TYPE_OF_BUILDING', 'N_DW_2', '2021'), tot = pick(hcueAll.rows, c.code, 'TYPE_OF_BUILDING', 'RB', '2021');
    const ownUrl = urlOf('DF_DCSS_ABITAZIONI_TV_2', ownKey(c.code)), hcueUrl = urlOf('DF_DCSS_HCUE_COM_7_COM', hcueKey(c.code));
    if (ownN !== null && allN && allN > 0) {
      const v = round((ownN / allN) * 100, 1);
      if (plausible(c.slug, 'owner_occupied_share_pct', v, natOwner, 30)) out.push(row('owner_occupied_share_pct', loc, v, '% of occupied dwellings', '2019', '', ownUrl, 'ISTAT (Censimento permanente della popolazione e delle abitazioni)', `${c.name} (comune ${c.code}): about ${fmt(ownN)} of ${fmt(allN)} occupied dwellings are occupied by their owner, 2019 (ISTAT DF_DCSS_ABITAZIONI_TV_2, OWNERSHIP_TYPE OWN / ALL; census sample estimate).`));
    }
    if (one !== null && two !== null && tot && tot > 0) {
      const v = round(((one + two) / tot) * 100, 1);
      if (plausible(c.slug, 'house_share_pct', v, natHouse, 45)) out.push(row('house_share_pct', loc, v, '% of dwellings', '2021', '', hcueUrl, 'ISTAT (Censimento permanente della popolazione e delle abitazioni)', `${c.name} (comune ${c.code}): ${fmt(one + two)} of ${fmt(tot)} dwellings are in buildings with one or two dwellings, 2021 (ISTAT DF_DCSS_HCUE_COM_7_COM, TYPE_OF_BUILDING N_DW_1 + N_DW_2 / RB).`));
    }
  }
  writeRaw(root, 'sanity.json', { national: { owner_occupied_share_pct: natOwner, house_share_pct: natHouse }, rows: sanity });
  writeFileSync(join(root, 'places_local.csv'), toCsv(HEADER, out));
  console.log(`IT: ${cities.length} pack cities, ${matched.length} matched to a comune, ${out.length} fact rows`);
}

// ---------------------------------------------------------------- Switzerland

const CANTON: Record<string, string> = { zuerich: 'ZH', bern: 'BE', 'basel-stadt': 'BS', luzern: 'LU', 'st-gallen': 'SG', aargau: 'AG', graubuenden: 'GR', zug: 'ZG', schaffhausen: 'SH' };
const LABEL: Record<string, string> = { zuerich: 'Zürich', 'st-gallen': 'St. Gallen', biel: 'Biel/Bienne', basel: 'Basel' };

async function fetchCh(root: string): Promise<void> {
  const cities = packCities(root, /^Photovoltaik in (.+?)$/, 5);
  const label = (c: PackCity): string => LABEL[c.slug] ?? c.name;
  const found = await wikidata(`VALUES ?label { ${cities.map((c) => `"${label(c)}"@de`).join(' ')} }`, '?i rdfs:label ?label . ?i wdt:P771 ?code .');
  const bfs = new Map<string, Pt>();
  for (const c of cities) {
    const hits = found.filter((f) => f.label === label(c));
    if (hits.length === 1) bfs.set(c.slug, { lat: hits[0]!.lat, lon: hits[0]!.lon, code: hits[0]!.code, label: label(c) });
    else console.warn(`CH ${c.slug}: ${hits.length} Wikidata municipalities labelled "${label(c)}": skipped`);
  }
  writeRaw(root, 'wikidata-municipalities-p771.json', found);
  writeFileSync(join(root, 'raw', 'cities.csv'), toCsv(['slug', 'lat', 'lon', 'region', 'name'], cities.filter((c) => bfs.has(c.slug)).map((c) => [c.slug, String(bfs.get(c.slug)!.lat), String(bfs.get(c.slug)!.lon), c.region, c.name])));

  // ElCom 2027, category H4, standard product, via LINDAS (SPARQL).
  const codes = [...bfs.values()].map((p) => p.code);
  const elQuery = (ids: string[]): string => `PREFIX cube: <https://cube.link/> PREFIX s: <https://energy.ld.admin.ch/elcom/electricityprice/dimension/>
SELECT ?bfs ?total ?energy ?grid ?operator WHERE { GRAPH <https://lindas.admin.ch/elcom/electricityprice> {
  VALUES ?m { ${ids.map((k) => `<https://ld.admin.ch/municipality/${k}>`).join(' ')} }
  ?o a cube:Observation ; s:municipality ?m ; s:period "2027"^^<http://www.w3.org/2001/XMLSchema#gYear> ; s:category <https://energy.ld.admin.ch/elcom/electricityprice/category/H4> ; s:product <https://energy.ld.admin.ch/elcom/electricityprice/product/standard> ; s:total ?total ; s:energy ?energy ; s:gridusage ?grid ; s:operator ?operator . BIND(STRAFTER(STR(?m), "municipality/") AS ?bfs) } }`;
  const q = elQuery(codes);
  const elUrl = `https://lindas.admin.ch/query`;
  const res = await get(elUrl, { Accept: 'text/csv', 'Content-Type': 'application/x-www-form-urlencoded' }, { method: 'POST', body: new URLSearchParams({ query: q }).toString() });
  const el = res ? parseCsvObjects(await res.text()) : [];
  writeRaw(root, 'lindas-elcom-electricityprice-2027-h4.json', { query: q, rows: el });
  const byBfs = new Map<string, Record<string, string>[]>();
  for (const r of el) byBfs.set(r.bfs!, [...(byBfs.get(r.bfs!) ?? []), r]);
  // The tariff of all places, for a national reference (median of the H4 totals of the pack's Gemeinden is NOT national; the
  // sanity check below compares with the full-Switzerland range ElCom publishes: 15..45 Rp./kWh).
  // BFE register: photovoltaic plants per Gemeinde.
  const zipUrl = 'https://data.geo.admin.ch/ch.bfe.elektrizitaetsproduktionsanlagen/elektrizitaetsproduktionsanlagen/elektrizitaetsproduktionsanlagen_2056.csv.zip';
  const zres = await get(zipUrl, {});
  if (!zres) throw new Error('BFE register not available');
  const lastMod = zres.headers.get('last-modified');
  const stand = lastMod ? new Date(lastMod).toISOString().slice(0, 10) : TODAY;
  mkdirSync(join(root, 'raw', 'bfe'), { recursive: true });
  const zipPath = join(root, 'raw', 'bfe', 'elektrizitaetsproduktionsanlagen_2056.csv.zip');
  writeFileSync(zipPath, Buffer.from(await zres.arrayBuffer()));
  const csv = execFileSync('unzip', ['-p', zipPath, 'ElectricityProductionPlant.csv'], { maxBuffer: 400 * 1024 * 1024 }).toString('utf8').replace(/^﻿/, '');
  const plants = parseCsvObjects(csv).filter((p) => p.SubCategory === 'subcat_2');
  const natN = plants.length, natKw = plants.reduce((a, p) => a + Number(p.TotalPower || 0) / 1, 0);
  // TotalPower is in kW per the register's own unit; the national figure is checked against Swiss PV statistics (about 8-12 GW installed).
  console.log(`CH national PV register: ${natN} plants, ${round(natKw / 1e6, 2)} GW`);
  const nationalOk = natKw / 1e6 > 5 && natKw / 1e6 < 20;
  if (!nationalOk) console.warn('FLAG CH national PV capacity outside the plausible 5-20 GW: installs not published');
  const sums = new Map<string, { n: number; kw: number; names: Set<string> }>();
  for (const c of cities) {
    const lab = label(c), canton = CANTON[c.region];
    const own = plants.filter((p) => p.Canton === canton && (p.Municipality === lab || norm(p.Municipality!) === norm(lab)));
    sums.set(c.slug, { n: own.length, kw: own.reduce((a, p) => a + Number(p.TotalPower || 0), 0), names: new Set(own.map((p) => p.Municipality!)) });
  }
  writeRaw(root, 'bfe-pv-plants-per-gemeinde.json', { source: zipUrl, last_modified: lastMod, national: { plants: natN, kw: natKw }, places: Object.fromEntries([...sums].map(([k, v]) => [k, { n: v.n, kw: v.kw, municipality_names: [...v.names] }])) });

  const out: string[][] = [];
  for (const c of cities) {
    const p = bfs.get(c.slug);
    if (!p) continue;
    const loc = `city:${c.slug}`;
    const e = byBfs.get(p.code) ?? [];
    if (e.length === 1) {
      const total = Number(e[0]!.total), energy = Number(e[0]!.energy), grid = Number(e[0]!.grid);
      const ok = total >= 15 && total <= 45;
      sanity.push({ place: c.slug, metric: 'electricity_price_h4_rp_per_kwh', value: total, national: 30, delta: round(total - 30, 1), verdict: ok ? 'ok' : 'flag' });
      if (ok) out.push(row('electricity_price_h4_rp_per_kwh', loc, total, 'Rp./kWh', '2027-01-01', '2027-12-31', `https://lindas.admin.ch/query?query=${encodeURIComponent(elQuery([p.code]))}`, 'ElCom (Eidgenoessische Elektrizitaetskommission)', `${c.name} (BFS ${p.code}): total ${total} Rp./kWh in 2027 for category H4, standard product (energy ${energy}, grid usage ${grid}, remainder charges and levies); operator ${e[0]!.operator!.split('/').pop()}.`));
      else console.warn(`FLAG CH ${c.slug}: tariff ${total} outside 15-45 Rp./kWh; not published`);
    } else console.warn(`CH ${c.slug}: ${e.length} ElCom observations for BFS ${p.code} (need exactly one operator): tariff skipped`);
    const s = sums.get(c.slug)!;
    if (nationalOk && s.n > 0) {
      out.push(row('pv_installations_cumulative', loc, s.n, 'installations', stand, '', zipUrl, 'BFE (Bundesamt fuer Energie), Elektrizitaetsproduktionsanlagen', `${c.name}: ${s.n} photovoltaic plants of all sizes registered in the BFE register of electricity production plants (Municipality "${[...s.names].join('", "')}", canton ${CANTON[c.region]}; file dated ${stand}).`));
      out.push(row('pv_capacity_mw_cumulative', loc, round(s.kw / 1000, 2), 'MW', stand, '', zipUrl, 'BFE (Bundesamt fuer Energie), Elektrizitaetsproduktionsanlagen', `${c.name}: ${round(s.kw, 0)} kW total power (TotalPower, summed over the same plants); shown in MW.`));
    }
  }
  writeRaw(root, 'sanity.json', { national: { pv_plants: natN, pv_capacity_gw: natKw / 1e6, elcom_h4_plausible_range_rp_per_kwh: [15, 45] }, rows: sanity });
  writeFileSync(join(root, 'places_local.csv'), toCsv(HEADER, out));
  console.log(`CH: ${cities.length} pack cities, ${bfs.size} matched to a Gemeinde, ${out.length} fact rows`);
}

for (const cc of ['it', 'ch']) {
  if (only.size && !only.has(cc)) continue;
  const root = join(dir, cc);
  mkdirSync(join(root, 'raw'), { recursive: true });
  await (cc === 'it' ? fetchIt(root) : fetchCh(root));
}
