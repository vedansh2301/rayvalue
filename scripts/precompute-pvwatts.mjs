// Precomputes PVWatts v8 production (1 kW DC) for every city x shading-loss value and upserts it
// into Supabase `public.pvwatts_city_production`. Run manually: `npm run data:pvwatts`.
// ADMIN script (never deployed): reads NREL_API_KEY (falls back to the rate-limited DEMO_KEY),
// SUPABASE_URL and SUPABASE_SECRET_KEY from the environment (npm loads .env.local and .dev.vars).
// Cities and the losses values come from the `cities` and `model_assumptions` tables.
// Resumable: combinations that already have a row are skipped; pass --refresh to refetch all.
// NREL rebranded to NLR (National Laboratory of the Rockies); developer.nrel.gov no longer resolves.

const BASE = 'https://developer.nlr.gov/api/pvwatts/v8.json';
const SOURCE_URL = 'https://developer.nlr.gov/docs/solar/pvwatts/v8/';
const DATASET_NOTE = 'dataset=nsrdb is NSRDB; the response station_info.weather_data_source names the vintage.';
const PARAMS = { system_capacity: 1, module_type: 0, array_type: 1, tilt: 20, azimuth: 180, dataset: 'nsrdb', timeframe: 'monthly' };
const key = process.env.NREL_API_KEY || 'DEMO_KEY';
const usingDemo = key === 'DEMO_KEY';
const refresh = process.argv.includes('--refresh');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const redact = (s) => (usingDemo ? s : String(s).split(key).join('[redacted]'));

const DB_URL = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const DB_KEY = process.env.SUPABASE_SECRET_KEY;
if (!DB_URL || !DB_KEY) {
  console.error('data:pvwatts needs SUPABASE_URL and SUPABASE_SECRET_KEY in the environment (.env.local / .dev.vars)');
  process.exit(1);
}

async function rest(path, init = {}) {
  const res = await fetch(`${DB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: DB_KEY, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 || res.status === 201 ? null : res.json();
}

const cities = await rest('cities?select=state,slug,lat,lon&order=display_order.asc');
const lossRow = (await rest('model_assumptions?select=value&key=eq.pvwatts_system_loss_pct&state=is.null'))[0];
if (!lossRow) throw new Error('model_assumptions.pvwatts_system_loss_pct is missing');
const losses = [...new Set(Object.values(lossRow.value).filter((v) => typeof v === 'number'))].sort((a, b) => a - b);
const existing = new Set((await rest('pvwatts_city_production?select=state,slug,losses')).map((r) => `${r.state}/${r.slug}@${Number(r.losses)}`));

async function fetchOne(city, l) {
  const url = new URL(BASE);
  url.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries({ ...PARAMS, losses: l, lat: city.lat, lon: city.lon })) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 12; attempt++) {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    } catch (e) {
      log('network error', redact(e.cause?.code ?? e.message));
      if (attempt >= 3) return null;
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (res.status === 429) {
      const wait = Math.max(60, Number(res.headers.get('retry-after')) || 0) * 1000;
      log(`rate limited; sleeping ${Math.round((usingDemo ? Math.max(wait, 600000) : wait) / 1000)}s`);
      await sleep(usingDemo ? Math.max(wait, 600000) : wait);
      continue;
    }
    if (!res.ok) { log('HTTP', res.status); return null; }
    const j = await res.json();
    const o = j.outputs;
    if (j.errors?.length || !o || !Array.isArray(o.ac_monthly) || o.ac_monthly.length !== 12 || !(o.ac_annual > 0)) { log('bad response', redact(JSON.stringify(j.errors))); return null; }
    return {
      annual: Math.round(o.ac_annual * 10) / 10,
      monthly: o.ac_monthly.map((m) => Math.round(m * 10) / 10),
      remaining: Number(res.headers.get('x-ratelimit-remaining')),
      station: j.station_info?.weather_data_source,
    };
  }
  return null;
}

let filled = 0;
const failed = [];
for (const c of cities) {
  for (const l of losses) {
    const id = `${c.state}/${c.slug}@${l}`;
    if (!refresh && existing.has(id)) continue;
    const r = await fetchOne(c, l);
    if (r) {
      const row = {
        state: c.state, slug: c.slug, losses: l, annual_kwh_per_kw: r.annual, monthly_kwh_per_kw: r.monthly,
        fetched_on: new Date().toISOString().slice(0, 10), source_url: SOURCE_URL, endpoint: BASE, params: PARAMS,
        dataset_note: DATASET_NOTE, key_kind: usingDemo ? 'DEMO_KEY' : 'api_key',
      };
      await rest('pvwatts_city_production?on_conflict=state,slug,losses', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      });
      filled++;
      log(id, r.annual, `remaining=${r.remaining}`, r.station ?? '');
      if (r.remaining <= 1 && usingDemo) { log('quota exhausted; waiting 1h'); await sleep(3600000 + 5000); }
    } else {
      failed.push(id);
      log(id, 'FAILED (no row written)');
    }
    await sleep(usingDemo ? 3000 : 1000);
  }
}
log(`done; ${filled} rows upserted, ${failed.length} failed`, failed.join(' '));
if (failed.length) process.exitCode = 1;
