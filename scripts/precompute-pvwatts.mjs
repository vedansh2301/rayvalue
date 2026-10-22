// Precomputes PVWatts v8 production (1 kW DC) for every city x shading-loss value and writes
// src/data/pvwatts-cities.json. Run manually (`npm run data:pvwatts`); the build never calls the API.
//   NREL_API_KEY=... npm run data:pvwatts      (falls back to NREL's rate-limited public DEMO_KEY)
// Resumable: entries already present with real data are kept; only nulls/missing are fetched.
// NREL rebranded to NLR (National Laboratory of the Rockies); developer.nrel.gov no longer resolves.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src/data/pvwatts-cities.json');
const BASE = 'https://developer.nlr.gov/api/pvwatts/v8.json';
const PARAMS = { system_capacity: 1, module_type: 0, array_type: 1, tilt: 20, azimuth: 180, dataset: 'nsrdb', timeframe: 'monthly' };
const key = process.env.NREL_API_KEY || 'DEMO_KEY';
const usingDemo = key === 'DEMO_KEY';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const cities = JSON.parse(readFileSync(join(root, 'src/data/cities.json'), 'utf8')).cities;
const assumptions = JSON.parse(readFileSync(join(root, 'src/data/assumptions.json'), 'utf8'));
const losses = [...new Set(Object.values(assumptions.pvwatts_system_loss_pct).filter((v) => typeof v === 'number'))].sort((a, b) => a - b);

const existing = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
const data = {};
for (const c of cities) {
  const id = `${c.state}/${c.slug}`;
  data[id] = {};
  for (const l of losses) data[id][String(l)] = existing[id]?.[String(l)] ?? null;
}

function save() {
  const meta = { fetched_on: new Date().toISOString().slice(0, 10), source_url: 'https://developer.nlr.gov/docs/solar/pvwatts/v8/', endpoint: BASE, params: PARAMS, dataset_note: 'dataset=nsrdb is NSRDB; the response station_info.weather_data_source names the vintage.', key_kind: usingDemo ? 'DEMO_KEY' : 'api_key' };
  writeFileSync(out, JSON.stringify({ ...data, _meta: meta }, null, 2) + '\n');
}

async function fetchOne(city, l) {
  const url = new URL(BASE);
  url.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries({ ...PARAMS, losses: l, lat: city.lat, lon: city.lon })) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 12; attempt++) {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    } catch (e) {
      log('network error', e.cause?.code ?? e.message);
      if (attempt >= 3) return null;
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (res.status === 429) {
      const wait = Math.max(60, Number(res.headers.get('retry-after')) || 0) * 1000 || 600000;
      log(`rate limited; sleeping ${Math.round(wait / 1000)}s`);
      await sleep(wait > 60000 ? wait : 600000);
      continue;
    }
    if (!res.ok) { log('HTTP', res.status); return null; }
    const j = await res.json();
    const o = j.outputs;
    if (j.errors?.length || !o || !Array.isArray(o.ac_monthly) || o.ac_monthly.length !== 12 || !(o.ac_annual > 0)) { log('bad response', JSON.stringify(j.errors)); return null; }
    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    return { value: { annual: Math.round(o.ac_annual * 10) / 10, monthly: o.ac_monthly.map((m) => Math.round(m * 10) / 10) }, remaining, station: j.station_info?.weather_data_source };
  }
  return null;
}

let n = 0;
for (const c of cities) {
  for (const l of losses) {
    const id = `${c.state}/${c.slug}`;
    if (data[id][String(l)]) continue;
    const r = await fetchOne(c, l);
    n++;
    if (r) { data[id][String(l)] = r.value; save(); log(id, l, r.value.annual, `remaining=${r.remaining}`, r.station ?? ''); if (r.remaining <= 1 && usingDemo) { log('quota exhausted; waiting 1h'); await sleep(3600000 + 5000); } }
    else log(id, l, 'FAILED (left null)');
    await sleep(usingDemo ? 3000 : 1000);
  }
}
save();
const missing = Object.entries(data).flatMap(([id, v]) => Object.entries(v).filter(([, x]) => x === null).map(([l]) => `${id}@${l}`));
log(`done; ${missing.length} null entries`, missing.join(' '));
