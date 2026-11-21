/**
 * SERVER-ONLY glue for the on-demand sitemap and llms endpoints: reads the content collections and the database once
 * (cached 60 s per function instance) and returns the one IndexEntry list every endpoint renders from.
 */
import { getCollection } from 'astro:content';
import { ok, err, type Result } from '../db/client';
import { loadDbIndexEntries } from './sitemap-db';
import { articleEntries, staticEntries, type ArticleInput } from './static-entries';
import type { IndexEntry } from './site-index';

const TTL_MS = 60_000;
let cache: { at: number; value: Promise<Result<IndexEntry[]>> } | null = null;

async function load(): Promise<Result<IndexEntry[]>> {
  const [guides, blog] = await Promise.all([getCollection('guides'), getCollection('blog')]);
  const articles: ArticleInput[] = [
    ...guides.map((g): ArticleInput => ({ collection: 'guides', id: g.id, route: g.data.route, title: g.data.title, seoTitle: g.data.seoTitle, description: g.data.description, published: g.data.published, updated: g.data.updated, draft: g.data.draft, noindex: g.data.noindex })),
    ...blog.map((b): ArticleInput => ({ collection: 'blog', id: b.id, route: (b.data as { route?: string }).route, title: b.data.title, seoTitle: b.data.seoTitle, description: b.data.description, published: b.data.published, updated: b.data.updated, draft: (b.data as { draft?: boolean }).draft, noindex: (b.data as { noindex?: boolean }).noindex })),
  ];
  const db = await loadDbIndexEntries();
  if (!db.ok) return err(db.error.kind, db.error.message);
  return ok([...staticEntries(articles), ...articleEntries(articles), ...db.value]);
}

export function getSiteIndex(now = Date.now()): Promise<Result<IndexEntry[]>> {
  if (!cache || now - cache.at > TTL_MS) {
    const value = load().catch((e) => err('network', `site index failed (${e instanceof Error ? e.message : 'error'})`));
    cache = { at: now, value };
    // A failure must not stick: retry on the next request.
    void value.then((r) => { if (!r.ok && cache?.value === value) cache = null; });
  }
  return cache.value;
}

const COMMON = { 'X-Robots-Tag': 'noindex' } as const;
/** Short CDN cache so a city published in the database appears within minutes, with no deploy. */
export const FEED_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=0', 'CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } as const;

export const xmlResponse = (body: string): Response => new Response(body, { headers: { ...COMMON, ...FEED_CACHE_HEADERS, 'Content-Type': 'application/xml; charset=utf-8' } });
export const textResponse = (body: string): Response => new Response(body, { headers: { ...COMMON, ...FEED_CACHE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
/** Database or content failure: never an empty file (an empty sitemap tells crawlers the URLs are gone). */
export const unavailableResponse = (): Response =>
  new Response('Temporarily unavailable\n', { status: 503, headers: { ...COMMON, 'Cache-Control': 'no-store', 'Retry-After': '300', 'Content-Type': 'text/plain; charset=utf-8' } });
export const notFoundResponse = (): Response => new Response('Not found\n', { status: 404, headers: { ...COMMON, 'Cache-Control': 'public, max-age=0', 'CDN-Cache-Control': 'public, s-maxage=60', 'Content-Type': 'text/plain; charset=utf-8' } });
