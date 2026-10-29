/**
 * /admin/ads and /api/cron/ads-guard data layer (SERVER ONLY). Reads the Meta Marketing API with the system-user Page
 * token (FB_PAGE_TOKEN: ads_read, leads_retrieval, ...), the Instagram follower count with the publisher's Instagram
 * token, Vercel Web Analytics (optional, VERCEL_ANALYTICS_*), and Supabase with the secret key.
 *
 * Safety:
 * - The only Meta write anywhere here is setAdsetStatus (POST /{ad-set-id} status=PAUSED|ACTIVE). PAUSED runs when the
 *   owner presses "Pause" on /admin/ads, from the hourly guard only when ads_settings.auto_pause is true (false by
 *   default), or from the hour schedule. ACTIVE runs only from the hour schedule, for the one ad set named in
 *   ads_schedule while it is enabled, inside its windows and under the daily cap. Nothing here creates, edits,
 *   publishes or re-budgets an ad object.
 * - Tokens go in the Authorization header only and are scrubbed from every error text; nothing Meta-related reaches
 *   the browser except the rendered numbers. Lead PII is never logged.
 * - Every outgoing request carries the User-Agent "RayValueBot/1.0 (+https://rayvalue.com)".
 * - Thresholds, the ad account id and the INR->USD rate come from the database (ads_settings, fx_rates).
 */
import { breakdown, mapMetaLead, parseForm, WEBSITE_LEAD_SELECT, type WebsiteLead } from '../meta-ads/leads';
import { evaluateGuardrails, guardInput, newlyTripped, type GuardOutcome, type GuardThresholds } from '../meta-ads/guardrails';
import { eventsFilter, parseEventsByCampaign, parseVisitsByCampaign, VERCEL_API, vercelError } from '../meta-ads/funnel';
import type { FxRate } from '../meta-ads/fx';
import { inWindow, parseWindows, scheduleAction, type ScheduleAction } from '../meta-ads/schedule';
import { buildDigest, type DigestDay, type DigestHour } from '../meta-ads/digest';
import { INSIGHT_FIELDS, LEVEL_ID_FIELDS, OBJECT_FIELDS, lastDays, parseAccount, parseAdObject, parseInsightRow, parseList, parseMetrics } from '../meta-ads/parse';
import type { AdLevel, AdsInsights, AdsSnapshot, InsightRow, LeadForm, MetaLead, Section, SiteFunnel } from '../meta-ads/types';
import { scrub } from '../social/instagram';
import { adminDelete, adminInsert, adminSelect, adminSelectAll, adminUpdate, adminUpsert, type AdminEnv } from './admin-db';
import { sendEmail, type EmailEnv } from './email';
import { currentToken } from './social-publisher';
import { supabaseStore } from './social-publisher-store';

export const BOT_USER_AGENT = 'RayValueBot/1.0 (+https://rayvalue.com)';
export const GRAPH = 'https://graph.facebook.com/v26.0';
export const IG_GRAPH = 'https://graph.instagram.com/v26.0';
/** How long a dashboard snapshot is reused before Meta is asked again. */
export const CACHE_SECONDS = 300;
export const DAILY_DAYS = 7;
export const FUNNEL_DAYS = 30;
export const DASHBOARD_CACHE_KEY = 'dashboard';
const TIMEOUT_MS = 15_000;

export interface AdsEnv extends AdminEnv, EmailEnv {
  FB_PAGE_ID?: string;
  FB_PAGE_TOKEN?: string;
  IG_ACCESS_TOKEN?: string;
  OWNER_EMAIL?: string;
  SITE_URL?: string;
  /** Optional: a Vercel access token that can read the project's Web Analytics, and the project / team ids. */
  VERCEL_ANALYTICS_TOKEN?: string;
  VERCEL_ANALYTICS_PROJECT_ID?: string;
  VERCEL_ANALYTICS_TEAM_ID?: string;
}

/** Read at request time from process.env (never import.meta.env, which would inline secrets). */
export const adsEnv = (): AdsEnv => ({
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  OWNER_EMAIL: process.env.OWNER_EMAIL,
  SITE_URL: process.env.SITE_URL,
  FB_PAGE_ID: process.env.FB_PAGE_ID,
  FB_PAGE_TOKEN: process.env.FB_PAGE_TOKEN,
  IG_ACCESS_TOKEN: process.env.IG_ACCESS_TOKEN,
  VERCEL_ANALYTICS_TOKEN: process.env.VERCEL_ANALYTICS_TOKEN,
  VERCEL_ANALYTICS_PROJECT_ID: process.env.VERCEL_ANALYTICS_PROJECT_ID,
  VERCEL_ANALYTICS_TEAM_ID: process.env.VERCEL_ANALYTICS_TEAM_ID,
});

