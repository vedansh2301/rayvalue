/**
 * Parsing of Marketing API (Graph v26.0) responses into the snapshot shapes (pure, unit tested). Nothing here makes
 * up a value: a missing or malformed field becomes null, and the page shows "not available".
 *
 * Checked 2026-10-27, read-only, against ad account act_... with the system-user Page token:
 * - GET /act_<id>?fields=name,currency,timezone_name,account_status,spend_cap,amount_spent
 * - GET /act_<id>/{campaigns|adsets|ads}?fields=...effective_status,configured_status,issues_info,daily_budget,...
 *   Drafts made in Ads Manager are not returned (a draft ad's id answers "does not exist", subcode 33).
 * - GET /act_<id>/insights?level=account|campaign|adset|ad&date_preset=maximum (lifetime) and
 *   &time_range={"since","until"}&time_increment=1 (per day, in the ad account's time zone).
 *   Every field requested below was accepted by the API's field-name check (an unknown field returns error #100).
 * Money: budgets, spend_cap and amount_spent are in the currency's minor unit; the offset for INR is 100
 *   (https://developers.facebook.com/documentation/ads-commerce/marketing-api/currencies). Insights `spend`, `cpm`,
 *   `cost_per_*` are in major units (rupees).
 * Leads: action types from https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/ :
 *   onsite_conversion.lead_grouped = "All On-Facebook Leads", leadgen_grouped = "On-Facebook leads coming from Messenger
 *   and Instant Forms", lead = "All offsite leads plus all On-Facebook leads". The first one present is used.
 * ThruPlays: video_thruplay_watched_actions (action list, action_type video_view) and cost_per_thruplay.
 * Instagram profile visits: instagram_profile_visits (accepted by the API; not on the reference page we could read).
 * Instagram follows from ads: no insights field or documented action type exists (`instagram_follows` is rejected
 *   with #100), so it is reported as not available.
 */
import type { AdAccount, AdIssue, AdLevel, AdObject, InsightMetrics, InsightRow } from './types';

type Raw = Record<string, unknown>;

/** Minor-unit offsets for currencies this dashboard handles. Another currency = budgets not converted (null). */
export const CURRENCY_OFFSET: Readonly<Record<string, number>> = { INR: 100 };

export const LEAD_ACTION_TYPES = ['onsite_conversion.lead_grouped', 'leadgen_grouped', 'lead'] as const;

export const INSIGHT_FIELDS = [
  'spend',
  'impressions',
  'reach',
  'frequency',
  'cpm',
  'inline_link_clicks',
  'inline_link_click_ctr',
  'actions',
  'cost_per_action_type',
  'video_thruplay_watched_actions',
  'cost_per_thruplay',
  'instagram_profile_visits',
  'date_start',
  'date_stop',
] as const;

export const LEVEL_ID_FIELDS: Record<AdLevel | 'account', string[]> = {
  account: ['account_id', 'account_name'],
  campaign: ['campaign_id', 'campaign_name'],
  adset: ['adset_id', 'adset_name', 'campaign_id'],
  ad: ['ad_id', 'ad_name', 'adset_id', 'campaign_id'],
};

export const OBJECT_FIELDS: Record<AdLevel, string> = {
  campaign: 'id,name,objective,effective_status,configured_status,daily_budget,lifetime_budget,issues_info,start_time,stop_time',
  adset: 'id,name,campaign_id,effective_status,configured_status,daily_budget,lifetime_budget,issues_info,optimization_goal,start_time,end_time',
  ad: 'id,name,campaign_id,adset_id,effective_status,configured_status,issues_info',
};

/** A finite number from a Graph value (Meta sends numbers as strings). */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Minor units -> major units for a known currency; null for unknown currency or a missing value. */
export function fromMinor(v: unknown, currency: string | null): number | null {
  const n = num(v);
  const offset = currency ? CURRENCY_OFFSET[currency] : undefined;
  if (n === null || offset === undefined) return null;
  return Math.round((n / offset) * 100) / 100;
}

/** A budget field: Meta returns "0" when the budget lives at the other level, so 0 is "no budget here". */
export function budget(v: unknown, currency: string | null): number | null {
  const n = fromMinor(v, currency);
  return n === null || n === 0 ? null : n;
}

export function parseIssues(v: unknown): AdIssue[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((i) => {
    if (!i || typeof i !== 'object') return [];
    const r = i as Raw;
    const summary = str(r.error_summary) ?? str(r.error_type) ?? (r.error_code !== undefined ? `Error ${String(r.error_code)}` : null);
    return summary ? [{ summary, message: str(r.error_message), level: str(r.level) }] : [];
  });
}

export function parseAdObject(level: AdLevel, raw: unknown, currency: string | null): AdObject | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const id = str(r.id);
  if (!id) return null;
  return {
    level,
    id,
    name: str(r.name) ?? '(no name)',
    campaignId: level === 'campaign' ? null : str(r.campaign_id),
    adsetId: level === 'ad' ? str(r.adset_id) : null,
    effectiveStatus: str(r.effective_status),
    configuredStatus: str(r.configured_status),
    dailyBudgetInr: budget(r.daily_budget, currency),
    lifetimeBudgetInr: budget(r.lifetime_budget, currency),
    issues: parseIssues(r.issues_info),
    objective: str(r.objective),
    optimizationGoal: str(r.optimization_goal),
    startTime: str(r.start_time),
    endTime: str(r.end_time) ?? str(r.stop_time),
  };
}

