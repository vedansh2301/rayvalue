// Warms the CDN cache for every on-demand /_image variant referenced by the given pages, so no visitor waits for the
// first-hit resize. Usage: node scripts/warm-images.mjs [origin] [path ...]  (defaults: https://rayvalue.com and the
// home page plus every country hub listed in /llms.txt).
const origin = process.argv[2] ?? 'https://rayvalue.com';
let paths = process.argv.slice(3);
const UA = 'Mozilla/5.0 (compatible; RayValue-warmup/1.0)';
const get = (u, accept) => fetch(u, { headers: { 'User-Agent': UA, ...(accept ? { Accept: accept } : {}) } });
if (paths.length === 0) {
  const llms = await (await get(`${origin}/llms.txt`)).text();
  const hubs = [...llms.matchAll(new RegExp(`${origin.replace(/[.]/g, '\\.')}/([a-z]{2})/llms\\.txt`, 'g'))].map((m) => `/${m[1]}`);
  paths = ['/', '/guides', '/blog', ...new Set(hubs)];
}
const urls = new Set();
for (const p of paths) {
  const html = await (await get(origin + p)).text();
  for (const m of html.matchAll(/\/_image\?[^"'\s,]+/g)) urls.add(m[0].replace(/&amp;/g, '&'));
}
let done = 0; let slow = 0;
const list = [...urls];
const worker = async () => {
  while (list.length) {
    const u = list.pop();
    const t = Date.now();
    const r = await get(origin + u, 'image/avif,image/webp,*/*').catch(() => null);
    if (r) await r.arrayBuffer().catch(() => null);
    if (Date.now() - t > 800) slow++;
    done++;
  }
};
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`warmed ${done} image variants from ${paths.length} pages (${slow} were cold)`);
