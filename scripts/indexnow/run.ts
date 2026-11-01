// node scripts/indexnow/run.ts --state last.json   submit pages changed since last.json, then update it
//                                                   (.github/workflows/indexnow.yml, after every deploy + every 30 min,
//                                                   which also catches value edits in the database)
// node scripts/indexnow/run.ts --all                submit every URL in the live sitemap
// add --dry-run to print what would be sent.
import { readFileSync, writeFileSync } from 'node:fs';
import { ORIGIN, ENDPOINT, chunks, payload, parseLocs, fingerprint, changedUrls, type State } from './lib.ts';

const UA = 'RayValue-IndexNow/1.0 (+https://rayvalue.com)';
const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? null : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true; };

async function get(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.text();
}

async function sitemapUrls(): Promise<string[]> {
  const out: string[] = [];
  for (const sm of parseLocs(await get(`${ORIGIN}/sitemap-index.xml`))) out.push(...parseLocs(await get(sm)));
  return [...new Set(out)];
}

async function liveState(urls: string[]): Promise<State> {
  const state: State = { checked_at: new Date().toISOString(), urls: {} };
  for (let i = 0; i < urls.length; i += 4) {
    await Promise.all(urls.slice(i, i + 4).map(async (u) => { state.urls[u] = fingerprint(await get(u)); }));
  }
  return state;
}

async function submit(urls: string[]): Promise<number[]> {
  const statuses: number[] = [];
  for (const list of chunks(urls)) {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': UA },
      body: JSON.stringify(payload(list)),
      signal: AbortSignal.timeout(30000),
    });
    statuses.push(r.status);
  }
  return statuses;
}

async function main(): Promise<number> {
  const dry = !!arg('dry-run');
  const urls = await sitemapUrls();
  let toSend: string[];
  let now: State | null = null;
  const statePath = arg('state');
  if (typeof statePath === 'string') {
    let last: State | null = null;
    try { last = JSON.parse(readFileSync(statePath, 'utf8')); if (!last?.urls) last = null; } catch { last = null; }
    now = await liveState(urls);
    toSend = changedUrls(last, now);
    console.log(`indexnow: ${urls.length} sitemap URLs; ${toSend.length} changed/new/removed` + (last ? ` since ${last.checked_at}` : ' (no saved state: all URLs)'));
  } else {
    toSend = urls;
    console.log(`indexnow: ${urls.length} URLs in the live sitemap`);
  }
  if (dry) { console.log(JSON.stringify({ ...payload(toSend.slice(0, 20)), total: toSend.length }, null, 2)); return 0; }
  if (toSend.length) {
    const statuses = await submit(toSend);
    console.log(`indexnow: submitted ${toSend.length} URL(s), HTTP ${statuses.join(', ')}`);
    if (!statuses.every((s) => s === 200 || s === 202)) return 1;
  } else console.log('indexnow: nothing to submit');
  if (now && typeof statePath === 'string') {
    writeFileSync(statePath, JSON.stringify(now));
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, 'saved=true\n', { flag: 'a' });
  }
  return 0;
}

main().then((c) => { process.exitCode = c; }, (e) => { console.error(`indexnow: ${e.message}`); process.exitCode = 1; });
