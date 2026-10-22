// Runs Lighthouse (mobile defaults) against `astro preview`. Does not build; run `npm run build` first.
// Usage: npm run lighthouse [-- /path /other-path ...]
import { existsSync } from 'node:fs';
import net from 'node:net';
import { preview } from 'astro';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const PORT = 4399;
const THRESHOLD = 95;
const DEFAULT_PATHS = ['/', '/about', '/methodology', '/affiliate-disclosure', '/privacy', '/terms', '/contact'];
const paths = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PATHS;

if (!existsSync('dist')) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

// Fail fast if something already listens on the port (a stale server would serve an old dist/).
const portInUse = await new Promise((resolve) => {
  const socket = net.connect(PORT, '127.0.0.1');
  socket.once('connect', () => (socket.destroy(), resolve(true)));
  socket.once('error', () => resolve(false));
});
if (portInUse) {
  console.error(`Port ${PORT} is already in use; stop that process and retry.`);
  process.exit(1);
}

// Astro's CLI re-spawns itself and the child outlives a kill, so run preview in-process via the API.
const server = await preview({ root: '.', server: { port: PORT, host: '127.0.0.1' }, logLevel: 'error' });

const chrome = { instance: null };

let failed = false;
try {
  chrome.instance = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
  console.log(`${'URL'.padEnd(28)} perf  a11y`);
  for (const path of paths) {
    const result = await lighthouse(`http://127.0.0.1:${PORT}${path}`, {
      port: chrome.instance.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility'],
    });
    const { performance, accessibility } = result.lhr.categories;
    const perf = Math.round(performance.score * 100);
    const a11y = Math.round(accessibility.score * 100);
    const ok = perf >= THRESHOLD && a11y >= THRESHOLD;
    if (!ok) failed = true;
    console.log(`${path.padEnd(28)} ${String(perf).padStart(4)}  ${String(a11y).padStart(4)}  ${ok ? 'ok' : 'FAIL'}`);
  }
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  await chrome.instance?.kill();
  await server.stop();
}
process.exit(failed ? 1 : 0);
