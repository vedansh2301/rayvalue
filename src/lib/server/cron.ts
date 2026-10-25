import { createHash, timingSafeEqual } from 'node:crypto';

const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
export const cronJson = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. null = authorized, otherwise the Response to return. */
export function cronGuard(request: Request, secret: string | undefined): Response | null {
  if (!secret || secret.length < 16) return cronJson(503, { ok: false, error: 'CRON_SECRET is not set' });
  return same(request.headers.get('authorization') ?? '', `Bearer ${secret}`) ? null : cronJson(401, { ok: false });
}
