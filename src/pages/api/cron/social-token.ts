import type { APIRoute } from 'astro';
import { cronGuard, cronJson } from '../../../lib/server/cron';
import { runTokenRefresh, socialEnv } from '../../../lib/server/social-publisher';

export const prerender = false;

/** GET /api/cron/social-token — Refreshes the Instagram access token (daily). Called by .github/workflows/social-cron.yml with the CRON_SECRET bearer token. */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronGuard(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const out = await runTokenRefresh(socialEnv(), fetch);
  return cronJson(out.error ? 500 : 200, { ...out, ok: !out.error });
};
