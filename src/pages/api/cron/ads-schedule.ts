import type { APIRoute } from 'astro';
import { cronGuard, cronJson } from '../../../lib/server/cron';
import { adsEnv, runAdsSchedule } from '../../../lib/server/meta-ads';

export const prerender = false;

/**
 * GET /api/cron/ads-schedule — Switches the ad set named in ads_schedule on inside its hour windows and off outside
 * them or once today's whole-account spend reaches ads_settings.max_daily_budget_inr. Every 15 minutes from pg_cron
 * (migration 0020) with the CRON_SECRET bearer token. Does nothing while ads_schedule.enabled is false.
 */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronGuard(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const out = await runAdsSchedule(adsEnv(), fetch);
  return cronJson(out.ok ? 200 : 500, out);
};
