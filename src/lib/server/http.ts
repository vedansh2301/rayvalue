/** Small shared helpers for the JSON API routes. */
export const MAX_BODY_BYTES = 8192;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/** Reads a JSON or form body (any fields) up to the size cap; null when unreadable or too big. */
export async function readBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown> | null> {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > maxBytes) return null;
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > maxBytes) return null;
    if (type.includes('application/json')) {
      const v = JSON.parse(text);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    }
    if (type.includes('application/x-www-form-urlencoded')) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of new URLSearchParams(text)) out[k] = v;
      return out;
    }
  } catch {
    return null;
  }
  return null;
}

/** The caller's IP from the proxy headers (Vercel sets x-forwarded-for); null when absent or not an IP. */
export function clientIp(request: Request): string | null {
  const raw = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim() || '';
  return raw.length > 0 && raw.length <= 45 && /^[0-9a-fA-F:.]+$/.test(raw) ? raw : null;
}

/** A page URL reduced to origin + path (no query, no hash) when its origin is ours; else null. */
export function cleanPageUrl(raw: unknown, allowedOrigins: readonly string[]): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  try {
    const u = new URL(raw);
    if (!allowedOrigins.includes(u.origin)) return null;
    const out = `${u.origin}${u.pathname}`;
    return out.length <= 300 ? out : null;
  } catch {
    return null;
  }
}
