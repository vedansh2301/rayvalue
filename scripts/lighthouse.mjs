// Runs Lighthouse (mobile defaults) against `astro preview`. Does not build; run `npm run build` first.
// Usage: npm run lighthouse [-- /path /other-path ...]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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

const server = spawn('npx', ['astro', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
const chrome = { instance: null };

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('astro preview did not start');
}

let failed = false;
try {
  await waitForServer();
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
  server.kill();
}
process.exit(failed ? 1 : 0);
