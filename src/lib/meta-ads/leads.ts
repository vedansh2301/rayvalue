/**
 * Meta Instant Form leads and website leads for /admin/ads (pure, unit tested).
 *
 * Lead retrieval (checked 2026-10-27, read-only): GET /{page-id}/leadgen_forms?fields=id,name,status,leads_count,
 * questions{key,type,label,options} and GET /{form-id}/leads?fields=created_time,field_data,ad_id,adset_id,campaign_id,
 * form_id,is_organic,platform,custom_disclaimer_responses (https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving).
 * field_data = [{ name: <question key>, values: [<answer>] }]; the consent checkbox comes back in
 * custom_disclaimer_responses = [{ checkbox_key, is_checked: "1" | "" }]. Lead reads are rate limited to
 * 200 x 24 x (leads created in the past 90 days) calls per Page per 24 h, so the dashboard caches them. A multiple-choice answer is matched against the form's
 * own options by key or by label, so either form of the answer maps to the same key.
 *
 * PII: rows from here go to the admin page only. Nothing in this module logs.
 */
import { stateByPrefix } from '../calculator/zip';
import type { LeadForm, LeadFormQuestion, MetaLead } from './types';

type Raw = Record<string, unknown>;

/** Shown on every Meta lead: the v1 form's consent covers contact by RayValue only. */
export const META_CONSENT_BADGE = 'v1 consent: RayValue contact only — do not route to installers';
export const CONSENT_CHECKBOX_KEY = 'tcpa_consent';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function parseForm(raw: unknown): LeadForm | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const id = str(r.id);
  if (!id) return null;
  const qs = (r.questions && typeof r.questions === 'object' && Array.isArray(r.questions) ? r.questions : []) as unknown[];
  const questions: LeadFormQuestion[] = qs.flatMap((q) => {
    if (!q || typeof q !== 'object') return [];
    const key = str((q as Raw).key);
    if (!key) return [];
    const opts = Array.isArray((q as Raw).options) ? ((q as Raw).options as unknown[]) : [];
    return [
      {
        key,
        type: str((q as Raw).type),
        label: str((q as Raw).label),
        options: opts.flatMap((o) => {
          const k = o && typeof o === 'object' ? str((o as Raw).key) : null;
          return k ? [{ key: k, value: str((o as Raw).value) ?? k }] : [];
        }),
      },
    ];
  });
  const leadsCount = typeof r.leads_count === 'number' && Number.isFinite(r.leads_count) ? r.leads_count : null;
  return { id, name: str(r.name) ?? '(no name)', status: str(r.status), leadsCount, questions };
}

const norm = (s: string) => s.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

/** A choice answer -> the option key (matching key or label, case-insensitive). Unknown answers are kept as given. */
export function choiceKey(answer: string | null, question: LeadFormQuestion | undefined): string | null {
  if (answer === null) return null;
  if (!question || question.options.length === 0) return answer;
  const a = norm(answer);
  const hit = question.options.find((o) => norm(o.key) === a || norm(o.value) === a);
  return hit ? hit.key : answer;
}

const KNOWN = new Set(['first_name', 'last_name', 'full_name', 'email', 'phone_number', 'zip_code', 'post_code', 'homeowner', 'monthly_bill', 'timeline']);

/** One GET /{form-id}/leads item -> MetaLead. null when it has no id or created_time. */
export function mapMetaLead(raw: unknown, form: LeadForm | null): MetaLead | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const id = str(r.id);
  const createdTime = str(r.created_time);
  if (!id || !createdTime) return null;
  const answers: Record<string, string> = {};
  if (Array.isArray(r.field_data)) {
    for (const f of r.field_data) {
      if (!f || typeof f !== 'object') continue;
      const name = str((f as Raw).name);
      const values = Array.isArray((f as Raw).values) ? ((f as Raw).values as unknown[]).map(str).filter((v): v is string => v !== null) : [];
      if (name && values.length) answers[name] = values.join(', ');
    }
  }
  const q = (key: string) => form?.questions.find((x) => x.key === key);
  let consent: boolean | null = null;
  if (Array.isArray(r.custom_disclaimer_responses)) {
    for (const c of r.custom_disclaimer_responses) {
      if (c && typeof c === 'object' && (c as Raw).checkbox_key === CONSENT_CHECKBOX_KEY) {
        const v = (c as Raw).is_checked;
        consent = v === true || v === '1' || v === 1 || v === 'true';
      }
    }
  }
  const zipRaw = answers.zip_code ?? answers.post_code ?? null;
  const zip = zipRaw && /^\d{5}/.test(zipRaw) ? zipRaw.slice(0, 5) : zipRaw;
  const other: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) if (!KNOWN.has(k)) other[k] = v;
  let first: string | null = answers.first_name ?? null;
  let last: string | null = answers.last_name ?? null;
  if (!first && !last && answers.full_name) {
    const parts = answers.full_name.split(' ');
    first = parts[0] ?? null;
    last = parts.slice(1).join(' ') || null;
  }
  return {
    id,
    createdTime,
    formId: str(r.form_id) ?? form?.id ?? null,
    formName: form?.name ?? null,
    adId: str(r.ad_id),
    adsetId: str(r.adset_id),
    campaignId: str(r.campaign_id),
    isOrganic: typeof r.is_organic === 'boolean' ? r.is_organic : null,
    platform: str(r.platform),
    firstName: first,
    lastName: last,
    email: answers.email ?? null,
    phone: answers.phone_number ?? null,
    zip,
    state: zip && /^\d{5}$/.test(zip) ? stateByPrefix(zip) : null,
    homeowner: choiceKey(answers.homeowner ?? null, q('homeowner')),
    billBucket: choiceKey(answers.monthly_bill ?? null, q('monthly_bill')),
    timeline: choiceKey(answers.timeline ?? null, q('timeline')),
    consent,
    other,
  };
}

