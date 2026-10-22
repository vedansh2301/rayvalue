/**
 * Lead and data-request validation (pure; shared by the quote form and the API routes).
 * Normalizes what the user typed; it never invents or derives estimate values.
 */
import type { State } from '../../data/schemas';
import { stateByPrefix } from '../calculator/zip';

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export const TIMELINES = ['asap', '1_3_months', '3_6_months', 'researching'] as const;
export type Timeline = (typeof TIMELINES)[number];
export const TIMELINE_LABELS: Record<Timeline, string> = {
  asap: 'As soon as possible',
  '1_3_months': 'In 1–3 months',
  '3_6_months': 'In 3–6 months',
  researching: 'Just researching',
};

export const DATA_REQUEST_TYPES = ['delete', 'access', 'correct', 'do_not_sell'] as const;
export type DataRequestType = (typeof DATA_REQUEST_TYPES)[number];
export const DATA_REQUEST_LABELS: Record<DataRequestType, string> = {
  delete: 'Delete my data',
  access: 'Send me a copy of my data',
  correct: 'Correct my data',
  do_not_sell: 'Do not sell or share my personal information',
};

const STATE_NAMES: Record<State, string> = { FL: 'Florida', CA: 'California' };
const SHADINGS = ['none', 'some', 'heavy'] as const;
const SOURCE_RE = /^(results|quotes_page|home|city:(florida|california)\/[a-z0-9]+(-[a-z0-9]+)*)$/;
const UTILITY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAPSHOT_KEYS = ['system_size', 'upfront_cost', 'payback', 'net_savings'] as const;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const has = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/**
 * A US phone number as typed -> E.164 "+1XXXXXXXXXX", or null. NANP: area code and exchange start with 2–9 and
 * are not N11 service codes (211, 311, 411, 911, …).
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  if (/[^\d\s().+\-]/.test(raw)) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  if (d.slice(1, 3) === '11' || d.slice(4, 6) === '11') return null;
  return `+1${d}`;
}

export function normalizeEmail(raw: unknown): string | null {
  const e = str(raw).toLowerCase();
  return e && e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

export const PHONE_ERROR = 'Enter a 10-digit US phone number, like 305-555-0123.';

const truthy = (v: unknown) => v === true || v === 'on' || v === 'true' || v === 'yes';

/** Raw fields as posted (form or JSON). Unknown keys are ignored. */
export type LeadFields = Record<string, unknown>;

export type LeadField = 'first_name' | 'email' | 'phone' | 'zip' | 'state' | 'homeowner' | 'timeline' | 'consent' | 'form';
export type FieldErrors = Partial<Record<LeadField, string>>;

/** One displayed range ("10.7 kW" etc.), copied from what the results card showed. */
export type SnapshotValue = { likely: string; low: string; high: string } | { value: string };
export type EstimateSnapshot = Partial<Record<(typeof SNAPSHOT_KEYS)[number], SnapshotValue>>;

/** The insertable lead (user-supplied columns only; consent and user agent are added by the server). */
export interface LeadInput {
  first_name: string;
  email: string;
  phone: string;
  zip: string;
  state: State;
  utility_id: string | null;
  avg_monthly_bill: number | null;
  battery: 0 | 1 | 2 | null;
  shading: 'none' | 'some' | 'heavy' | null;
  homeowner: boolean;
  timeline: Timeline;
  estimate_snapshot: EstimateSnapshot | null;
  source: string;
  page_path: string | null;
}

export type LeadValidation = { kind: 'honeypot' } | { kind: 'invalid'; fieldErrors: FieldErrors } | { kind: 'ok'; lead: LeadInput };

const shortStr = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 40;

