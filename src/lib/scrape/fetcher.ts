import { ALLOW_ALL, DISALLOW_ALL, isAllowed, parseRobots, USER_AGENT, type Robots } from './robots';

export interface FetcherOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Minimum gap between two requests to the same host (robots Crawl-delay raises it, capped at 10 s). */
  minHostIntervalMs?: number;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  maxBytes?: number;
}

export interface GetOptions {
  etag?: string | null;
  lastModified?: string | null;
  /** Epoch ms after which no new attempt or wait starts (keeps a cron batch inside the function limit). */
  deadline?: number;
}

export type FetchResult =
  | { kind: 'ok'; status: number; body: Uint8Array; contentType: string; etag: string | null; lastModified: string | null; finalUrl: string }
  | { kind: 'not_modified'; status: 304 }
  | { kind: 'blocked'; reason: string }
  | { kind: 'error'; status: number; error: string };

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const ACCEPT = 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml,application/json,application/pdf,text/csv;q=0.9,*/*;q=0.5';

/** Polite HTTP client: identifying UA, robots.txt, per-host rate limit, conditional GET, retries with backoff, size cap. */
export class Fetcher {
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly minInterval: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly backoffMs: number;
  private readonly maxBytes: number;
  private readonly nextSlot = new Map<string, number>();
  private readonly robots = new Map<string, Promise<Robots>>();

  constructor(o: FetcherOptions = {}) {
    this.f = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
    this.minInterval = o.minHostIntervalMs ?? 2000;
    this.timeoutMs = o.timeoutMs ?? 12000;
    this.retries = o.retries ?? 2;
    this.backoffMs = o.backoffMs ?? 800;
    this.maxBytes = o.maxBytes ?? 15 * 1024 * 1024;
  }

  /** Wait until this host's next slot, reserve the following one. Returns false when the deadline would pass first. */
  private async slot(host: string, delayMs: number, deadline?: number): Promise<boolean> {
    const at = Math.max(this.now(), this.nextSlot.get(host) ?? 0);
    if (deadline !== undefined && at + 500 > deadline) return false;
    this.nextSlot.set(host, at + delayMs);
    const wait = at - this.now();
    if (wait > 0) await this.sleep(wait);
    return true;
  }

  private async request(url: string, headers: Record<string, string>, timeout: number): Promise<Response> {
    return this.f(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  }

  private robotsFor(origin: string, deadline?: number): Promise<Robots> {
    let p = this.robots.get(origin);
    if (!p) {
      p = (async () => {
        if (!(await this.slot(new URL(origin).host, this.minInterval, deadline))) return DISALLOW_ALL;
        try {
          const res = await this.request(`${origin}/robots.txt`, { Accept: 'text/plain,*/*;q=0.5' }, Math.min(this.timeoutMs, 8000));
          if (res.status >= 500) return DISALLOW_ALL; // cannot tell: stay out for this run
          if (!res.ok) return ALLOW_ALL; // 4xx: no robots file
          return parseRobots((await res.text()).slice(0, 500_000));
        } catch {
          return DISALLOW_ALL;
        }
      })();
      this.robots.set(origin, p);
    }
    return p;
  }

  async get(url: string, opts: GetOptions = {}): Promise<FetchResult> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { kind: 'error', status: 0, error: 'invalid url' };
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { kind: 'error', status: 0, error: 'unsupported protocol' };

    const robots = await this.robotsFor(u.origin, opts.deadline);
    if (!isAllowed(robots, u.pathname + u.search)) return { kind: 'blocked', reason: 'disallowed by robots.txt' };
    const delay = Math.min(10_000, Math.max(this.minInterval, (robots.crawlDelay ?? 0) * 1000));

    const headers: Record<string, string> = { Accept: ACCEPT };
    if (opts.etag) headers['If-None-Match'] = opts.etag;
    if (opts.lastModified) headers['If-Modified-Since'] = opts.lastModified;

    let lastError = 'unknown error';
    let lastStatus = 0;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (!(await this.slot(u.host, delay, opts.deadline))) return { kind: 'error', status: lastStatus, error: attempt ? `${lastError} (deadline before retry)` : 'deadline reached' };
      const timeout = opts.deadline !== undefined ? Math.min(this.timeoutMs, opts.deadline - this.now()) : this.timeoutMs;
      if (timeout < 500) return { kind: 'error', status: lastStatus, error: 'deadline reached' };
      let retryAfter = 0;
      try {
        const res = await this.request(url, headers, timeout);
        if (res.status === 304) return { kind: 'not_modified', status: 304 };
        if (res.ok) {
          const body = await readCapped(res, this.maxBytes);
          if (body === null) return { kind: 'error', status: res.status, error: `response larger than ${this.maxBytes} bytes` };
          return { kind: 'ok', status: res.status, body, contentType: res.headers.get('content-type') ?? '', etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), finalUrl: res.url || url };
        }
        lastStatus = res.status;
        lastError = `HTTP ${res.status}`;
        await res.body?.cancel().catch(() => undefined);
        if (!RETRYABLE.has(res.status)) return { kind: 'error', status: res.status, error: lastError };
        const ra = Number(res.headers.get('retry-after'));
        if (Number.isFinite(ra) && ra > 0) retryAfter = Math.min(ra * 1000, 5000);
      } catch (e) {
        lastStatus = 0;
        lastError = e instanceof Error ? (e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : e.message.slice(0, 120)) : 'network error';
      }
      if (attempt < this.retries) {
        const wait = Math.max(retryAfter, this.backoffMs * 2 ** attempt);
        if (opts.deadline !== undefined && this.now() + wait + 500 > opts.deadline) break;
        await this.sleep(wait);
      }
    }
    return { kind: 'error', status: lastStatus, error: lastError };
  }
}

/** Read a body, giving up (null) once it exceeds `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
