/** Minimal Supabase REST + Storage client for the generator (no SDK). Uses the secret key; runs only in scripts / CI, never in site code. */
export interface DbConfig {
  url: string;
  key: string;
}

export const STORAGE_BUCKET = 'social';

export class SocialDb {
  private readonly base: string;

  constructor(private readonly cfg: DbConfig) {
    this.base = cfg.url.replace(/\/+$/, '');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    // New-style sb_secret_ keys go in `apikey` only; a legacy JWT service key must also be the bearer token.
    return { apikey: this.cfg.key, ...(this.cfg.key.startsWith('eyJ') ? { Authorization: `Bearer ${this.cfg.key}` } : {}), ...extra };
  }

  private async check(res: Response, what: string): Promise<void> {
    if (res.ok) return;
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`${what}: HTTP ${res.status} ${body}`);
  }

  async select<T>(table: string, params: Record<string, string>): Promise<T[]> {
    const u = new URL(`${this.base}/rest/v1/${table}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await fetch(u, { headers: this.headers({ Accept: 'application/json' }), signal: AbortSignal.timeout(20_000) });
    await this.check(res, `select ${table}`);
    return (await res.json()) as T[];
  }

  async insert<T = Record<string, unknown>>(table: string, rows: object | object[]): Promise<T[]> {
    const res = await fetch(`${this.base}/rest/v1/${table}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(20_000),
    });
    await this.check(res, `insert ${table}`);
    return (await res.json()) as T[];
  }

  async update(table: string, filter: Record<string, string>, patch: object): Promise<void> {
    const u = new URL(`${this.base}/rest/v1/${table}`);
    for (const [k, v] of Object.entries(filter)) u.searchParams.set(k, v);
    const res = await fetch(u, { method: 'PATCH', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(patch), signal: AbortSignal.timeout(20_000) });
    await this.check(res, `update ${table}`);
  }

  async remove(table: string, filter: Record<string, string>): Promise<void> {
    const u = new URL(`${this.base}/rest/v1/${table}`);
    for (const [k, v] of Object.entries(filter)) u.searchParams.set(k, v);
    const res = await fetch(u, { method: 'DELETE', headers: this.headers(), signal: AbortSignal.timeout(20_000) });
    await this.check(res, `delete ${table}`);
  }

  publicUrl(path: string): string {
    return `${this.base}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
  }

  async upload(path: string, bytes: Uint8Array, mime: string): Promise<string> {
    const res = await fetch(`${this.base}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': mime, 'x-upsert': 'false', 'Cache-Control': 'max-age=31536000' }),
      body: bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(120_000),
    });
    await this.check(res, `upload ${path}`);
    return this.publicUrl(path);
  }

  async removeObjects(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const res = await fetch(`${this.base}/storage/v1/object/${STORAGE_BUCKET}`, {
      method: 'DELETE',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: paths }),
      signal: AbortSignal.timeout(30_000),
    });
    await this.check(res, 'remove objects');
  }
}
