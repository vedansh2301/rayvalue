/**
 * Ad spend guardrails (pure, unit tested). Thresholds come from public.ads_settings (with a rationale), never from
 * code. The rules:
 *   (a) a leads ad set (optimization goal LEAD_GENERATION, or its campaign's objective OUTCOME_LEADS / LEAD_GENERATION)
 *       has spent >= leadsSpendNoLeadInr lifetime with 0 leads -> "pause recommended";
 *   (b) cost per ThruPlay > maxCostPerThruplayInr on a video-views ad set (optimization goal THRUPLAY, or its campaign's
 *       objective VIDEO_VIEWS) -> "pause recommended". An ad set that spent more than the threshold with 0 ThruPlays
 *       is past it too (any first ThruPlay would cost more);
 *   (c) any one daily budget, or the sum of the daily budgets that can deliver (ACTIVE ad sets, plus ACTIVE campaigns
 *       holding the budget themselves), > maxDailyBudgetInr -> alert;
 *   (d) spend on the latest day of the daily data (today, ad account time zone) on a campaign or ad set whose
 *       effective_status is not ACTIVE -> alert. Ad sets under the enabled hour schedule (ads_schedule) are skipped:
 *       the schedule pauses them every day after they spent, and checks the daily cap itself.
 * A rule that cannot be checked (no insights, a non-INR account, ...) is listed in `notEvaluated` with the reason,
 * never treated as passing.
 */
import type { AdObject, AdsSnapshot, InsightRow } from './types';

export interface GuardThresholds {
  leadsSpendNoLeadInr: number;
  maxCostPerThruplayInr: number;
  maxDailyBudgetInr: number;
}

export interface GuardSnapshot {
  currency: string | null;
  campaigns: AdObject[] | null;
  adsets: AdObject[] | null;
  /** Lifetime insights per ad set (null = insights not available). */
  lifetimeAdsets: InsightRow[] | null;
  /** Daily insights per campaign / ad set for the range ending `today`. */
  dailyCampaigns: InsightRow[] | null;
  dailyAdsets: InsightRow[] | null;
  /** YYYY-MM-DD in the ad account time zone. */
  today: string | null;
  /** Ad sets the enabled hour schedule switches on and off (exempt from rule d). */
  scheduledAdsetIds?: readonly string[];
}

export type GuardRule = 'a' | 'b' | 'c' | 'd';
export type GuardSeverity = 'pause_recommended' | 'alert';

export interface GuardResult {
  /** Stable id used to send each alert once (e.g. "a:120..." or "c:sum"). */
  key: string;
  rule: GuardRule;
  severity: GuardSeverity;
  objectId: string | null;
  objectName: string | null;
  /** Ad set to pause for rules a/b. */
  pauseAdsetId: string | null;
  message: string;
}

