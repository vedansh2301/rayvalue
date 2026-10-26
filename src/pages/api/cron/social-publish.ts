import type { APIRoute } from 'astro';
import { cronGuard, cronJson } from '../../../lib/server/cron';
import { runPublisher, socialEnv } from '../../../lib/server/social-publisher';

export const prerender = false;

/**
 * GET /api/cron/social-publish — called every 15 minutes by .github/workflows/social-cron.yml with
 * `Authorization: Bearer $CRON_SECRET` (Vercel Hobby crons are daily only). Publishes due Instagram posts.
 */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronGuard(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const out = await runPublisher(socialEnv(), fetch);
  return cronJson(out.ok ? 200 : 500, out);
};
