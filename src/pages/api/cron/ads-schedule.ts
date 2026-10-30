import type { APIRoute } from 'astro';
import { cronGuard, cronJson } from '../../../lib/server/cron';
import { adsEnv, runAdsSchedule } from '../../../lib/server/meta-ads';

export const prerender = false;

/**
 * GET /api/cron/ads-schedule — Switches the ad set named in ads_schedule on inside its hour windows and off outside
 * them or once today's whole-account spend reaches ads_schedule.stop_at_inr (or the daily cap). Every 5 minutes from pg_cron
 * (migrations 0020, 0022) with the CRON_SECRET bearer token. Does nothing while ads_schedule.enabled is false.
 */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronGuard(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const out = await runAdsSchedule(adsEnv(), fetch);
  return cronJson(out.ok ? 200 : 500, out);
};
