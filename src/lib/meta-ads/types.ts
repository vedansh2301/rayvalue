/**
 * Shapes of the /admin/ads snapshot (pure types). Every section carries its own fetch time and either data or the
 * exact reason it is missing, so the page can say "not available" instead of showing a guess.
 */

/** A section of the snapshot: the data, or why there is none. `at` = when it was fetched (ISO). */
export type Section<T> = { ok: true; data: T; at: string; source: string } | { ok: false; error: string; at: string; source: string };

export type AdLevel = 'campaign' | 'adset' | 'ad';

export interface AdIssue {
  summary: string;
  message: string | null;
  level: string | null;
}

export interface AdObject {
  level: AdLevel;
  id: string;
  name: string;
  /** campaign_id for ad sets and ads (null for campaigns). */
  campaignId: string | null;
  /** adset_id for ads (null otherwise). */
  adsetId: string | null;
  effectiveStatus: string | null;
  configuredStatus: string | null;
  /** In INR (major units), converted from Meta's minor units; null when not set or 0 (Meta returns "0" for "no budget at this level"). */
  dailyBudgetInr: number | null;
  lifetimeBudgetInr: number | null;
  issues: AdIssue[];
  objective: string | null;
  optimizationGoal: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface AdAccount {
  id: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  /** Meta's account_status code (1 = active, 2 = disabled, 3 = unsettled, 7 = pending risk review, ...). */
  accountStatus: number | null;
  /** Account spending limit, INR (null when not set). */
  spendCapInr: number | null;
  amountSpentInr: number | null;
}

export interface InsightMetrics {
  spendInr: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  cpmInr: number | null;
  linkClicks: number | null;
  /** Percent, as Meta reports inline_link_click_ctr (1.5 = 1.5%). */
  ctrPct: number | null;
  leads: number | null;
  /** The action_type the lead count was read from. */
  leadsActionType: string | null;
  costPerLeadInr: number | null;
  thruplays: number | null;
  costPerThruplayInr: number | null;
  igProfileVisits: number | null;
}

export interface InsightRow extends InsightMetrics {
  level: AdLevel | 'account';
  /** Object id at that level (the account id for level 'account'). */
  id: string;
  name: string | null;
  dateStart: string | null;
  dateStop: string | null;
}

export interface AdsInsights {
  /** Date range of the daily rows, in the ad account's time zone. */
  since: string;
  until: string;
  timezone: string;
  lifetime: Record<'account' | AdLevel, InsightRow[]>;
  daily: Record<'account' | AdLevel, InsightRow[]>;
}

export interface LeadFormQuestion {
  key: string;
  type: string | null;
  label: string | null;
  options: { key: string; value: string }[];
}

export interface LeadForm {
  id: string;
  name: string;
  status: string | null;
  leadsCount: number | null;
  questions: LeadFormQuestion[];
}

/** One Meta Instant Form lead, mapped (PII: admin page only, never logged). */
export interface MetaLead {
  id: string;
  createdTime: string;
  formId: string | null;
  formName: string | null;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  isOrganic: boolean | null;
  platform: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  zip: string | null;
  /** From the ZIP's 3-digit prefix (src/lib/calculator/zip.ts); null when the ZIP is outside FL/CA or missing. */
  state: 'FL' | 'CA' | null;
  homeowner: string | null;
  billBucket: string | null;
  timeline: string | null;
  /** tcpa_consent checkbox: true / false, null when the response has no such checkbox. */
  consent: boolean | null;
  /** Answers to fields this mapping does not know (kept so nothing is silently dropped). */
  other: Record<string, string>;
}

export interface InstagramAccount {
  username: string | null;
  followers: number | null;
}

export interface FunnelCount {
  key: string;
  count: number;
}

export interface SiteFunnel {
  since: string;
  until: string;
  /** Page views by utm_campaign ("(not set)" for none), from the Vercel Web Analytics API. */
  pageviews: Section<{ campaign: string; pageviews: number; visitors: number }[]>;
  /** Custom events by name and utm_campaign. */
  events: Section<{ event: string; campaign: string; count: number }[]>;
}

export interface AdsSnapshot {
  version: 1;
  fetchedAt: string;
  account: Section<AdAccount>;
  campaigns: Section<AdObject[]>;
  adsets: Section<AdObject[]>;
  ads: Section<AdObject[]>;
  insights: Section<AdsInsights>;
  forms: Section<LeadForm[]>;
  metaLeads: Section<MetaLead[]>;
  instagram: Section<InstagramAccount>;
  funnel: SiteFunnel | null;
}