export function parseAccount(raw: unknown): AdAccount | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const id = str(r.id);
  if (!id) return null;
  const currency = str(r.currency);
  const cap = fromMinor(r.spend_cap, currency);
  return {
    id,
    name: str(r.name),
    currency,
    timezone: str(r.timezone_name),
    accountStatus: num(r.account_status),
    spendCapInr: cap === 0 ? null : cap,
    amountSpentInr: fromMinor(r.amount_spent, currency),
  };
}

/** Value of one action_type in an actions-style list ([{action_type, value}]). undefined = not in the list. */
export function actionValue(list: unknown, type: string): number | undefined {
  if (!Array.isArray(list)) return undefined;
  for (const a of list) {
    if (a && typeof a === 'object' && (a as Raw).action_type === type) {
      const n = num((a as Raw).value);
      if (n !== null) return n;
    }
  }
  return undefined;
}

/** Sum of every entry's value in an actions-style list (video_thruplay_watched_actions has one entry, video_view). */
function actionTotal(list: unknown): number | null {
  if (!Array.isArray(list)) return null;
  let total = 0;
  let any = false;
  for (const a of list) {
    const n = a && typeof a === 'object' ? num((a as Raw).value) : null;
    if (n !== null) {
      total += n;
      any = true;
    }
  }
  return any ? total : null;
}

/** The first numeric value in an actions-style list (cost_per_thruplay: one entry, action_type video_view). */
function firstValue(list: unknown[]): number | null {
  for (const a of list) {
    const n = a && typeof a === 'object' ? num((a as Raw).value) : null;
    if (n !== null) return n;
  }
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Metrics of one insights row. Meta leaves out zero-valued actions, so on a row that exists (it has `spend`), a lead
 * or ThruPlay count missing from the lists means 0. Costs are Meta's own (cost_per_action_type / cost_per_thruplay);
 * when Meta omits cost per lead but leads > 0, it is spend / leads.
 */
export function parseMetrics(r: Raw): InsightMetrics {
  const spend = num(r.spend);
  const rowExists = spend !== null;
  let leads: number | null = null;
  let leadsActionType: string | null = null;
  for (const t of LEAD_ACTION_TYPES) {
    const v = actionValue(r.actions, t);
    if (v !== undefined) {
      leads = v;
      leadsActionType = t;
      break;
    }
  }
  if (leads === null && rowExists) leads = 0;
  let costPerLead = leadsActionType ? (actionValue(r.cost_per_action_type, leadsActionType) ?? null) : null;
  if (costPerLead === null && leads && spend !== null) costPerLead = round2(spend / leads);
  const thruplays = actionTotal(r.video_thruplay_watched_actions) ?? (rowExists ? 0 : null);
  let cpt = Array.isArray(r.cost_per_thruplay) ? firstValue(r.cost_per_thruplay) : num(r.cost_per_thruplay);
  if (cpt === null && thruplays && spend !== null) cpt = round2(spend / thruplays);
  return {
    spendInr: spend,
    impressions: num(r.impressions),
    reach: num(r.reach),
    frequency: num(r.frequency),
    cpmInr: num(r.cpm),
    linkClicks: num(r.inline_link_clicks) ?? (rowExists ? 0 : null),
    ctrPct: num(r.inline_link_click_ctr),
    leads,
    leadsActionType,
    costPerLeadInr: costPerLead,
    thruplays,
    costPerThruplayInr: cpt,
    igProfileVisits: num(r.instagram_profile_visits),
  };
}

export function parseInsightRow(level: AdLevel | 'account', raw: unknown): InsightRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const [idField, nameField] = LEVEL_ID_FIELDS[level];
  const id = str(r[idField!]);
  if (!id) return null;
  return { level, id, name: str(r[nameField!]), dateStart: str(r.date_start), dateStop: str(r.date_stop), ...parseMetrics(r) };
}

/** Graph list response ({ data: [...] }) -> parsed items (malformed entries dropped). */
export function parseList<T>(body: unknown, parse: (raw: unknown) => T | null): T[] {
  const data = body && typeof body === 'object' ? (body as Raw).data : null;
  return Array.isArray(data) ? data.flatMap((d) => {
    const p = parse(d);
    return p === null ? [] : [p];
  }) : [];
}

/** YYYY-MM-DD of `d` in an IANA time zone. */
export function dateInZone(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The last `days` calendar days ending today, in the time zone (inclusive). */
export function lastDays(now: Date, timeZone: string, days: number): { since: string; until: string } {
  const until = dateInZone(now, timeZone);
  const [y, m, d] = until.split('-').map(Number) as [number, number, number];
  const since = new Date(Date.UTC(y, m - 1, d - (days - 1))).toISOString().slice(0, 10);
  return { since, until };
}
