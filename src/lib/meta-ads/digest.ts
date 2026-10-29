/**
 * Daily ads email (pure, unit tested): today so far and the last 7 days per ad account day (IST), spend by viewer
 * hour over the same 7 days, money left before the account spending limit, and the hour schedule. Only numbers Meta
 * returned are shown; derived ones (cost per click, days left) are plain divisions of them. No "best hour" verdicts:
 * the owner reads the hour table.
 */
import { count, inr, pct } from './view';
import type { InsightMetrics } from './types';

export interface DigestDay extends InsightMetrics {
  date: string;
}

export interface DigestHour extends InsightMetrics {
  /** Meta's label, e.g. "20:00:00 - 20:59:59", in the viewer's time zone. */
  label: string;
}

export interface DigestInput {
  /** YYYY-MM-DD in the ad account time zone. */
  today: string;
  since: string;
  timezone: string;
  /** Account-level daily rows; days with no delivery are missing. */
  days: DigestDay[];
  hours: DigestHour[];
  spendCapInr: number | null;
  amountSpentInr: number | null;
  capPerDayInr: number;
  adset: { id: string; status: string | null; endTime: string | null } | null;
  schedule: { enabled: boolean; timezone: string; windows: string } | null;
  dashboardUrl: string;
}

const sum = (rows: InsightMetrics[], k: 'spendInr' | 'impressions' | 'linkClicks' | 'leads' | 'thruplays') => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
const perClick = (spend: number, clicks: number) => (clicks > 0 ? inr(spend / clicks) : 'no clicks');
const cpm = (spend: number, imps: number) => (imps > 0 ? inr((spend / imps) * 1000) : '-');

function line(label: string, r: InsightMetrics[]): string {
  const spend = sum(r, 'spendInr');
  const imps = sum(r, 'impressions');
  const clicks = sum(r, 'linkClicks');
  return `${label}: spent ${inr(spend)}, shown ${count(imps)}x, ${count(clicks)} link clicks (${perClick(spend, clicks)} each), ${count(sum(r, 'leads'))} leads, ${count(sum(r, 'thruplays'))} full video views, ${cpm(spend, imps)} per 1,000 views`;
}

export function buildDigest(i: DigestInput): { subject: string; text: string } {
  const today = i.days.filter((d) => d.date === i.today);
  const spendToday = sum(today, 'spendInr');
  const subject = `RayValue ads ${i.today}: ${inr(spendToday)} spent, ${count(sum(today, 'linkClicks'))} clicks, ${count(sum(today, 'leads'))} leads`;

  const dayRows: string[] = [];
  for (let d = new Date(`${i.since}T00:00:00Z`); d.toISOString().slice(0, 10) <= i.today; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const r = i.days.find((x) => x.date === date);
    dayRows.push(`  ${date}${date === i.today ? ' (so far)' : ''}: ${r ? `${inr(r.spendInr ?? 0)}, ${count(r.impressions ?? 0)} views, ${count(r.linkClicks ?? 0)} clicks, ${count(r.leads ?? 0)} leads` : 'no delivery'}`);
  }

  const hourRows = [...i.hours]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((h) => `  ${h.label.slice(0, 5)}: ${inr(h.spendInr ?? 0)}, ${count(h.impressions ?? 0)} views, ${count(h.linkClicks ?? 0)} clicks, ${cpm(h.spendInr ?? 0, h.impressions ?? 0)} per 1,000, CTR ${pct(h.impressions ? ((h.linkClicks ?? 0) / h.impressions) * 100 : null)}`);

  const left = i.spendCapInr !== null && i.amountSpentInr !== null ? Math.max(0, i.spendCapInr - i.amountSpentInr) : null;
  const money =
    left === null
      ? 'Account spending limit: none set or not readable.'
      : `Left before the account spending limit (${inr(i.spendCapInr)}): ${inr(left)}, about ${Math.floor(left / i.capPerDayInr)} more days at ${inr(i.capPerDayInr)}/day. Ads stop when it runs out.`;

  const text = [
    `Ad account days run midnight to midnight ${i.timezone}, so "today" holds last night's US evening.`,
    '',
    line(`Today so far (${i.today})`, today),
    line(`Last 7 days (${i.since} to ${i.today})`, i.days),
    '',
    'By day:',
    ...dayRows,
    '',
    "By hour, viewer's local time, last 7 days:",
    ...(hourRows.length ? hourRows : ['  no delivery']),
    '',
    money,
    i.adset ? `Ad set ${i.adset.id}: ${i.adset.status ?? 'status not readable'}${i.adset.endTime ? `, ends ${i.adset.endTime}` : ''}.` : 'Ad set: not readable.',
    i.schedule ? `Hour schedule: ${i.schedule.enabled ? 'ON' : 'off'}, ${i.schedule.timezone}, ${i.schedule.windows}.` : 'Hour schedule: not readable.',
    '',
    `Dashboard: ${i.dashboardUrl}`,
  ].join('\n');
  return { subject, text };
}
