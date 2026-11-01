// IndexNow for rayvalue.com: tell Bing, Yandex, Seznam and Naver which pages changed. Pages render on demand from
// the database, so there is no build manifest: each page is fingerprinted from its live HTML (title, description,
// visible <main> text) and compared with the fingerprints submitted last time.
import { createHash } from 'node:crypto';

export const INDEXNOW_KEY = '70f16a7dc1cf493292233a9a10bba29d';
export const HOST = 'rayvalue.com';
export const ORIGIN = `https://${HOST}`;
export const ENDPOINT = 'https://api.indexnow.org/indexnow';
export const MAX_PER_CALL = 10000;

export type State = { checked_at: string; urls: Record<string, string> };

/** <loc> values of a sitemap or sitemap index, de-duplicated, in order. */
export function parseLocs(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const u = m[1].replace(/&amp;/g, '&');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** What a reader or search engine sees: title, meta description and the visible text of <main>. Scripts, styles and
 * attributes (CSP nonces, asset hashes) are left out so a redeploy alone does not count as a change. */
export function fingerprint(html: string): string {
  const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '';
  const desc = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
  const robots = /<meta name="robots" content="([^"]*)"/.exec(html)?.[1] ?? '';
  const main = /<main\b[\s\S]*?<\/main>/.exec(html)?.[0] ?? html;
  const text = main
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update([title, desc, robots, text].join('\n')).digest('hex').slice(0, 16);
}

/** URLs that are new, changed or gone since `last` (gone ones now 404 or are noindex, which tells engines to drop them). */
export function changedUrls(last: State | null, now: State): string[] {
  if (!last) return Object.keys(now.urls);
  const out = Object.keys(now.urls).filter((u) => last.urls[u] !== now.urls[u]);
  for (const u of Object.keys(last.urls)) if (!(u in now.urls)) out.push(u);
  return out.filter((u) => u === ORIGIN || u.startsWith(`${ORIGIN}/`));
}

export function chunks<T>(list: T[], n = MAX_PER_CALL): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function payload(urlList: string[]) {
  return { host: HOST, key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList };
}
