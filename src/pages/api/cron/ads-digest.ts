import type { APIRoute } from 'astro';
import { cronGuard, cronJson } from '../../../lib/server/cron';
import { adsEnv, runAdsDigest } from '../../../lib/server/meta-ads';

export const prerender = false;

/**
 * GET /api/cron/ads-digest — Emails OWNER_EMAIL the daily ads numbers (today so far, last 7 days by day and by viewer
 * hour, money left before the account spending limit, the hour schedule). Daily at 09:05 IST from pg_cron
 * (migration 0021), after the US evening window. The JSON reply holds no numbers or personal data.
 */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronGuard(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const out = await runAdsDigest(adsEnv(), fetch);
  return cronJson(out.ok ? 200 : 500, out);
};