/** fetch that always sends our bot User-Agent (Meta, Vercel, Supabase and Resend calls made from this module). */
export function withUserAgent(f: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('User-Agent', BOT_USER_AGENT);
    return f(input, { ...init, headers });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------------------------------- settings

export interface AdsSettings {
  ad_account_id: string;
  leads_spend_no_lead_inr: number | string;
  max_cost_per_thruplay_inr: number | string;
  max_daily_budget_inr: number | string;
  auto_pause: boolean;
  rationale: string;
  updated_at: string;
}

export const loadSettings = async (env: AdsEnv, f: typeof fetch): Promise<AdsSettings | null> =>
  (await adminSelect<AdsSettings>(env, 'ads_settings', { select: '*', limit: '1' }, f))?.[0] ?? null;

/** numeric columns arrive as strings from PostgREST. */
export function thresholdsOf(s: AdsSettings): GuardThresholds | null {
  const t = { leadsSpendNoLeadInr: Number(s.leads_spend_no_lead_inr), maxCostPerThruplayInr: Number(s.max_cost_per_thruplay_inr), maxDailyBudgetInr: Number(s.max_daily_budget_inr) };
  return Object.values(t).every((v) => Number.isFinite(v) && v > 0) ? t : null;
}

export const loadFxRate = async (env: AdsEnv, f: typeof fetch): Promise<FxRate | null> => {
  const row = (await adminSelect<FxRate>(env, 'fx_rates', { id: 'eq.inr_per_usd', select: '*', limit: '1' }, f))?.[0];
  if (!row) return null;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { ...row, low: n(row.low), likely: n(row.likely), high: n(row.high) };
};

// ---------------------------------------------------------------------------------------------------- Graph API

type GraphResult = { ok: true; body: Record<string, unknown> } | { ok: false; error: string };

async function graphGet(f: typeof fetch, host: string, token: string, path: string, params: Record<string, string>): Promise<GraphResult> {
  const url = new URL(`${host}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await f(url.toString(), { headers: { Accept: 'application/json', Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    return { ok: false, error: `request failed (${e instanceof Error ? e.name : 'network error'})` };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const err = body?.error as { message?: unknown; code?: unknown; error_subcode?: unknown } | undefined;
  if (!res.ok || err) {
    const code = typeof err?.code === 'number' ? ` (code ${err.code}${typeof err.error_subcode === 'number' ? `/${err.error_subcode}` : ''})` : '';
    const msg = typeof err?.message === 'string' ? err.message : 'no error message';
    return { ok: false, error: scrub(`HTTP ${res.status}${code}: ${msg}`, token).slice(0, 300) };
  }
  return { ok: true, body: body ?? {} };
}

const sec = <T>(source: string, at: string, r: { ok: true; data: T } | { ok: false; error: string }): Section<T> => (r.ok ? { ok: true, data: r.data, at, source } : { ok: false, error: r.error, at, source });
const fail = <T>(source: string, at: string, error: string): Section<T> => ({ ok: false, error, at, source });

export interface SnapshotOptions {
  leads: boolean;
  instagram: boolean;
  funnel: boolean;
}

/** Read everything from Meta (and optionally Instagram / Vercel) once. Never throws; each section says what failed. */
export async function fetchSnapshot(env: AdsEnv, settings: AdsSettings, fetchImpl: typeof fetch, now: Date, opts: SnapshotOptions): Promise<AdsSnapshot> {
  const f = withUserAgent(fetchImpl);
  const at = now.toISOString();
  const act = settings.ad_account_id;
  const token = env.FB_PAGE_TOKEN;
  const src = (p: string) => `Meta Marketing API ${p}`;

  const empty: AdsSnapshot = {
    version: 1,
    fetchedAt: at,
    account: fail(src(`GET /${act}`), at, 'FB_PAGE_TOKEN is not set'),
    campaigns: fail(src(`GET /${act}/campaigns`), at, 'FB_PAGE_TOKEN is not set'),
    adsets: fail(src(`GET /${act}/adsets`), at, 'FB_PAGE_TOKEN is not set'),
    ads: fail(src(`GET /${act}/ads`), at, 'FB_PAGE_TOKEN is not set'),
    insights: fail(src(`GET /${act}/insights`), at, 'FB_PAGE_TOKEN is not set'),
    forms: fail(src('GET /{page}/leadgen_forms'), at, 'FB_PAGE_TOKEN is not set'),
    metaLeads: fail(src('GET /{form}/leads'), at, 'FB_PAGE_TOKEN is not set'),
    instagram: fail('Instagram API GET /me', at, 'not requested'),
    funnel: null,
  };
  const [instagram, funnel] = await Promise.all([
    opts.instagram ? fetchInstagram(env, f, at) : Promise.resolve(empty.instagram),
    opts.funnel ? fetchFunnel(env, f, now) : Promise.resolve(null),
  ]);
  if (!token) return { ...empty, instagram, funnel };

  const g = (path: string, params: Record<string, string>) => graphGet(f, GRAPH, token, path, params);
  const accountRes = await g(act, { fields: 'name,currency,timezone_name,account_status,spend_cap,amount_spent' });
  const account = accountRes.ok ? parseAccount(accountRes.body) : null;
  const accountSec: Section<NonNullable<typeof account>> = account
    ? { ok: true, data: account, at, source: src(`GET /${act}`) }
    : fail(src(`GET /${act}`), at, accountRes.ok ? 'unreadable response' : accountRes.error);
  const currency = account?.currency ?? null;

  const list = async (level: AdLevel, edge: string) => {
    const r = await g(`${act}/${edge}`, { fields: OBJECT_FIELDS[level], limit: '200' });
    return sec(src(`GET /${act}/${edge}`), at, r.ok ? { ok: true, data: parseList(r.body, (x) => parseAdObject(level, x, currency)) } : r);
  };
  const [campaigns, adsets, ads, insights, formsAndLeads] = await Promise.all([
    list('campaign', 'campaigns'),
    list('adset', 'adsets'),
    list('ad', 'ads'),
    fetchInsights(g, act, account?.timezone ?? null, now, at),
    fetchFormsAndLeads(env, g, at, opts.leads),
  ]);
  return { ...empty, account: accountSec, campaigns, adsets, ads, insights, forms: formsAndLeads.forms, metaLeads: formsAndLeads.leads, instagram, funnel };
}

type Get = (path: string, params: Record<string, string>) => Promise<GraphResult>;

async function fetchInsights(g: Get, act: string, timezone: string | null, now: Date, at: string): Promise<Section<AdsInsights>> {
  const source = `Meta Marketing API GET /${act}/insights (lifetime: date_preset=maximum; daily: time_increment=1, ad account time zone)`;
  if (!timezone) return fail(source, at, 'ad account time zone not available (account read failed)');
  const range = lastDays(now, timezone, DAILY_DAYS);
  const levels = ['account', 'campaign', 'adset', 'ad'] as const;
  const call = async (level: (typeof levels)[number], daily: boolean) => {
    const fields = [...LEVEL_ID_FIELDS[level], ...INSIGHT_FIELDS].join(',');
    const params: Record<string, string> = { level, fields, limit: '500' };
    if (daily) Object.assign(params, { time_range: JSON.stringify({ since: range.since, until: range.until }), time_increment: '1' });
    else params.date_preset = 'maximum';
    const r = await g(`${act}/insights`, params);
    return r.ok ? { ok: true as const, rows: parseList<InsightRow>(r.body, (x) => parseInsightRow(level, x)) } : { ok: false as const, error: `${level} ${daily ? 'daily' : 'lifetime'}: ${r.error}` };
  };
  const results = await Promise.all(levels.flatMap((l) => [call(l, false), call(l, true)]));
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) return fail(source, at, failed.error);
  const rowsAt = (i: number) => (results[i]!.ok ? (results[i] as { rows: InsightRow[] }).rows : []);
  const pick = (daily: boolean) => Object.fromEntries(levels.map((l, i) => [l, rowsAt(i * 2 + (daily ? 1 : 0))])) as AdsInsights['lifetime'];
  return { ok: true, at, source, data: { since: range.since, until: range.until, timezone, lifetime: pick(false), daily: pick(true) } };
}

async function fetchFormsAndLeads(env: AdsEnv, g: Get, at: string, withLeads: boolean): Promise<{ forms: Section<LeadForm[]>; leads: Section<MetaLead[]> }> {
  const formsSrc = 'Meta Graph API GET /{page}/leadgen_forms';
  const leadsSrc = 'Meta Graph API GET /{form}/leads';
  if (!env.FB_PAGE_ID) return { forms: fail(formsSrc, at, 'FB_PAGE_ID is not set'), leads: fail(leadsSrc, at, 'FB_PAGE_ID is not set') };
  const r = await g(`${env.FB_PAGE_ID}/leadgen_forms`, { fields: 'id,name,status,leads_count,questions{key,type,label,options}', limit: '50' });
  if (!r.ok) return { forms: fail(formsSrc, at, r.error), leads: fail(leadsSrc, at, `forms could not be read: ${r.error}`) };
  const forms = parseList(r.body, parseForm);
  const formsSec: Section<LeadForm[]> = { ok: true, data: forms, at, source: formsSrc };
  if (!withLeads) return { forms: formsSec, leads: fail(leadsSrc, at, 'not requested') };
  const leads: MetaLead[] = [];
  for (const form of forms) {
    const lr = await g(`${form.id}/leads`, { fields: 'created_time,field_data,ad_id,adset_id,campaign_id,form_id,is_organic,platform,custom_disclaimer_responses', limit: '100' });
    if (!lr.ok) return { forms: formsSec, leads: fail(leadsSrc, at, `form ${form.id}: ${lr.error}`) };
    leads.push(...parseList(lr.body, (x) => mapMetaLead(x, form)));
  }
  return { forms: formsSec, leads: { ok: true, data: leads, at, source: leadsSrc } };
}

async function fetchInstagram(env: AdsEnv, f: typeof fetch, at: string): Promise<AdsSnapshot['instagram']> {
  const source = 'Instagram API GET graph.instagram.com/me?fields=username,followers_count';
  const tok = await currentToken(env, supabaseStore(env, f));
  if (!tok) return fail(source, at, 'no Instagram token (social_auth row or IG_ACCESS_TOKEN)');
  const r = await graphGet(f, IG_GRAPH, tok.token, 'me', { fields: 'username,followers_count' });
  if (!r.ok) return fail(source, at, r.error);
  const followers = typeof r.body.followers_count === 'number' ? r.body.followers_count : null;
  return { ok: true, at, source, data: { username: typeof r.body.username === 'string' ? r.body.username : null, followers } };
}

/** Vercel Web Analytics: page views and funnel events by utm_campaign, last FUNNEL_DAYS days (UTC dates). */
async function fetchFunnel(env: AdsEnv, f: typeof fetch, now: Date): Promise<SiteFunnel> {
  const at = now.toISOString();
  const range = lastDays(now, 'UTC', FUNNEL_DAYS);
  const visitsSrc = 'Vercel Web Analytics API GET /v1/query/web-analytics/visits/aggregate?by=utmCampaign';
  const eventsSrc = 'Vercel Web Analytics API GET /v1/query/web-analytics/events/aggregate?by=eventName&by=utmCampaign';
  const token = env.VERCEL_ANALYTICS_TOKEN;
  const project = env.VERCEL_ANALYTICS_PROJECT_ID;
  if (!token || !project) {
    const why = 'VERCEL_ANALYTICS_TOKEN and VERCEL_ANALYTICS_PROJECT_ID are not set';
    return { ...range, pageviews: fail(visitsSrc, at, why), events: fail(eventsSrc, at, why) };
  }
  const q = async (path: string, by: string[], filter?: string) => {
    const u = new URL(`${VERCEL_API}/v1/query/web-analytics/${path}`);
    u.searchParams.set('projectId', project);
    if (env.VERCEL_ANALYTICS_TEAM_ID) u.searchParams.set('teamId', env.VERCEL_ANALYTICS_TEAM_ID);
    u.searchParams.set('since', range.since);
    u.searchParams.set('until', range.until);
    u.searchParams.set('limit', '100');
    for (const b of by) u.searchParams.append('by', b);
    if (filter) u.searchParams.set('filter', filter);
    try {
      const res = await f(u.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = await res.json().catch(() => null);
      return res.ok ? { ok: true as const, body } : { ok: false as const, error: scrub(vercelError(res.status, body), token) };
    } catch (e) {
      return { ok: false as const, error: `request failed (${e instanceof Error ? e.name : 'network error'})` };
    }
  };
  const [v, e] = await Promise.all([q('visits/aggregate', ['utmCampaign']), q('events/aggregate', ['eventName', 'utmCampaign'], eventsFilter())]);
  return {
    ...range,
    pageviews: sec(visitsSrc, at, v.ok ? { ok: true, data: parseVisitsByCampaign(v.body) } : v),
    events: sec(eventsSrc, at, e.ok ? { ok: true, data: parseEventsByCampaign(e.body) } : e),
  };
}

// ---------------------------------------------------------------------------------------------------- cache

export interface CachedSnapshot {
  snapshot: AdsSnapshot;
  fetchedAt: string;
  fromCache: boolean;
}

export async function readCache(env: AdsEnv, key: string, f: typeof fetch): Promise<{ snapshot: AdsSnapshot; fetchedAt: string } | null> {
  const row = (await adminSelect<{ fetched_at: string; snapshot: AdsSnapshot }>(env, 'ads_cache', { key: `eq.${key}`, select: 'fetched_at,snapshot', limit: '1' }, f))?.[0];
  return row && row.snapshot?.version === 1 ? { snapshot: row.snapshot, fetchedAt: row.fetched_at } : null;
}

export const writeCache = (env: AdsEnv, key: string, snapshot: AdsSnapshot, f: typeof fetch) => adminUpsert(env, 'ads_cache', { key, fetched_at: snapshot.fetchedAt, snapshot }, 'key', f);

/** Drop the cached snapshot so the next page view reads Meta again ("Refresh now", after a pause). */
export const invalidateCache = (env: AdsEnv, fetchImpl: typeof fetch = fetch) => adminDelete(env, 'ads_cache', { key: `eq.${DASHBOARD_CACHE_KEY}` }, withUserAgent(fetchImpl));

/** The dashboard snapshot: the cached one when younger than CACHE_SECONDS, else a fresh read (then cached). */
export async function dashboardSnapshot(env: AdsEnv, settings: AdsSettings, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<CachedSnapshot> {
  const f = withUserAgent(fetchImpl);
  const cached = await readCache(env, DASHBOARD_CACHE_KEY, f);
  if (cached && now.getTime() - new Date(cached.fetchedAt).getTime() < CACHE_SECONDS * 1000) return { ...cached, fromCache: true };
  const snapshot = await fetchSnapshot(env, settings, f, now, { leads: true, instagram: true, funnel: true });
  await writeCache(env, DASHBOARD_CACHE_KEY, snapshot, f);
  return { snapshot, fetchedAt: snapshot.fetchedAt, fromCache: false };
}

// ---------------------------------------------------------------------------------------------------- Supabase reads

export const websiteLeads = (env: AdsEnv, fetchImpl: typeof fetch = fetch, limit = 200) =>
  adminSelect<WebsiteLead>(env, 'leads', { select: WEBSITE_LEAD_SELECT, order: 'created_at.desc', limit: String(limit) }, withUserAgent(fetchImpl));

/** Website leads per utm_campaign since a date (UTC), for the funnel panel. */
export async function websiteLeadsByCampaign(env: AdsEnv, since: string, fetchImpl: typeof fetch = fetch) {
  const rows = await adminSelectAll<{ utm_campaign: string | null; created_at: string }>(env, 'leads', { select: 'utm_campaign,created_at', created_at: `gte.${since}T00:00:00Z`, order: 'created_at.desc' }, withUserAgent(fetchImpl));
  if (!rows) return null;
  return breakdown(
    rows.map((r) => ({ origin: 'website', id: '', createdAt: r.created_at, name: '', email: null, phone: null, zip: null, state: null, homeowner: null, billBucket: null, timeline: null, source: '', utmSource: null, utmCampaign: r.utm_campaign, status: '', detail: '', consent: null })),
    'utmCampaign',
  );
}

export interface AdsEvent {
  id: number;
  at: string;
  event: string;
  detail: Record<string, unknown> | null;
}
export const recentEvents = (env: AdsEnv, fetchImpl: typeof fetch = fetch) => adminSelect<AdsEvent>(env, 'ads_events', { select: '*', order: 'at.desc,id.desc', limit: '15' }, withUserAgent(fetchImpl));

const logEvent = async (env: AdsEnv, event: string, detail: Record<string, unknown>, f: typeof fetch) => {
  const r = await adminInsert(env, 'ads_events', { event, detail }, f, 'id');
  if (!r || 'conflict' in r) console.error(`ads_events: could not log ${event}`);
};

// ---------------------------------------------------------------------------------------------------- pause

const AD_SET_ID_RE = /^\d{5,25}$/;
export const isAdSetId = (v: unknown): v is string => typeof v === 'string' && AD_SET_ID_RE.test(v);

/**
 * POST /{ad-set-id} status=PAUSED|ACTIVE (https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/#Updating).
 * `by` = who asked (manual button, auto guard or the hour schedule), recorded in ads_events.
 */
async function setAdsetStatus(env: AdsEnv, adsetId: string, status: 'PAUSED' | 'ACTIVE', by: 'manual' | 'auto_guard' | 'schedule', f: typeof fetch, reason: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = env.FB_PAGE_TOKEN;
  if (!token) return { ok: false, error: 'FB_PAGE_TOKEN is not set' };
  if (!isAdSetId(adsetId)) return { ok: false, error: 'not an ad set id' };
  let out: { ok: true } | { ok: false; error: string };
  try {
    const res = await f(`${GRAPH}/${adsetId}`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `OAuth ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { success?: unknown; error?: { message?: unknown; code?: unknown } } | null;
    if (res.ok && body?.success === true) out = { ok: true };
    else {
      const msg = typeof body?.error?.message === 'string' ? body.error.message : 'no error message';
      out = { ok: false, error: scrub(`HTTP ${res.status}${typeof body?.error?.code === 'number' ? ` (code ${body.error.code})` : ''}: ${msg}`, token).slice(0, 300) };
    }
  } catch (e) {
    out = { ok: false, error: `request failed (${e instanceof Error ? e.name : 'network error'}); check Ads Manager before retrying` };
  }
  const verb = status === 'PAUSED' ? 'paused' : 'activated';
  await logEvent(env, out.ok ? `adset_${verb}` : `adset_${verb === 'paused' ? 'pause' : 'activate'}_failed`, { adset_id: adsetId, by, ...(reason ? { reason } : {}), ...(out.ok ? {} : { error: out.error }) }, f);
  return out;
}

/** Pause one ad set. A manual pause also turns the hour schedule off, so the schedule does not switch it back on. */
export async function pauseAdset(env: AdsEnv, adsetId: string, by: 'manual' | 'auto_guard', fetchImpl: typeof fetch = fetch, reason: string | null = null): Promise<{ ok: true } | { ok: false; error: string }> {
  const f = withUserAgent(fetchImpl);
  const out = await setAdsetStatus(env, adsetId, 'PAUSED', by, f, reason);
  if (out.ok && by === 'manual') {
    const n = await adminUpdate(env, 'ads_schedule', { adset_id: `eq.${adsetId}`, enabled: 'eq.true' }, { enabled: false, updated_at: new Date().toISOString() }, f);
    if (n) await logEvent(env, 'schedule_disabled', { adset_id: adsetId, by }, f);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- hour schedule

export interface AdsScheduleRow {
  adset_id: string;
  enabled: boolean;
  timezone: string;
  windows: unknown;
  rationale: string;
  updated_at: string;
}

/** The ad set the enabled schedule controls, as a list for guardInput. */
export const scheduledIds = (row: AdsScheduleRow | null) => (row?.enabled ? [row.adset_id] : []);

export const loadSchedule = async (env: AdsEnv, f: typeof fetch): Promise<AdsScheduleRow | null> =>
  (await adminSelect<AdsScheduleRow>(env, 'ads_schedule', { select: '*', limit: '1' }, f))?.[0] ?? null;

export interface ScheduleRunOutcome {
  ok: boolean;
  error?: string;
  action?: ScheduleAction['action'];
  reason?: string;
  todaySpendInr?: number | null;
}

/** Switch the scheduled ad set on inside its windows and off outside them or at the daily cap (see meta-ads/schedule). */
export async function runAdsSchedule(env: AdsEnv, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<ScheduleRunOutcome> {
  const f = withUserAgent(fetchImpl);
  const token = env.FB_PAGE_TOKEN;
  if (!token) return { ok: false, error: 'FB_PAGE_TOKEN is not set' };
  const [settings, row] = await Promise.all([loadSettings(env, f), loadSchedule(env, f)]);
  if (!settings) return { ok: false, error: 'ads_settings row not readable (apply migration 0018)' };
  if (!row) return { ok: false, error: 'ads_schedule row not readable (apply migration 0020)' };
  if (!row.enabled) return { ok: true, action: 'none', reason: 'schedule disabled' };
  const windows = parseWindows(row.windows);
  const cap = thresholdsOf(settings)?.maxDailyBudgetInr;
  if (!windows || !cap || !isAdSetId(row.adset_id)) return { ok: false, error: 'ads_schedule windows, ad set id or the daily cap are not valid' };

  const g = (path: string, params: Record<string, string>) => graphGet(f, GRAPH, token, path, params);
  const [acct, adset, spend] = await Promise.all([
    g(settings.ad_account_id, { fields: 'currency' }),
    g(row.adset_id, { fields: 'status,end_time' }),
    g(`${settings.ad_account_id}/insights`, { date_preset: 'today', fields: 'spend', level: 'account' }),
  ]);
  if (!adset.ok) return { ok: false, error: `ad set read failed: ${adset.error}` };
  // The cap is in INR; any other currency (or a failed read) counts as spend unknown.
  let todaySpendInr: number | null = null;
  if (acct.ok && acct.body.currency === 'INR' && spend.ok) {
    const data = Array.isArray(spend.body.data) ? (spend.body.data as { spend?: unknown }[]) : [];
    const v = data.length ? Number(data[0]?.spend) : 0;
    todaySpendInr = Number.isFinite(v) ? v : null;
  }
  const decision = scheduleAction({
    enabled: true,
    inWindow: inWindow(now, row.timezone, windows),
    status: typeof adset.body.status === 'string' ? adset.body.status : null,
    endTime: typeof adset.body.end_time === 'string' ? adset.body.end_time : null,
    todaySpendInr,
    capInr: cap,
    now,
  });
  if (decision.action === 'none') return { ok: true, ...decision, todaySpendInr };
  const r = await setAdsetStatus(env, row.adset_id, decision.action === 'activate' ? 'ACTIVE' : 'PAUSED', 'schedule', f, decision.reason);
  return { ok: r.ok, ...(r.ok ? {} : { error: r.error }), ...decision, todaySpendInr };
}

// ---------------------------------------------------------------------------------------------------- daily email

const adminLink = (env: AdsEnv) => `${(env.SITE_URL || 'https://rayvalue.com').replace(/\/+$/, '')}/admin/ads`;

export interface DigestRunOutcome {
  ok: boolean;
  error?: string;
  emailed?: 'sent' | 'disabled' | 'failed' | 'no_owner_email';
}

/** Email OWNER_EMAIL today-so-far, the last 7 days by day and by viewer hour, money left and the schedule. */
export async function runAdsDigest(env: AdsEnv, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<DigestRunOutcome> {
  const f = withUserAgent(fetchImpl);
  const token = env.FB_PAGE_TOKEN;
  if (!token) return { ok: false, error: 'FB_PAGE_TOKEN is not set' };
  if (!env.OWNER_EMAIL) return { ok: true, emailed: 'no_owner_email' };
  const [settings, schedule] = await Promise.all([loadSettings(env, f), loadSchedule(env, f)]);
  if (!settings) return { ok: false, error: 'ads_settings row not readable (apply migration 0018)' };
  const cap = thresholdsOf(settings)?.maxDailyBudgetInr;
  if (!cap) return { ok: false, error: 'ads_settings thresholds are not valid numbers' };

  const g = (path: string, params: Record<string, string>) => graphGet(f, GRAPH, token, path, params);
  const act = settings.ad_account_id;
  const accRes = await g(act, { fields: 'name,currency,timezone_name,account_status,spend_cap,amount_spent' });
  const account = accRes.ok ? parseAccount(accRes.body) : null;
  if (!account?.timezone) return { ok: false, error: `ad account read failed: ${accRes.ok ? 'no time zone' : accRes.error}` };
  if (account.currency !== 'INR') return { ok: false, error: `ad account currency is ${account.currency}, the digest is in INR` };
  const range = lastDays(now, account.timezone, DAILY_DAYS);
  const timeRange = JSON.stringify({ since: range.since, until: range.until });
  const [daily, hourly, adset] = await Promise.all([
    g(`${act}/insights`, { level: 'account', fields: INSIGHT_FIELDS.join(','), time_range: timeRange, time_increment: '1' }),
    g(`${act}/insights`, { level: 'account', fields: 'spend,impressions,inline_link_clicks,actions,video_thruplay_watched_actions', time_range: timeRange, breakdowns: 'hourly_stats_aggregated_by_audience_time_zone', limit: '48' }),
    schedule ? g(schedule.adset_id, { fields: 'status,end_time' }) : Promise.resolve(null),
  ]);
  if (!daily.ok) return { ok: false, error: `daily insights: ${daily.error}` };
  if (!hourly.ok) return { ok: false, error: `hourly insights: ${hourly.error}` };
  const days = parseList<DigestDay>(daily.body, (x) => {
    const r = x as Record<string, unknown>;
    return typeof r?.date_start === 'string' ? { date: r.date_start, ...parseMetrics(r) } : null;
  });
  const hours = parseList<DigestHour>(hourly.body, (x) => {
    const r = x as Record<string, unknown>;
    const label = r?.hourly_stats_aggregated_by_audience_time_zone;
    return typeof label === 'string' ? { label, ...parseMetrics(r) } : null;
  });
  const { subject, text } = buildDigest({
    today: range.until,
    since: range.since,
    timezone: account.timezone,
    days,
    hours,
    spendCapInr: account.spendCapInr,
    amountSpentInr: account.amountSpentInr,
    capPerDayInr: cap,
    adset: schedule ? { id: schedule.adset_id, status: adset?.ok && typeof adset.body.status === 'string' ? adset.body.status : null, endTime: adset?.ok && typeof adset.body.end_time === 'string' ? adset.body.end_time : null } : null,
    schedule: schedule ? { enabled: schedule.enabled, timezone: schedule.timezone, windows: JSON.stringify(schedule.windows) } : null,
    dashboardUrl: adminLink(env),
  });
  const emailed = await sendEmail(env, { to: env.OWNER_EMAIL, subject, text }, f);
  await logEvent(env, 'digest_emailed', { emailed }, f);
  return { ok: emailed !== 'failed', emailed };
}

// ---------------------------------------------------------------------------------------------------- hourly guard

export interface GuardRunOutcome {
  ok: boolean;
  error?: string;
  tripped?: string[];
  newlyTripped?: string[];
  notEvaluated?: string[];
  emailed?: 'sent' | 'disabled' | 'failed' | 'no_owner_email' | 'nothing_new';
  paused?: string[];
}

/** Alert keys for an outcome, including "could not check" ones, so a broken token is reported once too. */
export const outcomeKeys = (o: GuardOutcome) => [...o.results.map((r) => r.key), ...o.notEvaluated.map((n) => `n:${n.rule}`)];

/** Evaluate the guardrails from a fresh Meta read; email OWNER_EMAIL only about keys that newly tripped. */
export async function runAdsGuard(env: AdsEnv, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<GuardRunOutcome> {
  const f = withUserAgent(fetchImpl);
  const settings = await loadSettings(env, f);
  if (!settings) return { ok: false, error: 'ads_settings row not readable (apply migration 0018)' };
  const thresholds = thresholdsOf(settings);
  if (!thresholds) return { ok: false, error: 'ads_settings thresholds are not valid numbers' };
  const state = (await adminSelect<{ active_keys: string[] }>(env, 'ads_guard_state', { select: 'active_keys', limit: '1' }, f))?.[0];
  if (!state) return { ok: false, error: 'ads_guard_state row not readable (apply migration 0018)' };

  const [snap, schedule] = await Promise.all([fetchSnapshot(env, settings, f, now, { leads: false, instagram: false, funnel: false }), loadSchedule(env, f)]);
  const outcome = evaluateGuardrails(guardInput(snap, scheduledIds(schedule)), thresholds);

  const paused: string[] = [];
  if (settings.auto_pause && snap.adsets.ok) {
    const adsets = snap.adsets.data;
    for (const r of outcome.results) {
      const a = r.pauseAdsetId ? adsets.find((x) => x.id === r.pauseAdsetId) : undefined;
      if (!a || a.configuredStatus === 'PAUSED' || paused.includes(a.id)) continue;
      const p = await pauseAdset(env, a.id, 'auto_guard', f, r.message);
      if (p.ok) paused.push(a.id);
    }
  }

  const keys = outcomeKeys(outcome);
  const fresh = newlyTripped(outcome.results, state.active_keys);
  const freshSkips = outcome.notEvaluated.filter((n) => !state.active_keys.includes(`n:${n.rule}`));
  let emailed: GuardRunOutcome['emailed'] = 'nothing_new';
  if (fresh.length || freshSkips.length || paused.length) {
    if (!env.OWNER_EMAIL) emailed = 'no_owner_email';
    else {
      const lines = [
        ...fresh.map((r) => `- [${r.severity === 'pause_recommended' ? 'PAUSE RECOMMENDED' : 'ALERT'}] rule (${r.rule})${r.objectName ? ` ${r.objectName}` : ''}${r.objectId ? ` (${r.objectId})` : ''}: ${r.message}`),
        ...freshSkips.map((n) => `- [NOT CHECKED] rule (${n.rule}): ${n.reason}`),
        ...paused.map((id) => `- Auto-paused ad set ${id} (ads_settings.auto_pause is on).`),
      ];
      emailed = await sendEmail(
        env,
        {
          to: env.OWNER_EMAIL,
          subject: `RayValue ads guard: ${fresh.length + freshSkips.length} new issue${fresh.length + freshSkips.length === 1 ? '' : 's'}`,
          text: ['The hourly ads guard found:', '', ...lines, '', `Thresholds (ads_settings): ₹${thresholds.leadsSpendNoLeadInr} lifetime with 0 leads, ₹${thresholds.maxCostPerThruplayInr} per ThruPlay, ₹${thresholds.maxDailyBudgetInr}/day.`, `Auto-pause: ${settings.auto_pause ? 'ON' : 'off'}.`, '', `Dashboard: ${adminLink(env)}`].join('\n'),
        },
        f,
      );
    }
  }
  // Keep the old keys when the email failed, so the next run tries again.
  const nextKeys = emailed === 'failed' ? state.active_keys : keys;
  const saved = await adminUpdate(
    env,
    'ads_guard_state',
    { id: 'eq.true' },
    {
      active_keys: nextKeys,
      checked_at: now.toISOString(),
      ...(emailed === 'sent' ? { last_email_at: now.toISOString() } : {}),
      last_outcome: { results: outcome.results.map((r) => ({ key: r.key, message: r.message })), not_evaluated: outcome.notEvaluated, paused },
    },
    f,
  );
  if (fresh.length) await logEvent(env, 'guard_tripped', { keys: fresh.map((r) => r.key), emailed }, f);
  return { ok: saved !== null, ...(saved === null ? { error: 'could not save ads_guard_state' } : {}), tripped: keys, newlyTripped: [...fresh.map((r) => r.key), ...freshSkips.map((n) => `n:${n.rule}`)], notEvaluated: outcome.notEvaluated.map((n) => `${n.rule}: ${n.reason}`), emailed, paused };
}
