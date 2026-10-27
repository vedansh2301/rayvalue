import { describe, expect, it } from 'vitest';
import type { Section } from '../meta-ads/types';
import { BOT_USER_AGENT, fetchSnapshot, pauseAdset, runAdsGuard, thresholdsOf, withUserAgent, type AdsEnv, type AdsSettings } from './meta-ads';

const TOKEN = 'EAAtesttoken1234567890abcdefghijklmnopqrstuvwxyz';
const settings: AdsSettings = {
  ad_account_id: 'act_1657520542672231',
  leads_spend_no_lead_inr: '400.00',
  max_cost_per_thruplay_inr: '9.50',
  max_daily_budget_inr: '100.00',
  auto_pause: false,
  rationale: "owner's cap 2026-10-27",
  updated_at: '2026-10-27T00:00:00Z',
};
const env: AdsEnv = {
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_SECRET_KEY: 'sb_secret',
  FB_PAGE_ID: '1307379799134896',
  FB_PAGE_TOKEN: TOKEN,
  IG_ACCESS_TOKEN: 'IGtesttoken1234567890abcdefghijklmnopqrstuvwxyz',
  RESEND_API_KEY: 're_x',
  EMAIL_FROM: 'RayValue <a@rayvalue.com>',
  OWNER_EMAIL: 'owner@example.com',
};

interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: string | null;
}