/** Website lead columns read for the dashboard (public.leads, server-only key). */
export interface WebsiteLead {
  id: string;
  created_at: string;
  status: string;
  source: string;
  state: string;
  zip: string;
  homeowner: boolean;
  bill_bucket: string | null;
  timeline: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  fbclid: string | null;
  landing_page: string | null;
}

export const WEBSITE_LEAD_SELECT = 'id,created_at,status,source,state,zip,homeowner,bill_bucket,timeline,first_name,last_name,email,phone,utm_source,utm_medium,utm_campaign,fbclid,landing_page';

/** One row of the combined leads table and the breakdowns. */
export interface UnifiedLead {
  origin: 'meta_form' | 'website';
  id: string;
  createdAt: string;
  name: string;
  email: string | null;
  phone: string | null;
  zip: string | null;
  state: string | null;
  homeowner: string | null;
  billBucket: string | null;
  timeline: string | null;
  source: string;
  utmSource: string | null;
  utmCampaign: string | null;
  status: string;
  /** Meta: campaign / ad set / ad ids; website: landing page and fbclid presence. */
  detail: string;
  consent: boolean | null;
}

const fullName = (a: string | null, b: string | null) => [a, b].filter(Boolean).join(' ') || '(no name)';

export function unifyMetaLead(l: MetaLead): UnifiedLead {
  return {
    origin: 'meta_form',
    id: l.id,
    createdAt: l.createdTime,
    name: fullName(l.firstName, l.lastName),
    email: l.email,
    phone: l.phone,
    zip: l.zip,
    state: l.state,
    homeowner: l.homeowner,
    billBucket: l.billBucket,
    timeline: l.timeline,
    source: l.isOrganic ? 'meta_form_organic' : 'meta_instant_form',
    utmSource: null,
    utmCampaign: null,
    status: 'meta_form (not routed)',
    detail: [l.platform && `platform ${l.platform}`, l.campaignId && `campaign ${l.campaignId}`, l.adsetId && `ad set ${l.adsetId}`, l.adId && `ad ${l.adId}`].filter(Boolean).join(' · '),
    consent: l.consent,
  };
}

export function unifyWebsiteLead(l: WebsiteLead): UnifiedLead {
  return {
    origin: 'website',
    id: l.id,
    createdAt: l.created_at,
    name: fullName(l.first_name, l.last_name),
    email: l.email,
    phone: l.phone,
    zip: l.zip,
    state: l.state,
    homeowner: l.homeowner ? 'yes' : 'no',
    billBucket: l.bill_bucket,
    timeline: l.timeline,
    source: l.source,
    utmSource: l.utm_source,
    utmCampaign: l.utm_campaign,
    status: l.status,
    detail: [l.landing_page && `landed ${l.landing_page}`, l.fbclid ? 'fbclid' : null].filter(Boolean).join(' · '),
    consent: null,
  };
}

/** Newest first. */
export const sortNewest = (rows: UnifiedLead[]) => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const BREAKDOWN_KEYS = ['source', 'utmSource', 'utmCampaign', 'state', 'homeowner', 'billBucket', 'timeline', 'status'] as const;
export type BreakdownKey = (typeof BREAKDOWN_KEYS)[number];
export const BREAKDOWN_LABEL: Record<BreakdownKey, string> = {
  source: 'Source',
  utmSource: 'utm_source',
  utmCampaign: 'utm_campaign',
  state: 'State (Meta: from ZIP)',
  homeowner: 'Homeowner',
  billBucket: 'Monthly bill',
  timeline: 'Timeline',
  status: 'Status',
};

export interface BreakdownRow {
  value: string;
  total: number;
  meta: number;
  website: number;
}

export const NONE = '(none)';

/** Counts by one field, split Meta / website, biggest first then by value. Empty values count as "(none)". */
export function breakdown(rows: UnifiedLead[], key: BreakdownKey): BreakdownRow[] {
  const m = new Map<string, BreakdownRow>();
  for (const r of rows) {
    const value = r[key] || NONE;
    const row = m.get(value) ?? { value, total: 0, meta: 0, website: 0 };
    row.total++;
    if (r.origin === 'meta_form') row.meta++;
    else row.website++;
    m.set(value, row);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));
}
