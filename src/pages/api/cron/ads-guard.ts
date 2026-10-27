import type { APIRoute } from 'astro';
import { cronGuard, cronJson } from '../../../lib/server/cron';
import { adsEnv, runAdsGuard } from '../../../lib/server/meta-ads';

export const prerender = false;

/**
 * GET /api/cron/ads-guard — Checks the ad guardrails (ads_settings) against a fresh Meta read and emails OWNER_EMAIL
 * when a rule newly trips. Pauses nothing unless ads_settings.auto_pause is true. Hourly from pg_cron (migration 0018)
 * with the CRON_SECRET bearer token. The JSON reply holds rule keys and reasons only, no personal data.
 */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronGuard(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const out = await runAdsGuard(adsEnv(), fetch);
  return cronJson(out.ok ? 200 : 500, out);
};
