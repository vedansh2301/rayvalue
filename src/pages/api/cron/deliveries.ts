import type { APIRoute } from 'astro';
import { timingSafeEqual, createHash } from 'node:crypto';
import { retryDueDeliveries } from '../../../lib/server/routing';

export const prerender = false;

const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** GET /api/cron/deliveries — Vercel Cron (see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export const GET: APIRoute = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return res(503, { ok: false, error: 'CRON_SECRET is not set' });
  const auth = request.headers.get('authorization') ?? '';
  if (!same(auth, `Bearer ${secret}`)) return res(401, { ok: false });
  const out = await retryDueDeliveries(
    {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM,
      OWNER_EMAIL: process.env.OWNER_EMAIL,
      secrets: process.env,
    },
    fetch,
  );
  return res(200, { ok: true, ...out });
};