const errOf = (x: Section<unknown> | undefined) => (x && !x.ok ? x.error : null);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Shapes as the live API returned them on 2026-10-27 (read-only calls). */
function fakeWorld(opts: { dailyBudget?: string; guardKeys?: string[]; autoPause?: boolean; insightsError?: boolean; leadsAdsetSpend?: string } = {}) {
  const calls: Call[] = [];
  const db = { guardKeys: opts.guardKeys ?? [], guardPatches: [] as Record<string, unknown>[], events: [] as unknown[] };
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    calls.push({ method, url, headers, body: typeof init.body === 'string' ? init.body : null });
    if (url.host === 'sb.test') {
      const table = url.pathname.split('/').pop();
      if (table === 'ads_settings') return json([{ ...settings, auto_pause: !!opts.autoPause }]);
      if (table === 'ads_guard_state' && method === 'GET') return json([{ active_keys: db.guardKeys }]);
      if (table === 'ads_guard_state' && method === 'PATCH') {
        const patch = JSON.parse(String(init.body));
        db.guardPatches.push(patch);
        db.guardKeys = patch.active_keys;
        return json([{ id: true }]);
      }
      if (table === 'ads_events') {
        db.events.push(JSON.parse(String(init.body)));
        return json([{ id: 1 }], 201);
      }
      if (table === 'social_auth') return json([]);
      return json([]);
    }
    if (url.host === 'api.resend.com') return json({ id: 'email' });
    if (url.host === 'graph.instagram.com') return json({ user_id: '1', username: 'rayvalue_usa', followers_count: 0, id: '2' });
    if (url.host === 'graph.facebook.com') {
      const path = url.pathname.replace('/v26.0/', '');
      if (method === 'POST') return json({ success: true });
      if (path === 'act_1657520542672231') return json({ name: '1657520542672231', currency: 'INR', timezone_name: 'Asia/Kolkata', account_status: 1, spend_cap: '84745', amount_spent: '0', id: 'act_1657520542672231' });
      if (path.endsWith('/campaigns')) return json({ data: [{ id: '120246779985410609', name: 'Leads', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE', configured_status: 'ACTIVE' }] });
      if (path.endsWith('/adsets'))
        return json({ data: [{ id: '120246779987350609', name: 'FL', campaign_id: '120246779985410609', effective_status: 'ACTIVE', configured_status: 'ACTIVE', daily_budget: opts.dailyBudget ?? '10000', lifetime_budget: '0', optimization_goal: 'LEAD_GENERATION' }] });
      if (path.endsWith('/ads')) return json({ data: [] });
      if (path.endsWith('/insights')) {
        if (opts.insightsError) return json({ error: { message: `bad token ${TOKEN}`, code: 190 } }, 400);
        const lifetimeAdset = url.searchParams.get('level') === 'adset' && url.searchParams.get('date_preset') === 'maximum';
        return json({ data: lifetimeAdset && opts.leadsAdsetSpend ? [{ adset_id: '120246779987350609', adset_name: 'FL', spend: opts.leadsAdsetSpend }] : [] });
      }
      if (path.endsWith('/leadgen_forms')) return json({ data: [{ id: '991483813293141', name: 'v1', status: 'ACTIVE', leads_count: 0, questions: [] }] });
      if (path.endsWith('/leads')) return json({ data: [] });
    }
    return json({ error: { message: 'unexpected' } }, 404);
  }) as typeof fetch;
  return { f, calls, db };
}

describe('withUserAgent', () => {
  it('adds the bot User-Agent and keeps other headers', async () => {
    let seen: Headers | null = null;
    const f = withUserAgent((async (_: RequestInfo | URL, init: RequestInit = {}) => {
      seen = new Headers(init.headers);
      return new Response('{}');
    }) as typeof fetch);
    await f('https://x.test', { headers: { Authorization: 'OAuth t' } });
    expect(seen!.get('user-agent')).toBe(BOT_USER_AGENT);
    expect(seen!.get('authorization')).toBe('OAuth t');
  });
});

describe('thresholdsOf', () => {
  it('reads PostgREST numeric strings; refuses non-positive values', () => {
    expect(thresholdsOf(settings)).toEqual({ leadsSpendNoLeadInr: 400, maxCostPerThruplayInr: 9.5, maxDailyBudgetInr: 100 });
    expect(thresholdsOf({ ...settings, max_daily_budget_inr: '0' })).toBeNull();
    expect(thresholdsOf({ ...settings, max_daily_budget_inr: 'x' })).toBeNull();
  });
});

describe('fetchSnapshot', () => {
  it('reads every section with GET only, the bot UA and the token in a header, never the URL', async () => {
    const w = fakeWorld();
    const s = await fetchSnapshot(env, settings, w.f, new Date('2026-10-27T06:00:00Z'), { leads: true, instagram: true, funnel: true });
    expect(s.account.ok && s.account.data).toMatchObject({ currency: 'INR', spendCapInr: 847.45 });
    expect(s.adsets.ok && s.adsets.data[0]?.dailyBudgetInr).toBe(100);
    expect(s.ads.ok && s.ads.data).toEqual([]);
    expect(s.insights.ok && s.insights.data).toMatchObject({ since: '2026-10-21', until: '2026-10-27', timezone: 'Asia/Kolkata' });
    expect(s.forms.ok && s.forms.data[0]?.id).toBe('991483813293141');
    expect(s.metaLeads.ok && s.metaLeads.data).toEqual([]);
    expect(s.instagram.ok && s.instagram.data).toEqual({ username: 'rayvalue_usa', followers: 0 });
    expect(s.funnel?.pageviews.ok).toBe(false);
    expect(errOf(s.funnel?.pageviews)).toContain('VERCEL_ANALYTICS_TOKEN');
    for (const c of w.calls) {
      expect(c.headers.get('user-agent')).toBe(BOT_USER_AGENT);
      expect(c.url.toString()).not.toContain(TOKEN);
    }
    expect(w.calls.filter((c) => c.url.host === 'graph.facebook.com').every((c) => c.method === 'GET' && c.headers.get('authorization') === `OAuth ${TOKEN}`)).toBe(true);
    // 8 insights calls: lifetime + daily for account, campaign, adset, ad.
    const insights = w.calls.filter((c) => c.url.pathname.endsWith('/insights'));
    expect(insights).toHaveLength(8);
    expect(insights.filter((c) => c.url.searchParams.get('time_increment') === '1').map((c) => JSON.parse(c.url.searchParams.get('time_range')!))).toContainEqual({ since: '2026-10-21', until: '2026-10-27' });
  });
  it('reports an insights failure without the token', async () => {
    const w = fakeWorld({ insightsError: true });
    const s = await fetchSnapshot(env, settings, w.f, new Date('2026-10-27T06:00:00Z'), { leads: false, instagram: false, funnel: false });
    expect(s.insights.ok).toBe(false);
    if (!s.insights.ok) {
      expect(s.insights.error).toContain('code 190');
      expect(s.insights.error).not.toContain(TOKEN);
    }
    expect(s.metaLeads.ok).toBe(false);
  });
  it('without FB_PAGE_TOKEN nothing is called on Meta', async () => {
    const w = fakeWorld();
    const s = await fetchSnapshot({ ...env, FB_PAGE_TOKEN: undefined }, settings, w.f, new Date(), { leads: true, instagram: false, funnel: false });
    expect(s.account.ok).toBe(false);
    expect(w.calls.some((c) => c.url.host === 'graph.facebook.com')).toBe(false);
  });
  it('asks Vercel for page views and events when configured, with repeated `by`', async () => {
    const w = fakeWorld();
    const vf = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      if (u.host === 'api.vercel.com') {
        w.calls.push({ method: 'GET', url: u, headers: new Headers(init?.headers), body: null });
        return u.pathname.includes('events') ? json({ error: { code: 'payment_required', message: 'Accessing Analytics custom events requires an Enterprise or Pro plan.' } }, 402) : json({ data: [{ utmCampaign: 'fl', pageviews: 3, visitors: 2 }] });
      }
      return w.f(input, init);
    }) as typeof fetch;
    const s = await fetchSnapshot({ ...env, VERCEL_ANALYTICS_TOKEN: 'vt', VERCEL_ANALYTICS_PROJECT_ID: 'prj_1', VERCEL_ANALYTICS_TEAM_ID: 'team_1' }, settings, vf, new Date('2026-10-27T06:00:00Z'), { leads: false, instagram: false, funnel: true });
    expect(s.funnel?.pageviews.ok && s.funnel.pageviews.data).toEqual([{ campaign: 'fl', pageviews: 3, visitors: 2 }]);
    expect(errOf(s.funnel?.events)).toContain('402');
    const ev = w.calls.find((c) => c.url.pathname.endsWith('events/aggregate'))!;
    expect(ev.url.searchParams.getAll('by')).toEqual(['eventName', 'utmCampaign']);
    expect(ev.url.searchParams.get('teamId')).toBe('team_1');
    expect(ev.headers.get('user-agent')).toBe(BOT_USER_AGENT);
  });
});

