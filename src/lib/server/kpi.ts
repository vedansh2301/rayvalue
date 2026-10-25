/** KPI report data (server only; uses SUPABASE_SECRET_KEY). Read-only. */
import { buildReport, weekStart, type KpiBuyer, type KpiDelivery, type KpiInput, type KpiLead, type Report } from '../kpi/report';
import { adminSelectAll, type AdminEnv } from './admin-db';

export const DEFAULT_WEEKS = 8;
export const MAX_WEEKS = 26;

export const clampWeeks = (raw: string | null): number => {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(MAX_WEEKS, Math.max(1, n)) : DEFAULT_WEEKS;
};

export interface KpiData {
  report: Report;
  from: string;
  weeks: number;
  /** false when kpi_weekly_inputs could not be read (migration 0010 not applied): web-funnel and ad-spend columns stay empty. */
  inputsAvailable: boolean;
}

export async function loadKpi(env: AdminEnv, weeks: number, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<KpiData | null> {
  const thisMonday = weekStart(now.toISOString());
  const from = new Date(Date.parse(`${thisMonday}T00:00:00Z`) - (weeks - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
  const [leads, deliveries, buyers, inputs] = await Promise.all([
    adminSelectAll<KpiLead>(env, 'leads', { select: 'id,created_at,status,phone_verified,source,utm_source', created_at: `gte.${from}T00:00:00Z`, order: 'created_at.asc' }, fetchImpl),
    adminSelectAll<KpiDelivery>(env, 'lead_deliveries', { select: 'lead_id,buyer_id,status,price', created_at: `gte.${from}T00:00:00Z`, order: 'created_at.asc' }, fetchImpl),
    adminSelectAll<KpiBuyer>(env, 'buyers', { select: 'id,name,price' }, fetchImpl),
    adminSelectAll<KpiInput>(env, 'kpi_weekly_inputs', { select: 'week_start,source,ad_spend,calc_starts,calc_completes,results_cta_clicks,quote_form_starts', week_start: `gte.${from}` }, fetchImpl),
  ]);
  if (!leads || !deliveries || !buyers) return null;
  // numeric columns may arrive as strings from PostgREST
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const clean = (inputs ?? []).map((i) => ({ ...i, ad_spend: num(i.ad_spend), source: i.source ?? '' }));
  return {
    report: buildReport(
      leads,
      deliveries.map((d) => ({ ...d, price: num(d.price) })),
      buyers.map((b) => ({ ...b, price: num(b.price) })),
      clean,
    ),
    from,
    weeks,
    inputsAvailable: inputs !== null,
  };
}