/** Accepts the snapshot as an object or a JSON string; keeps only known keys of short strings. Invalid -> null. */
export function parseSnapshot(raw: unknown): EstimateSnapshot | null {
  let v = raw;
  if (typeof v === 'string') {
    if (v.trim() === '' || v.length > 2000) return null;
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: EstimateSnapshot = {};
  for (const k of SNAPSHOT_KEYS) {
    const m = (v as Record<string, unknown>)[k];
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    if (shortStr(r.likely) && shortStr(r.low) && shortStr(r.high)) out[k] = { likely: r.likely as string, low: r.low as string, high: r.high as string };
    else if (shortStr(r.value)) out[k] = { value: r.value as string };
  }
  return Object.keys(out).length ? out : null;
}

/** "/quotes?zip=1" -> "/quotes" (query strings can carry the ZIP and bill). */
export function cleanPath(raw: unknown): string | null {
  const s = str(raw);
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  const p = s.split(/[?#]/)[0]!;
  return p.length <= 200 ? p : null;
}

export function validateLead(f: LeadFields): LeadValidation {
  if (has(f.website)) return { kind: 'honeypot' };
  const errors: FieldErrors = {};

  const first = str(f.first_name).replace(/\s+/g, ' ');
  if (!first) errors.first_name = 'Enter your first name.';
  else if (first.length > 60) errors.first_name = 'Use 60 characters or fewer.';

  const email = normalizeEmail(f.email);
  if (!email) errors.email = 'Enter a valid email address, like name@example.com.';

  const phone = normalizePhone(f.phone);
  if (!phone) errors.phone = PHONE_ERROR;

  const zip = str(f.zip);
  const chosen = str(f.state).toUpperCase();
  const state = chosen === 'FL' || chosen === 'CA' ? chosen : null;
  const zipState = /^\d{5}$/.test(zip) ? stateByPrefix(zip) : null;
  if (has(f.state) && !state) errors.state = 'Choose Florida or California.';
  if (!/^\d{5}$/.test(zip)) errors.zip = 'Enter a 5-digit ZIP code.';
  else if (!zipState) errors.zip = 'We currently cover Florida and California ZIP codes only.';
  else if (state && zipState !== state) errors.zip = `That ZIP code is in ${STATE_NAMES[zipState]}, not ${STATE_NAMES[state]}.`;

  const ho = str(f.homeowner).toLowerCase();
  const homeowner = f.homeowner === true || ho === 'yes' || ho === 'true' ? true : f.homeowner === false || ho === 'no' || ho === 'false' ? false : null;
  if (homeowner === null) errors.homeowner = 'Tell us whether you own this home.';

  const timeline = str(f.timeline) as Timeline;
  if (!(TIMELINES as readonly string[]).includes(timeline)) errors.timeline = 'Choose when you’re hoping to go solar.';

  if (!truthy(f.consent)) errors.consent = 'Check the box to agree to be contacted about quotes.';

  const source = str(f.source);
  const finalState = state ?? zipState;
  if (Object.keys(errors).length || !finalState || homeowner === null) return { kind: 'invalid', fieldErrors: errors };

  // Optional calculator context (results only). Anything malformed is dropped rather than rejected.
  const utility = str(f.utility_id);
  const billN = typeof f.bill === 'number' ? f.bill : Number(str(f.bill));
  const batteryN = typeof f.battery === 'number' ? f.battery : has(f.battery) ? Number(str(f.battery)) : NaN;
  const shading = str(f.shading);

  return {
    kind: 'ok',
    lead: {
      first_name: first,
      email: email!,
      phone: phone!,
      zip,
      state: finalState,
      utility_id: utility && utility.length <= 64 && UTILITY_RE.test(utility) ? utility : null,
      avg_monthly_bill: has(f.bill) && Number.isFinite(billN) && billN > 0 && billN < 1e6 ? billN : null,
      battery: batteryN === 0 || batteryN === 1 || batteryN === 2 ? batteryN : null,
      shading: (SHADINGS as readonly string[]).includes(shading) ? (shading as LeadInput['shading']) : null,
      homeowner,
      timeline,
      estimate_snapshot: parseSnapshot(f.estimate_snapshot),
      source: SOURCE_RE.test(source) ? source : 'quotes_page',
      page_path: cleanPath(f.page_path),
    },
  };
}

export type DataRequestField = 'email' | 'request' | 'details';
export type DataRequestValidation =
  | { kind: 'honeypot' }
  | { kind: 'invalid'; fieldErrors: Partial<Record<DataRequestField, string>> }
  | { kind: 'ok'; value: { email: string; request: DataRequestType; details: string | null } };

export function validateDataRequest(f: Record<string, unknown>): DataRequestValidation {
  if (has(f.website)) return { kind: 'honeypot' };
  const errors: Partial<Record<DataRequestField, string>> = {};
  const email = normalizeEmail(f.email);
  if (!email) errors.email = 'Enter a valid email address, like name@example.com.';
  const request = str(f.request) as DataRequestType;
  if (!(DATA_REQUEST_TYPES as readonly string[]).includes(request)) errors.request = 'Choose what you’d like us to do.';
  const details = str(f.details);
  if (details.length > 1000) errors.details = 'Use 1,000 characters or fewer.';
  if (Object.keys(errors).length) return { kind: 'invalid', fieldErrors: errors };
  return { kind: 'ok', value: { email: email!, request, details: details || null } };
}
