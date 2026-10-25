import type { APIRoute } from 'astro';
import { cronGuard, cronJson as res } from '../../../lib/server/cron';
import { retryDueDeliveries } from '../../../lib/server/routing';

export const prerender = false;

/** GET /api/cron/deliveries — Vercel Cron (see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronGuard(request, process.env.CRON_SECRET);
  if (denied) return denied;
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
