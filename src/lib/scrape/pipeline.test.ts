import { describe, expect, it } from 'vitest';
import { Fetcher } from './fetcher';
import { processSource, runDue, type FactRow, type SnapshotRow, type SourceRow, type Store } from './pipeline';
import { summariseByCountry } from './admin-report';

const html = (body: string) => `<html><body><h1>Tariffs</h1>${body}</body></html>`;

function fakeFetch(pages: Record<string, { status?: number; body?: string; type?: string; etag?: string }>, log: { url: string; headers: Headers }[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    log.push({ url, headers: new Headers(init?.headers) });
    if (url.endsWith('/robots.txt')) {
      const r = pages[url];
      return new Response(r?.body ?? '', { status: r?.status ?? 404 });
    }
    const p = pages[url];
    if (!p) return new Response('nope', { status: 404 });
    if (p.etag && new Headers(init?.headers).get('If-None-Match') === p.etag) return new Response(null, { status: 304 });
    return new Response(p.body ?? '', { status: p.status ?? 200, headers: { 'content-type': p.type ?? 'text/html; charset=utf-8', ...(p.etag ? { etag: p.etag } : {}) } });
  }) as typeof fetch;
}

function memStore(sources: SourceRow[], facts: Record<string, FactRow[]> = {}) {
  const snaps: SnapshotRow[] = [];
  const news: unknown[] = [];
  const store: Store = {
    async listDue(limit) {
      return sources.slice(0, limit);
    },
    async claim() {},
    async updateSource(id, patch) {
      Object.assign(sources.find((s) => s.id === id)!, patch);
    },
    async insertSnapshot(r) {
      snaps.push(r);
    },
    async listFacts(id) {
      return facts[id] ?? [];
    },
    async updateFact(id, patch) {
      for (const list of Object.values(facts)) Object.assign(list.find((f) => f.id === id) ?? {}, patch);
    },
    async upsertNews(rows) {
      news.push(...rows);
    },
  };
  return { store, snaps, news };
}

const src = (o: Partial<SourceRow> = {}): SourceRow => ({ id: 's1', country: 'de', url: 'https://example.de/tariff', type: 'regulator', access: 'html', robots_ok: 'unknown', language: 'de', cadence_days: 30, content_hash: null, etag: null, last_modified: null, consecutive_failures: 0, ...o });
const fetcherFor = (pages: Parameters<typeof fakeFetch>[0], log?: { url: string; headers: Headers }[]) => new Fetcher({ fetch: fakeFetch(pages, log), sleep: async () => {}, minHostIntervalMs: 0, retries: 1, backoffMs: 1 });
const PAGE = html('<p>Teileinspeisung bis 10 kW: 7,70 ct/kWh</p>');

