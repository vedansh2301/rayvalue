/**
 * Vercel Web Analytics API responses for the site funnel panel (pure, unit tested).
 *
 * API (checked 2026-10-27): https://vercel.com/docs/analytics/web-analytics-api and the REST reference
 * https://vercel.com/docs/rest-api/web-analytics/aggregates-custom-events . Bearer token, projectId (+ teamId),
 * since / until, `by` = up to two dimensions (repeated query parameter, the OpenAPI default for an array), OData `filter`.
 *   GET https://api.vercel.com/v1/query/web-analytics/visits/aggregate?by=utmCampaign -> data[]: { utmCampaign, pageviews, visitors }
 *   GET https://api.vercel.com/v1/query/web-analytics/events/aggregate?by=eventName&by=utmCampaign -> data[]: { eventName, utmCampaign, count, visitors }
 * On this team (Hobby plan) custom events answer HTTP 402 "Accessing Analytics custom events requires an Enterprise or
 * Pro plan" (seen 2026-10-27 through the CLI); page views work.
 */
import { EVENT_PROPS } from '../events';

export const VERCEL_API = 'https://api.vercel.com';

/** The funnel events this dashboard asks for (all are defined in src/lib/events.ts). */
export const FUNNEL_EVENTS = ['calc_start', 'calc_complete', 'quote_form_start', 'quote_submit', 'nav_click'] as const satisfies readonly (keyof typeof EVENT_PROPS)[];

export const NOT_SET = '(not set)';

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const label = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : NOT_SET);
const rows = (body: unknown): Raw[] => {
  const d = body && typeof body === 'object' ? (body as Raw).data : null;
  return Array.isArray(d) ? (d.filter((x) => x && typeof x === 'object') as Raw[]) : [];
};

export function parseVisitsByCampaign(body: unknown): { campaign: string; pageviews: number; visitors: number }[] {
  return rows(body)
    .flatMap((r) => {
      const pv = n(r.pageviews);
      return pv === null ? [] : [{ campaign: label(r.utmCampaign), pageviews: pv, visitors: n(r.visitors) ?? 0 }];
    })
    .sort((a, b) => b.pageviews - a.pageviews || a.campaign.localeCompare(b.campaign));
}

export function parseEventsByCampaign(body: unknown): { event: string; campaign: string; count: number }[] {
  return rows(body)
    .flatMap((r) => {
      const c = n(r.count);
      return c === null || typeof r.eventName !== 'string' ? [] : [{ event: r.eventName, campaign: label(r.utmCampaign), count: c }];
    })
    .sort((a, b) => a.event.localeCompare(b.event) || b.count - a.count);
}

/** OData filter for the funnel events. */
export const eventsFilter = () => `eventName in (${FUNNEL_EVENTS.map((e) => `'${e}'`).join(', ')})`;

/** Human reason for a failed Vercel call (no token text). */
export function vercelError(status: number, body: unknown): string {
  const msg = body && typeof body === 'object' ? ((body as { error?: { message?: unknown; code?: unknown } }).error ?? null) : null;
  const text = msg && typeof msg.message === 'string' ? msg.message.slice(0, 200) : null;
  if (status === 402) return `Vercel answered 402 (payment required)${text ? `: ${text}` : ''}. Custom events through the API need the Pro or Enterprise plan.`;
  if (status === 401 || status === 403) return `Vercel answered ${status}: the token cannot read Web Analytics for this project.`;
  return `Vercel answered ${status}${text ? `: ${text}` : ''}.`;
}
