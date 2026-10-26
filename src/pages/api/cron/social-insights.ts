import type { APIRoute } from 'astro';
import { cronGuard, cronJson } from '../../../lib/server/cron';
import { runInsightsSync, socialEnv } from '../../../lib/server/social-publisher';

export const prerender = false;

/** GET /api/cron/social-insights — Stores Instagram and Facebook Page insights for posts published in the last 30 days (daily). Called by .github/workflows/social-cron.yml with the CRON_SECRET bearer token. */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronGuard(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const out = await runInsightsSync(socialEnv(), fetch);
  return cronJson(out.error ? 500 : 200, { ...out, ok: !out.error });
};
