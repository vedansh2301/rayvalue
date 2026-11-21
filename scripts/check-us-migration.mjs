// Verifies the /us/ migration against a build: every URL in the CURRENT live sitemap must resolve, via a single
// permanent redirect, to a URL that is in the NEW build's sitemap. Run after `npm run build`:
//   node scripts/check-us-migration.mjs [liveSitemapUrl]
// Redirect rules are read from what actually ships: .vercel/output/config.json (Astro `redirects`) and the
// `redirects` entries in vercel.json (the city pattern fallback).
import { readFileSync } from 'node:fs';

const LIVE = process.argv[2] ?? 'https://rayvalue.com/sitemap.xml';
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]));

const astro = JSON.parse(readFileSync('.vercel/output/config.json', 'utf8')).routes
  .filter((r) => r.headers?.Location && [301, 308].includes(r.status) && r.src !== '^/(.*)/$')
  .map((r) => ({ re: new RegExp(r.src), to: r.headers.Location, status: r.status, from: 'astro' }));

// vercel.json sources use path-to-regexp params: `:name(regex)` -> `(regex)` with the same order.
const vercel = (JSON.parse(readFileSync('vercel.json', 'utf8')).redirects ?? []).map((r) => {
  const names = [];
  const src = r.source.replace(/:(\w+)\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g, (_, n, re) => (names.push(n), `(${re})`));
  return { re: new RegExp(`^${src}$`), names, to: r.destination, status: r.permanent ? 308 : 307, from: 'vercel.json' };
});

function hop(path) {
  for (const r of [...astro, ...vercel]) {
    const m = r.re.exec(path);
    if (!m) continue;
    let to = r.to;
    (r.names ?? []).forEach((n, i) => { to = to.replace(`:${n}`, m[i + 1]); });
    return { to, status: r.status, from: r.from };
  }
  return null;
}

const liveXml = await (await fetch(LIVE, { headers: { 'User-Agent': 'rayvalue-migration-check' } })).text();
const live = locs(liveXml);
const next = new Set(locs(readFileSync('.vercel/output/static/sitemap.xml', 'utf8')).map((u) => u.pathname));

let pass = 0, fail = 0, same = 0, moved = 0;
for (const u of live) {
  const p = u.pathname;
  const h = hop(p);
  if (!h) {
    // Unmoved URL: must still be in the new sitemap.
    if (next.has(p)) same++; else { fail++; console.log(`FAIL  ${p}: not redirected and missing from new sitemap`); }
    continue;
  }
  moved++;
  const chain = hop(h.to); // a second hop would be a chain
  const issues = [];
  if (chain) issues.push(`redirect chain via ${h.to}`);
  if (!next.has(h.to)) issues.push(`target ${h.to} not in new sitemap`);
  if (next.has(p)) issues.push('old path still in new sitemap');
  if (issues.length) { fail++; console.log(`FAIL  ${p} -> ${h.status} ${h.to} (${h.from}): ${issues.join('; ')}`); }
  else { pass++; if (process.env.VERBOSE) console.log(`ok    ${p} -> ${h.status} ${h.to} (${h.from})`); }
}

// Old URLs must never be in the new sitemap.
const stale = [...next].filter((p) => /^\/(calculator|solar|solar-tax-benefits)(\/|$)/.test(p));
for (const p of stale) { fail++; console.log(`FAIL  new sitemap lists old path ${p}`); }

console.log(`live sitemap: ${live.length} URLs | new sitemap: ${next.size} URLs`);
console.log(`moved: ${moved} (pass ${pass}) | unchanged and still listed: ${same} | failures: ${fail}`);
process.exit(fail ? 1 : 0);
