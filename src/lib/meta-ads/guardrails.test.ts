import { describe, expect, it } from 'vitest';
import { evaluateGuardrails, guardInput, newlyTripped, type GuardSnapshot, type GuardThresholds } from './guardrails';
import type { AdObject, AdsSnapshot, InsightRow } from './types';

const T: GuardThresholds = { leadsSpendNoLeadInr: 400, maxCostPerThruplayInr: 9.5, maxDailyBudgetInr: 100 };

const obj = (level: AdObject['level'], id: string, over: Partial<AdObject> = {}): AdObject => ({
  level,
  id,
  name: `${level} ${id}`,
  campaignId: null,
  adsetId: null,
  effectiveStatus: 'ACTIVE',
  configuredStatus: 'ACTIVE',
  dailyBudgetInr: null,
  lifetimeBudgetInr: null,
  issues: [],
  objective: null,
  optimizationGoal: null,
  startTime: null,
  endTime: null,
  ...over,
});

const row = (level: InsightRow['level'], id: string, over: Partial<InsightRow> = {}): InsightRow => ({
  level,
  id,
  name: null,
  dateStart: null,
  dateStop: null,
  spendInr: 0,
  impressions: null,
  reach: null,
  frequency: null,
  cpmInr: null,
  linkClicks: null,
  ctrPct: null,
  leads: 0,
  leadsActionType: null,
  costPerLeadInr: null,
  thruplays: 0,
  costPerThruplayInr: null,
  igProfileVisits: null,
  ...over,
});

const leadsCampaign = obj('campaign', 'C1', { objective: 'OUTCOME_LEADS' });
const videoCampaign = obj('campaign', 'C2', { objective: 'OUTCOME_AWARENESS' });
const leadsSet = obj('adset', 'S1', { campaignId: 'C1', optimizationGoal: 'LEAD_GENERATION', dailyBudgetInr: 100 });
const videoSet = obj('adset', 'S2', { campaignId: 'C2', optimizationGoal: 'THRUPLAY', effectiveStatus: 'PAUSED', configuredStatus: 'PAUSED', dailyBudgetInr: 50 });

const base = (over: Partial<GuardSnapshot> = {}): GuardSnapshot => ({
  currency: 'INR',
  campaigns: [leadsCampaign, videoCampaign],
  adsets: [leadsSet, videoSet],
  lifetimeAdsets: [],
  dailyCampaigns: [],
  dailyAdsets: [],
  today: '2026-10-28',
  ...over,
});

const keys = (s: GuardSnapshot, t = T) => evaluateGuardrails(s, t).results.map((r) => r.key);

describe('rule (a): leads ad set spend with no leads', () => {
  it('trips at the threshold with 0 leads and recommends pausing that ad set', () => {
    const out = evaluateGuardrails(base({ lifetimeAdsets: [row('adset', 'S1', { spendInr: 400, leads: 0 })] }), T);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ key: 'a:S1', rule: 'a', severity: 'pause_recommended', pauseAdsetId: 'S1' });
    expect(out.notEvaluated).toEqual([]);
  });
  it('does not trip below the threshold or with a lead', () => {
    expect(keys(base({ lifetimeAdsets: [row('adset', 'S1', { spendInr: 399.99 })] }))).toEqual([]);
    expect(keys(base({ lifetimeAdsets: [row('adset', 'S1', { spendInr: 900, leads: 1 })] }))).toEqual([]);
  });
  it('a leads campaign objective alone makes the ad set a leads ad set', () => {
    const s = obj('adset', 'S3', { campaignId: 'C1', optimizationGoal: 'REACH' });
    expect(keys(base({ adsets: [s], lifetimeAdsets: [row('adset', 'S3', { spendInr: 500, leads: null })] }))).toEqual(['a:S3']);
  });
  it('does not apply to a non-leads ad set', () => {
    expect(keys(base({ lifetimeAdsets: [row('adset', 'S2', { spendInr: 1000, leads: 0, thruplays: 500, costPerThruplayInr: 2 })] }))).toEqual([]);
  });
});

describe('rule (b): cost per ThruPlay', () => {
  it('trips above the threshold on a video-views ad set', () => {
    expect(keys(base({ lifetimeAdsets: [row('adset', 'S2', { spendInr: 100, thruplays: 10, costPerThruplayInr: 10 })] }))).toEqual(['b:S2']);
  });
  it('not at or below the threshold', () => {
    expect(keys(base({ lifetimeAdsets: [row('adset', 'S2', { spendInr: 95, thruplays: 10, costPerThruplayInr: 9.5 })] }))).toEqual([]);
  });
  it('spend above the threshold with 0 ThruPlays trips; small spend does not', () => {
    expect(keys(base({ lifetimeAdsets: [row('adset', 'S2', { spendInr: 10, thruplays: 0 })] }))).toEqual(['b:S2']);
    expect(keys(base({ lifetimeAdsets: [row('adset', 'S2', { spendInr: 9, thruplays: 0 })] }))).toEqual([]);
  });
  it('a VIDEO_VIEWS campaign objective counts too; leads ad sets are not judged on ThruPlays', () => {
    const v = obj('campaign', 'C9', { objective: 'VIDEO_VIEWS' });
    const s = obj('adset', 'S9', { campaignId: 'C9', optimizationGoal: 'IMPRESSIONS' });
    expect(keys(base({ campaigns: [v], adsets: [s], lifetimeAdsets: [row('adset', 'S9', { spendInr: 50, thruplays: 1, costPerThruplayInr: 50 })] }))).toEqual(['b:S9']);
    expect(keys(base({ lifetimeAdsets: [row('adset', 'S1', { spendInr: 50, leads: 1, thruplays: 1, costPerThruplayInr: 50 })] }))).toEqual([]);
  });
});

