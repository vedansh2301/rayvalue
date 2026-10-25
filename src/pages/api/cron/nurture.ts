import type { APIRoute } from 'astro';
import { cronGuard, cronJson } from '../../../lib/server/cron';
import { runNurture } from '../../../lib/server/nurture';

export const prerender = false;

/** GET /api/cron/nurture — Vercel Cron (see vercel.json). Does nothing unless nurture email is configured (docs/LAUNCH.md). */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronGuard(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const out = await runNurture(process.env, fetch);
  return cronJson(200, { ok: true, ...out });
};