export interface GuardOutcome {
  results: GuardResult[];
  notEvaluated: { rule: GuardRule; reason: string }[];
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const LEAD_GOALS = new Set(['LEAD_GENERATION', 'QUALITY_LEAD']);
const LEAD_OBJECTIVES = new Set(['OUTCOME_LEADS', 'LEAD_GENERATION']);
const VIDEO_GOALS = new Set(['THRUPLAY']);
const VIDEO_OBJECTIVES = new Set(['VIDEO_VIEWS']);

export function evaluateGuardrails(s: GuardSnapshot, t: GuardThresholds): GuardOutcome {
  const results: GuardResult[] = [];
  const notEvaluated: GuardOutcome['notEvaluated'] = [];
  const skip = (rule: GuardRule, reason: string) => notEvaluated.push({ rule, reason });

  if (s.currency !== 'INR') {
    for (const r of ['a', 'b', 'c', 'd'] as const) skip(r, s.currency ? `ad account currency is ${s.currency}, thresholds are in INR` : 'ad account currency not available');
    return { results, notEvaluated };
  }
  const campaignById = new Map((s.campaigns ?? []).map((c) => [c.id, c]));
  const objectiveOf = (a: AdObject) => (a.campaignId ? campaignById.get(a.campaignId)?.objective : null) ?? null;

  // (a) and (b): lifetime per ad set.
  if (!s.adsets) {
    skip('a', 'ad sets not available');
    skip('b', 'ad sets not available');
  } else if (!s.lifetimeAdsets) {
    skip('a', 'lifetime insights not available');
    skip('b', 'lifetime insights not available');
  } else {
    const life = new Map(s.lifetimeAdsets.map((r) => [r.id, r]));
    for (const a of s.adsets) {
      const m = life.get(a.id);
      const spend = m?.spendInr ?? 0;
      const objective = objectiveOf(a);
      const isLeads = (a.optimizationGoal !== null && LEAD_GOALS.has(a.optimizationGoal)) || (objective !== null && LEAD_OBJECTIVES.has(objective));
      const isVideo = (a.optimizationGoal !== null && VIDEO_GOALS.has(a.optimizationGoal)) || (objective !== null && VIDEO_OBJECTIVES.has(objective));
      if (isLeads && spend >= t.leadsSpendNoLeadInr && (m?.leads ?? 0) === 0) {
        results.push({
          key: `a:${a.id}`,
          rule: 'a',
          severity: 'pause_recommended',
          objectId: a.id,
          objectName: a.name,
          pauseAdsetId: a.id,
          message: `Leads ad set spent ${inr(spend)} lifetime with 0 leads (limit ${inr(t.leadsSpendNoLeadInr)}).`,
        });
      }
      if (isVideo && m && spend > 0) {
        const thruplays = m.thruplays ?? 0;
        const cpt = m.costPerThruplayInr;
        const over = thruplays > 0 ? cpt !== null && cpt > t.maxCostPerThruplayInr : spend > t.maxCostPerThruplayInr;
        if (over) {
          results.push({
            key: `b:${a.id}`,
            rule: 'b',
            severity: 'pause_recommended',
            objectId: a.id,
            objectName: a.name,
            pauseAdsetId: a.id,
            message:
              thruplays > 0
                ? `Cost per ThruPlay ${inr(cpt!)} is above ${inr(t.maxCostPerThruplayInr)}.`
                : `Spent ${inr(spend)} with 0 ThruPlays (cost per ThruPlay limit ${inr(t.maxCostPerThruplayInr)}).`,
          });
        }
      }
    }
  }

  // (c) budgets.
  if (!s.adsets || !s.campaigns) skip('c', 'campaigns or ad sets not available');
  else {
    for (const o of [...s.campaigns, ...s.adsets]) {
      if (o.dailyBudgetInr !== null && o.dailyBudgetInr > t.maxDailyBudgetInr) {
        results.push({
          key: `c:${o.id}`,
          rule: 'c',
          severity: 'alert',
          objectId: o.id,
          objectName: o.name,
          pauseAdsetId: null,
          message: `${o.level === 'campaign' ? 'Campaign' : 'Ad set'} daily budget ${inr(o.dailyBudgetInr)} is above the ${inr(t.maxDailyBudgetInr)} cap.`,
        });
      }
    }
    const active = (o: AdObject) => o.effectiveStatus === 'ACTIVE';
    const cbo = s.campaigns.filter((c) => active(c) && c.dailyBudgetInr !== null);
    const cboIds = new Set(cbo.map((c) => c.id));
    const adsetBudgets = s.adsets.filter((a) => active(a) && a.dailyBudgetInr !== null && !(a.campaignId && cboIds.has(a.campaignId)));
    const sum = [...cbo, ...adsetBudgets].reduce((n, o) => n + (o.dailyBudgetInr ?? 0), 0);
    if (sum > t.maxDailyBudgetInr) {
      results.push({
        key: 'c:sum',
        rule: 'c',
        severity: 'alert',
        objectId: null,
        objectName: null,
        pauseAdsetId: null,
        message: `Daily budgets that can deliver add up to ${inr(sum)}, above the ${inr(t.maxDailyBudgetInr)} cap.`,
      });
    }
  }

  // (d) spend today while not ACTIVE.
  if (!s.today || !s.dailyAdsets || !s.dailyCampaigns) skip('d', 'daily insights not available');
  else if (!s.adsets || !s.campaigns) skip('d', 'campaigns or ad sets not available');
  else {
    const byId = new Map([...s.campaigns, ...s.adsets].map((o) => [o.id, o]));
    for (const row of [...s.dailyCampaigns, ...s.dailyAdsets]) {
      if (row.dateStart !== s.today || !(row.spendInr && row.spendInr > 0)) continue;
      if (row.level === 'adset' && s.scheduledAdsetIds?.includes(row.id)) continue;
      const o = byId.get(row.id);
      const status = o?.effectiveStatus ?? null;
      if (status === 'ACTIVE') continue;
      results.push({
        key: `d:${row.id}`,
        rule: 'd',
        severity: 'alert',
        objectId: row.id,
        objectName: o?.name ?? row.name,
        pauseAdsetId: null,
        message: `Spent ${inr(row.spendInr)} today but effective_status is ${status ?? 'not visible through the API'} (spend from before a pause today also shows here).`,
      });
    }
  }
  return { results, notEvaluated };
}

/** The guard's view of a dashboard snapshot (missing sections stay null, so their rules are reported as not checked). */
export function guardInput(s: AdsSnapshot, scheduledAdsetIds: readonly string[] = []): GuardSnapshot {
  const ins = s.insights.ok ? s.insights.data : null;
  return {
    currency: s.account.ok ? s.account.data.currency : null,
    campaigns: s.campaigns.ok ? s.campaigns.data : null,
    adsets: s.adsets.ok ? s.adsets.data : null,
    lifetimeAdsets: ins ? ins.lifetime.adset : null,
    dailyCampaigns: ins ? ins.daily.campaign : null,
    dailyAdsets: ins ? ins.daily.adset : null,
    today: ins ? ins.until : null,
    scheduledAdsetIds,
  };
}

/** Results whose key was not active last time: these are the ones to email about. */
export function newlyTripped(results: GuardResult[], previousKeys: readonly string[]): GuardResult[] {
  const prev = new Set(previousKeys);
  return results.filter((r) => !prev.has(r.key));
}