describe('rule (c): budgets', () => {
  it('passes at exactly the cap (₹100 active + a paused ₹50 ad set)', () => {
    expect(keys(base())).toEqual([]);
  });
  it('one budget over the cap', () => {
    expect(keys(base({ adsets: [{ ...leadsSet, dailyBudgetInr: 150 }] }))).toEqual(['c:S1', 'c:sum']);
  });
  it('the sum of delivering budgets over the cap', () => {
    const second = obj('adset', 'S4', { campaignId: 'C1', dailyBudgetInr: 60 });
    const out = evaluateGuardrails(base({ adsets: [{ ...leadsSet, dailyBudgetInr: 60 }, second] }), T);
    expect(out.results.map((r) => r.key)).toEqual(['c:sum']);
    expect(out.results[0]!.message).toContain('₹120');
  });
  it('a campaign budget (CBO) counts once, not again through its ad sets', () => {
    const cbo = obj('campaign', 'C5', { dailyBudgetInr: 80 });
    const child = obj('adset', 'S5', { campaignId: 'C5', dailyBudgetInr: 80 });
    expect(keys(base({ campaigns: [cbo], adsets: [child] }))).toEqual([]);
    const other = obj('adset', 'S6', { dailyBudgetInr: 30 });
    expect(keys(base({ campaigns: [cbo], adsets: [child, other] }))).toEqual(['c:sum']);
  });
  it('a campaign budget over the cap', () => {
    expect(keys(base({ campaigns: [obj('campaign', 'C7', { dailyBudgetInr: 101 })], adsets: [] }))).toEqual(['c:C7', 'c:sum']);
  });
});

describe('rule (d): spend today while not ACTIVE', () => {
  it('alerts for a paused ad set that spent today, not for yesterday or an active one', () => {
    const daily = [row('adset', 'S2', { dateStart: '2026-10-28', spendInr: 3 }), row('adset', 'S2', { dateStart: '2026-10-27', spendInr: 40 }), row('adset', 'S1', { dateStart: '2026-10-28', spendInr: 50 })];
    expect(keys(base({ dailyAdsets: daily }))).toEqual(['d:S2']);
  });
  it('also for objects the API does not show', () => {
    const out = evaluateGuardrails(base({ dailyCampaigns: [row('campaign', 'GHOST', { dateStart: '2026-10-28', spendInr: 1, name: 'hidden' })] }), T);
    expect(out.results[0]).toMatchObject({ key: 'd:GHOST', objectName: 'hidden' });
    expect(out.results[0]!.message).toContain('not visible through the API');
  });
});

describe('not evaluated', () => {
  it('a non-INR account checks nothing', () => {
    const out = evaluateGuardrails(base({ currency: 'USD', adsets: [{ ...leadsSet, dailyBudgetInr: 1000 }] }), T);
    expect(out.results).toEqual([]);
    expect(out.notEvaluated.map((n) => n.rule)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('missing insights skip a, b and d but budgets are still checked', () => {
    const out = evaluateGuardrails(base({ lifetimeAdsets: null, dailyAdsets: null, adsets: [{ ...leadsSet, dailyBudgetInr: 200 }] }), T);
    expect(out.results.map((r) => r.key)).toEqual(['c:S1', 'c:sum']);
    expect(out.notEvaluated.map((n) => n.rule)).toEqual(['a', 'b', 'd']);
  });
  it('missing ad sets skip everything', () => {
    expect(evaluateGuardrails(base({ adsets: null }), T).notEvaluated.map((n) => n.rule)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('thresholds come from the caller', () => {
  it('a lower cap trips the same data', () => {
    expect(keys(base(), { ...T, maxDailyBudgetInr: 99 })).toEqual(['c:S1', 'c:sum']);
  });
});

describe('newlyTripped', () => {
  it('returns only keys not active last time', () => {
    const out = evaluateGuardrails(base({ lifetimeAdsets: [row('adset', 'S1', { spendInr: 500 })], adsets: [{ ...leadsSet, dailyBudgetInr: 150 }, videoSet] }), T);
    expect(newlyTripped(out.results, ['a:S1']).map((r) => r.key)).toEqual(['c:S1', 'c:sum']);
    expect(newlyTripped(out.results, ['a:S1', 'c:S1', 'c:sum'])).toEqual([]);
  });
});

describe('guardInput', () => {
  it('nulls out sections that failed', () => {
    const at = '2026-10-28T00:00:00Z';
    const fail = { ok: false as const, error: 'x', at, source: 's' };
    const snap: AdsSnapshot = {
      version: 1,
      fetchedAt: at,
      account: { ok: true, at, source: 's', data: { id: 'act_1', name: null, currency: 'INR', timezone: 'Asia/Kolkata', accountStatus: 1, spendCapInr: null, amountSpentInr: 0 } },
      campaigns: { ok: true, at, source: 's', data: [leadsCampaign] },
      adsets: fail,
      ads: fail,
      insights: fail,
      forms: fail,
      metaLeads: fail,
      instagram: fail,
      funnel: null,
    };
    expect(guardInput(snap)).toEqual({ currency: 'INR', campaigns: [leadsCampaign], adsets: null, lifetimeAdsets: null, dailyCampaigns: null, dailyAdsets: null, today: null });
  });
});