describe('processSource', () => {
  it('first fetch: snapshot, hash stored, matching facts confirmed, unverifiable left alone', async () => {
    const s = src();
    const facts: FactRow[] = [
      { id: 'f1', status: 'new', value: '7.70', unit: 'ct/kWh', excerpt: 'Teileinspeisung bis 10 kW: 7,70 ct/kWh' },
      { id: 'f2', status: 'new', value: '99', unit: 'ct/kWh', excerpt: null },
    ];
    const m = memStore([s], { s1: facts });
    const r = await processSource(s, { fetcher: fetcherFor({ [s.url]: { body: PAGE } }), store: m.store });
    expect(r).toMatchObject({ outcome: 'first_fetch', factsConfirmed: 1, factsChanged: 0 });
    expect(m.snaps).toHaveLength(1);
    expect(s.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(facts[0]!.status).toBe('confirmed');
    expect(facts[1]!.status).toBe('new');
  });

  it('changed page flags facts that no longer match as changed and never touches confirmed ones that still match', async () => {
    const s = src();
    const facts: FactRow[] = [
      { id: 'f1', status: 'confirmed', value: '7.70', unit: 'ct/kWh', excerpt: 'Teileinspeisung bis 10 kW: 7,70 ct/kWh' },
      { id: 'f2', status: 'confirmed', value: '12.22', unit: 'ct/kWh', excerpt: 'Volleinspeisung bis 10 kW: 12,22 ct/kWh' },
    ];
    const m = memStore([s], { s1: facts });
    await processSource(s, { fetcher: fetcherFor({ [s.url]: { body: html('<p>Teileinspeisung bis 10 kW: 7,70 ct/kWh</p><p>Volleinspeisung bis 10 kW: 12,22 ct/kWh</p>') } }), store: m.store });
    const old = s.content_hash;
    const r = await processSource(s, { fetcher: fetcherFor({ [s.url]: { body: html('<p>Teileinspeisung bis 10 kW: 7,70 ct/kWh</p><p>Volleinspeisung bis 10 kW: 11,50 ct/kWh</p>') } }), store: m.store });
    expect(r).toMatchObject({ outcome: 'changed', factsConfirmed: 1, factsChanged: 1 });
    expect(s.content_hash).not.toBe(old);
    expect(facts[0]!.status).toBe('confirmed');
    expect(facts[1]!.status).toBe('changed');
    expect((facts[1] as FactRow & { check_note?: string }).check_note).toContain('11,50');
    expect(m.snaps).toHaveLength(2);
  });

  it('unchanged page: no snapshot, only still-unchecked facts are examined', async () => {
    const s = src();
    const m = memStore([s], { s1: [{ id: 'f1', status: 'confirmed', value: '1', unit: 'kWh', excerpt: null }] });
    const f = fetcherFor({ [s.url]: { body: PAGE } });
    await processSource(s, { fetcher: f, store: m.store });
    const r = await processSource(s, { fetcher: f, store: m.store });
    expect(r.outcome).toBe('unchanged');
    expect(m.snaps).toHaveLength(1);
    expect(r.factsChanged).toBe(0);
  });

  it('sends conditional headers and handles 304', async () => {
    const log: { url: string; headers: Headers }[] = [];
    const s = src({ etag: '"v1"', content_hash: 'abc' });
    const m = memStore([s]);
    const r = await processSource(s, { fetcher: fetcherFor({ [s.url]: { body: PAGE, etag: '"v1"' } }, log), store: m.store });
    expect(r.outcome).toBe('not_modified');
    expect(log.find((l) => l.url === s.url)!.headers.get('If-None-Match')).toBe('"v1"');
    expect(log.find((l) => l.url === s.url)!.headers.get('User-Agent')).toBe('RayValueBot/1.0 (+https://rayvalue.com/about)');
    expect(s.content_hash).toBe('abc');
  });

  it('respects robots.txt and registry robots_ok=no without fetching the page', async () => {
    const log: { url: string; headers: Headers }[] = [];
    const s = src();
    const m = memStore([s]);
    const r = await processSource(s, { fetcher: fetcherFor({ 'https://example.de/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /tariff' }, [s.url]: { body: PAGE } }, log), store: m.store });
    expect(r.outcome).toBe('blocked');
    expect(log.some((l) => l.url === s.url)).toBe(false);
    const s2 = src({ id: 's2', robots_ok: 'no' });
    expect((await processSource(s2, { fetcher: fetcherFor({}), store: memStore([s2]).store })).outcome).toBe('blocked');
  });

  it('retries 503 then succeeds; 404 is an error with backoff and failure count', async () => {
    let n = 0;
    const flaky = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.endsWith('/robots.txt')) return new Response('', { status: 404 });
      return ++n === 1 ? new Response('busy', { status: 503 }) : new Response(PAGE, { headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const s = src();
    const f = new Fetcher({ fetch: flaky, sleep: async () => {}, minHostIntervalMs: 0, retries: 2, backoffMs: 1 });
    expect((await processSource(s, { fetcher: f, store: memStore([s]).store })).outcome).toBe('first_fetch');
    expect(n).toBe(2);
    const dead = src({ id: 'd', url: 'https://example.de/gone' });
    const r = await processSource(dead, { fetcher: fetcherFor({}), store: memStore([dead]).store });
    expect(r).toMatchObject({ outcome: 'error', status: 404 });
    expect(dead.consecutive_failures).toBe(1);
  });

  it('ingests relevant news from a feed', async () => {
    const feed = `<rss><channel><item><title>New solar subsidy</title><link>https://example.de/n/1</link></item><item><title>Staff party</title><link>https://example.de/n/2</link></item></channel></rss>`;
    const s = src({ url: 'https://example.de/feed.xml', type: 'rss', access: 'rss', language: 'en' });
    const m = memStore([s]);
    const r = await processSource(s, { fetcher: fetcherFor({ [s.url]: { body: feed, type: 'application/rss+xml' } }), store: m.store });
    expect(r.newsItems).toBe(1);
    expect(m.news).toHaveLength(1);
  });
});

describe('Fetcher', () => {
  it('rate-limits per host using the injected clock', async () => {
    let t = 0;
    const waits: number[] = [];
    const f = new Fetcher({ fetch: fakeFetch({ 'https://a.org/1': { body: 'x' }, 'https://a.org/2': { body: 'x' }, 'https://b.org/1': { body: 'x' } }), now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, minHostIntervalMs: 2000, retries: 0 });
    await f.get('https://a.org/1');
    await f.get('https://a.org/2');
    await f.get('https://b.org/1');
    expect(waits.filter((w) => w >= 2000).length).toBeGreaterThanOrEqual(2); // robots->page and page->page on host a
    expect(Math.max(...waits)).toBeLessThanOrEqual(2000);
  });
  it('gives up before the deadline instead of waiting past it', async () => {
    const f = new Fetcher({ fetch: fakeFetch({ 'https://a.org/1': { body: 'x' } }), now: () => 1000, sleep: async () => {}, minHostIntervalMs: 2000, retries: 0 });
    const r = await f.get('https://a.org/1', { deadline: 1100 });
    expect(r.kind === 'error' || r.kind === 'blocked').toBe(true);
  });
});

describe('runDue', () => {
  it('stops starting new sources after the cutoff', async () => {
    const a = src({ id: 'a', url: 'https://example.de/a' });
    const b = src({ id: 'b', url: 'https://example.de/b' });
    const m = memStore([a, b]);
    let t = 0;
    const out = await runDue({ store: m.store, fetcher: fetcherFor({ [a.url]: { body: PAGE }, [b.url]: { body: PAGE } }), limit: 5, startCutoff: 10, deadline: 100, now: () => new Date((t += 8)) });
    expect(out.processed.length).toBeLessThan(2);
    expect(out.remainingDue).toBe(true);
  });
});

describe('admin summary', () => {
  it('counts per country', () => {
    const rows = summariseByCountry(
      [{ country: 'de', last_status: 200, last_fetched_at: 'x', consecutive_failures: 0 }, { country: 'de', last_status: 404, last_fetched_at: 'x', consecutive_failures: 2 }, { country: 'fr', last_status: -1, last_fetched_at: 'x', consecutive_failures: 0 }],
      [{ country: 'de', status: 'changed' }, { country: 'de', status: 'confirmed' }],
    );
    expect(rows).toEqual([
      { country: 'de', sources: 2, fetched: 2, failing: 1, blocked: 0, facts: 2, confirmed: 1, changed: 1 },
      { country: 'fr', sources: 1, fetched: 1, failing: 0, blocked: 1, facts: 0, confirmed: 0, changed: 0 },
    ]);
  });
});
