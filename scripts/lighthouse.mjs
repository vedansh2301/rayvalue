// Runs Lighthouse (mobile defaults) against a tiny static server over the Vercel build output
// (.vercel/output/static; astro preview is unsupported by the Vercel adapter). On-demand pages (API/DB) are not served. Does not build; run `npm run build` first.
// Usage: npm run lighthouse [-- /path /other-path ...]
// On-demand pages (calculators, methodology) need a running server: set LIGHTHOUSE_BASE_URL (e.g. an `astro dev`
// URL, with .env.local loaded) to audit paths there instead of the static build. Dev builds are unminified, so
// treat their performance score as a floor and use them mainly for accessibility and layout shift.
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import net from 'node:net';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const PORT = 4399;
const THRESHOLD = 95;
const DEFAULT_PATHS = ['/', '/quotes', '/about', '/guides', '/404'];
const paths = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PATHS;

const BASE = process.env.LIGHTHOUSE_BASE_URL?.replace(/\/+$/, '') ?? null;
const ROOT = '.vercel/output/static';
if (!BASE && !existsSync(ROOT)) {
  console.error(`${ROOT} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

// Fail fast if something already listens on the port (a stale server would serve an old dist/).
const portInUse = BASE ? false : await new Promise((resolve) => {
  const socket = net.connect(PORT, '127.0.0.1');
  socket.once('connect', () => (socket.destroy(), resolve(true)));
  socket.once('error', () => resolve(false));
});
if (portInUse) {
  console.error(`Port ${PORT} is already in use; stop that process and retry.`);
  process.exit(1);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.json': 'application/json', '.avif': 'image/avif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };
const extraHeaders = {};
for (const rule of JSON.parse(readFileSync('vercel.json', 'utf8')).headers ?? []) {
  if (rule.source === '/(.*)') for (const h of rule.headers) extraHeaders[h.key] = h.value; // site-wide headers (CSP etc.)
}
const resolveFile = (urlPath) => {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  for (const c of [join(ROOT, clean), join(ROOT, clean, 'index.html'), join(ROOT, clean + '.html')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
};
const server = http.createServer((req, res) => {
  const file = resolveFile(req.url);
  const target = file ?? join(ROOT, '404.html');
  res.writeHead(file ? 200 : 404, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream', ...extraHeaders });
  res.end(readFileSync(target));
});
if (!BASE) await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const chrome = { instance: null };

let failed = false;
try {
  chrome.instance = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
  console.log(`${'URL'.padEnd(28)} perf  a11y   CLS    LCP(ms)`);
  for (const path of paths) {
    const result = await lighthouse(`${BASE ?? `http://127.0.0.1:${PORT}`}${path}`, {
      port: chrome.instance.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility'],
    });
    const { performance, accessibility } = result.lhr.categories;
    const perf = Math.round(performance.score * 100);
    const a11y = Math.round(accessibility.score * 100);
    const cls = result.lhr.audits['cumulative-layout-shift'].numericValue;
    const lcp = Math.round(result.lhr.audits['largest-contentful-paint'].numericValue);
    const ok = perf >= THRESHOLD && a11y >= THRESHOLD;
    if (!ok) failed = true;
    console.log(`${path.padEnd(28)} ${String(perf).padStart(4)}  ${String(a11y).padStart(4)}  ${cls.toFixed(3).padStart(6)} ${String(lcp).padStart(7)}  ${ok ? 'ok' : 'FAIL'}`);
  }
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  await chrome.instance?.kill();
  if (!BASE) await new Promise((r) => server.close(r));
}
process.exit(failed ? 1 : 0);