describe('runAdsGuard', () => {
  const now = new Date('2026-10-27T06:00:00Z');
  it('nothing tripped: no email, no Meta write, state saved', async () => {
    const w = fakeWorld();
    const out = await runAdsGuard(env, w.f, now);
    expect(out).toMatchObject({ ok: true, tripped: [], emailed: 'nothing_new', paused: [] });
    expect(w.calls.some((c) => c.url.host === 'api.resend.com')).toBe(false);
    expect(w.calls.some((c) => c.url.host === 'graph.facebook.com' && c.method !== 'GET')).toBe(false);
    expect(w.db.guardPatches[0]).toMatchObject({ active_keys: [] });
  });
  it('emails once when a rule newly trips, not again on the next run', async () => {
    const w = fakeWorld({ dailyBudget: '15000' });
    const first = await runAdsGuard(env, w.f, now);
    expect(first.emailed).toBe('sent');
    expect(first.newlyTripped).toEqual(['c:120246779987350609', 'c:sum']);
    const email = w.calls.find((c) => c.url.host === 'api.resend.com')!;
    expect(JSON.parse(email.body!).text).toContain('₹150');
    const second = await runAdsGuard(env, w.f, now);
    expect(second.emailed).toBe('nothing_new');
    expect(w.calls.filter((c) => c.url.host === 'api.resend.com')).toHaveLength(1);
  });
  it('never pauses while auto_pause is false, even on a pause rule', async () => {
    const w = fakeWorld({ dailyBudget: '15000' });
    await runAdsGuard(env, w.f, now);
    expect(w.calls.some((c) => c.method === 'POST' && c.url.host === 'graph.facebook.com')).toBe(false);
  });
  it('with auto_pause on, pauses the leads ad set on rule (a) and says so in the email', async () => {
    const w = fakeWorld({ autoPause: true, leadsAdsetSpend: '400.00' });
    const out = await runAdsGuard(env, w.f, now);
    expect(out.paused).toEqual(['120246779987350609']);
    const posts = w.calls.filter((c) => c.method === 'POST' && c.url.host === 'graph.facebook.com');
    expect(posts.map((c) => [c.url.pathname, c.body])).toEqual([['/v26.0/120246779987350609', 'status=PAUSED']]);
    expect(JSON.parse(w.calls.find((c) => c.url.host === 'api.resend.com')!.body!).text).toContain('Auto-paused ad set 120246779987350609');
  });
  it('with auto_pause off the same data only recommends', async () => {
    const w = fakeWorld({ leadsAdsetSpend: '400.00' });
    const out = await runAdsGuard(env, w.f, now);
    expect(out.newlyTripped).toEqual(['a:120246779987350609']);
    expect(out.paused).toEqual([]);
    expect(w.calls.some((c) => c.method === 'POST' && c.url.host === 'graph.facebook.com')).toBe(false);
  });
  it('reports Meta failures once as "not checked"', async () => {
    const w = fakeWorld({ insightsError: true });
    const out = await runAdsGuard(env, w.f, now);
    expect(out.newlyTripped).toEqual(['n:a', 'n:b', 'n:d']);
    expect(out.emailed).toBe('sent');
    const again = await runAdsGuard(env, w.f, now);
    expect(again.emailed).toBe('nothing_new');
  });
});

describe('pauseAdset', () => {
  it('POSTs status=PAUSED to the ad set with the token in a header, and logs it', async () => {
    const w = fakeWorld();
    const r = await pauseAdset(env, '120246779987350609', 'manual', w.f);
    expect(r).toEqual({ ok: true });
    const post = w.calls.find((c) => c.method === 'POST' && c.url.host === 'graph.facebook.com')!;
    expect(post.url.pathname).toBe('/v26.0/120246779987350609');
    expect(post.body).toBe('status=PAUSED');
    expect(post.headers.get('authorization')).toBe(`OAuth ${TOKEN}`);
    expect(post.headers.get('user-agent')).toBe(BOT_USER_AGENT);
    expect(w.db.events).toEqual([{ event: 'adset_paused', detail: { adset_id: '120246779987350609', by: 'manual' } }]);
  });
  it('refuses a malformed id without calling Meta', async () => {
    const w = fakeWorld();
    expect(await pauseAdset(env, '12; DROP', 'manual', w.f)).toEqual({ ok: false, error: 'not an ad set id' });
    expect(w.calls).toHaveLength(0);
  });
  it('scrubs the token from a Meta error', async () => {
    const f = withUserAgent((async (input: RequestInfo | URL) => (new URL(String(input)).host === 'graph.facebook.com' ? json({ error: { message: `nope ${TOKEN}`, code: 200 } }, 403) : json([{ id: 1 }], 201))) as typeof fetch);
    const r = await pauseAdset(env, '120246779987350609', 'manual', f);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('code 200');
      expect(r.error).not.toContain(TOKEN);
    }
  });
});
