// Regenerates src/data/zips/{fl,ca}.json from the US Census ZCTA Gazetteer.
// Network is needed only when you run this script; the site build never does.
//
//   node scripts/build-zips.mjs [--year 2026] [--tmp /path/to/empty/dir]
//
// The downloaded zip is kept in a temp dir (never in the repo).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src', 'data', 'zips');

/** ZIP prefix rules (first 3 digits). FL: 320-339, 341, 342, 344, 346, 347, 349. CA: 900-961. */
export const FL_PREFIXES = new Set([
  ...range(320, 339), 341, 342, 344, 346, 347, 349,
].map(String));
export const CA_PREFIXES = new Set(range(900, 961).map(String));

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/** Parse the gazetteer text (pipe or tab delimited) into { fl, ca } maps. */
export function parseGazetteer(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const delim = lines[0].includes('|') ? '|' : '\t';
  const header = lines[0].split(delim).map((h) => h.trim());
  const iGeoid = header.indexOf('GEOID');
  const iLat = header.indexOf('INTPTLAT');
  const iLon = header.indexOf('INTPTLONG');
  if (iGeoid < 0 || iLat < 0 || iLon < 0) throw new Error(`Unexpected gazetteer header: ${header.join(',')}`);
  const fl = {};
  const ca = {};
  for (const line of lines.slice(1)) {
    const cols = line.split(delim).map((c) => c.trim());
    const zip = cols[iGeoid];
    if (!/^\d{5}$/.test(zip)) continue;
    const lat = Number(cols[iLat]);
    const lon = Number(cols[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const entry = [Number(lat.toFixed(4)), Number(lon.toFixed(4))];
    const prefix = zip.slice(0, 3);
    if (FL_PREFIXES.has(prefix)) fl[zip] = entry;
    else if (CA_PREFIXES.has(prefix)) ca[zip] = entry;
  }
  return { fl, ca };
}

function sortedCompact(obj) {
  const keys = Object.keys(obj).sort();
  return '{\n' + keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`).join(',\n') + '\n}\n';
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag, dflt) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : dflt);
  const year = get('--year', '2026');
  const tmp = get('--tmp', null) ?? mkdtempSync(join(tmpdir(), 'ray-gazetteer-'));
  mkdirSync(tmp, { recursive: true });
  if (resolve(tmp).startsWith(root)) throw new Error('Refusing to use a temp dir inside the repo.');

  const url = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${year}_Gazetteer/${year}_Gaz_zcta_national.zip`;
  const zipPath = join(tmp, `${year}_Gaz_zcta_national.zip`);
  if (!existsSync(zipPath)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  // `unzip -p` streams the single .txt member to stdout; no files are extracted to disk.
  const text = execFileSync('unzip', ['-p', zipPath], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  const { fl, ca } = parseGazetteer(text);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'fl.json'), sortedCompact(fl));
  writeFileSync(join(outDir, 'ca.json'), sortedCompact(ca));
  const meta = {
    source: 'US Census Bureau ZIP Code Tabulation Area (ZCTA) Gazetteer, internal point (INTPTLAT/INTPTLONG)',
    source_url: url,
    gazetteer_year: Number(year),
    downloaded_on: new Date().toISOString().slice(0, 10),
    fl_prefixes: '320-339, 341, 342, 344, 346, 347, 349',
    ca_prefixes: '900-961',
    fl_count: Object.keys(fl).length,
    ca_count: Object.keys(ca).length,
    note: 'Coordinates are ZCTA internal points (approximate area centres), rounded to 4 decimals. ZIP to state is by 3-digit prefix, so a few ZCTAs that straddle a state line are assigned by prefix only.',
  };
  writeFileSync(join(outDir, '_meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`FL: ${meta.fl_count} ZIPs, CA: ${meta.ca_count} ZIPs from ${url}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
