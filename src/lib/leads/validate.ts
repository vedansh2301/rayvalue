/**
 * Lead and data-request validation (pure; shared by the quote form and the API routes).
 * Normalizes what the user typed; it never invents or derives estimate values.
 * The quote form has three steps; each step has its own validator and validateLead runs all three (the server
 * always runs all three, whatever the client did).
 */
import type { State } from '../../data/schemas';
import { stateByPrefix } from '../calculator/zip';
import {
  BATTERY_INTERESTS,
  BILL_BUCKETS,
  OTHER_UTILITY,
  PAY_METHODS,
  ROOF_AGES,
  SHADES,
  TIMELINES,
  type BatteryInterest,
  type BillBucket,
  type PayMethod,
  type RoofAge,
  type Shade,
  type Timeline,
} from './options';

export { TIMELINES, TIMELINE_LABELS, type Timeline } from './options';

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export const DATA_REQUEST_TYPES = ['delete', 'access', 'correct', 'do_not_sell'] as const;
export type DataRequestType = (typeof DATA_REQUEST_TYPES)[number];
export const DATA_REQUEST_LABELS: Record<DataRequestType, string> = {
  delete: 'Delete my data',
  access: 'Send me a copy of my data',
  correct: 'Correct my data',
  do_not_sell: 'Do not sell or share my personal information',
};

const STATE_NAMES: Record<State, string> = { FL: 'Florida', CA: 'California' };
const SOURCE_RE = /^(results|quotes_page|home|utility:(fpl|duke-energy-florida|teco|pge|sce|sdge)|city:(florida|california)\/[a-z0-9]+(-[a-z0-9]+)*)$/;
const UTILITY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAPSHOT_KEYS = ['system_size', 'upfront_cost', 'payback', 'net_savings'] as const;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const has = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v.trim()) ? (v.trim() as T) : null);

/**
 * A US phone number as typed -> E.164 "+1XXXXXXXXXX", or null. NANP: area code and exchange start with 2–9 and
 * are not N11 service codes (211, 311, 411, 911, ...). Also rejected as not real: every digit the same (or the
 * seven subscriber digits all the same), and any area code or exchange of 555.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  if (/[^\d\s().+\-]/.test(raw)) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  if (d.slice(1, 3) === '11' || d.slice(4, 6) === '11') return null;
  if (/^(\d)\1{9}$/.test(d) || /^(\d)\1{6}$/.test(d.slice(3))) return null;
  if (d.slice(0, 3) === '555' || d.slice(3, 6) === '555') return null;
  return `+1${d}`;
}

export function normalizeEmail(raw: unknown): string | null {
  const e = str(raw).toLowerCase();
  return e && e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

export const PHONE_ERROR = 'Enter a real 10-digit US mobile number, like 305-201-0123.';

const truthy = (v: unknown) => v === true || v === 'on' || v === 'true' || v === 'yes';

/** Raw fields as posted (form or JSON). Unknown keys are ignored. */
export type LeadFields = Record<string, unknown>;

export type LeadField =
  | 'zip'
  | 'state'
  | 'street_address'
  | 'homeowner'
  | 'bill_bucket'
  | 'utility_id'
  | 'shading'
  | 'roof_age'
  | 'battery_interest'
  | 'pay_method'
  | 'timeline'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'consent'
  | 'form';
export type FieldErrors = Partial<Record<LeadField, string>>;

export const STEP_FIELDS = {
  1: ['zip', 'state', 'street_address', 'homeowner', 'bill_bucket', 'utility_id'],
  2: ['shading', 'roof_age', 'battery_interest', 'pay_method', 'timeline'],
  3: ['first_name', 'last_name', 'email', 'phone', 'consent'],
} as const satisfies Record<number, readonly LeadField[]>;
export type LeadStep = keyof typeof STEP_FIELDS;

/** The step a field belongs to (for jumping back to the first step with a server-reported error). */
export function stepOfField(f: LeadField): LeadStep | null {
  for (const s of [1, 2, 3] as const) if ((STEP_FIELDS[s] as readonly LeadField[]).includes(f)) return s;
  return null;
}

/** One displayed range ("10.7 kW" etc.), copied from what the results card showed. */
export type SnapshotValue = { likely: string; low: string; high: string } | { value: string };
export type EstimateSnapshot = Partial<Record<(typeof SNAPSHOT_KEYS)[number], SnapshotValue>>;

/** The insertable lead (user-supplied columns only; consent, status, verification and user agent are the server's). */
export interface LeadInput {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  street_address: string;
  zip: string;
  state: State;
  utility_id: string | null;
  bill_bucket: BillBucket;
  avg_monthly_bill: number | null;
  battery: 0 | 1 | 2 | null;
  battery_interest: BatteryInterest;
  shading: Shade;
  roof_age: RoofAge;
  pay_method: PayMethod;
  homeowner: true;
  timeline: Timeline;
  estimate_snapshot: EstimateSnapshot | null;
  source: string;
  page_path: string | null;
}

export type LeadValidation =
  | { kind: 'honeypot' }
  | { kind: 'disqualified'; reason: 'renter' }
  | { kind: 'invalid'; fieldErrors: FieldErrors }
  | { kind: 'ok'; lead: LeadInput };

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

/** The ZIP's state when it is a 5-digit FL or CA ZIP; the chosen state (if any) must agree. */
function zipAndState(f: LeadFields, errors: FieldErrors): { zip: string; state: State | null } {
  const zip = str(f.zip);
  const chosen = str(f.state).toUpperCase();
  const state = chosen === 'FL' || chosen === 'CA' ? chosen : null;
  const zipState = /^\d{5}$/.test(zip) ? stateByPrefix(zip) : null;
  if (has(f.state) && !state) errors.state = 'Choose Florida or California.';
  if (!/^\d{5}$/.test(zip)) errors.zip = 'Enter a 5-digit ZIP code.';
  else if (!zipState) errors.zip = 'We currently cover Florida and California ZIP codes only.';
  else if (state && zipState !== state) errors.zip = `That ZIP code is in ${STATE_NAMES[zipState]}, not ${STATE_NAMES[state]}.`;
  return { zip, state: errors.zip || errors.state ? null : (state ?? zipState) };
}

export const homeownerOf = (v: unknown): boolean | null => {
  const s = str(v).toLowerCase();
  return v === true || s === 'yes' || s === 'true' ? true : v === false || s === 'no' || s === 'false' ? false : null;
};

export interface HomeStep {
  zip: string;
  state: State;
  street_address: string;
  homeowner: boolean;
  bill_bucket: BillBucket;
  utility_id: string | null;
}

/** Step 1 "Your home". `homeowner: false` is valid here: the caller shows the renter message. */
export function validateHome(f: LeadFields): { errors: FieldErrors; value: HomeStep | null } {
  const errors: FieldErrors = {};
  const { zip, state } = zipAndState(f, errors);

  const street = str(f.street_address).replace(/\s+/g, ' ');
  if (!street) errors.street_address = 'Enter your street address.';
  else if (street.length < 5) errors.street_address = 'Enter your full street address, like 123 Palm Ave.';
  else if (street.length > 200) errors.street_address = 'Use 200 characters or fewer.';

  const homeowner = homeownerOf(f.homeowner);
  if (homeowner === null) errors.homeowner = 'Tell us whether you own this home.';

  const bucket = oneOf(BILL_BUCKETS, f.bill_bucket);
  if (!bucket) errors.bill_bucket = 'Choose your average monthly electric bill.';

  const util = str(f.utility_id);
  if (!util) errors.utility_id = 'Choose your electric utility, or “Other”.';
  else if (util !== OTHER_UTILITY && !(util.length <= 64 && UTILITY_RE.test(util))) errors.utility_id = 'Choose your electric utility, or “Other”.';

  if (Object.keys(errors).length || !state || homeowner === null || !bucket) return { errors, value: null };
  return { errors, value: { zip, state, street_address: street, homeowner, bill_bucket: bucket, utility_id: util === OTHER_UTILITY ? null : util } };
}

export interface ProjectStep {
  shading: Shade;
  roof_age: RoofAge;
  battery_interest: BatteryInterest;
  pay_method: PayMethod;
  timeline: Timeline;
}

/** Step 2 "Your project". */
export function validateProject(f: LeadFields): { errors: FieldErrors; value: ProjectStep | null } {
  const errors: FieldErrors = {};
  const shading = oneOf(SHADES, f.shading);
  const roofAge = oneOf(ROOF_AGES, f.roof_age);
  const battery = oneOf(BATTERY_INTERESTS, f.battery_interest);
  const pay = oneOf(PAY_METHODS, f.pay_method);
  const timeline = oneOf(TIMELINES, f.timeline);
  if (!shading) errors.shading = 'Tell us how much shade your roof gets.';
  if (!roofAge) errors.roof_age = 'Choose your roof’s age.';
  if (!battery) errors.battery_interest = 'Tell us if you want a battery.';
  if (!pay) errors.pay_method = 'Choose how you’d like to pay.';
  if (!timeline) errors.timeline = 'Choose when you’re hoping to go solar.';
  if (Object.keys(errors).length) return { errors, value: null };
  return { errors, value: { shading: shading!, roof_age: roofAge!, battery_interest: battery!, pay_method: pay!, timeline: timeline! } };
}

export interface ContactStep {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

/** Step 3 "Contact". */
export function validateContact(f: LeadFields): { errors: FieldErrors; value: ContactStep | null } {
  const errors: FieldErrors = {};
  const name = (raw: unknown, label: string, key: 'first_name' | 'last_name') => {
    const n = str(raw).replace(/\s+/g, ' ');
    if (!n) errors[key] = `Enter your ${label}.`;
    else if (n.length > 60) errors[key] = 'Use 60 characters or fewer.';
    return n;
  };
  const first = name(f.first_name, 'first name', 'first_name');
  const last = name(f.last_name, 'last name', 'last_name');
  const email = normalizeEmail(f.email);
  if (!email) errors.email = 'Enter a valid email address, like name@example.com.';
  const phone = normalizePhone(f.phone);
  if (!phone) errors.phone = PHONE_ERROR;
  if (!truthy(f.consent)) errors.consent = 'Check the box to agree to be contacted about quotes.';
  if (Object.keys(errors).length) return { errors, value: null };
  return { errors, value: { first_name: first, last_name: last, email: email!, phone: phone! } };
}

export function validateLead(f: LeadFields): LeadValidation {
  if (has(f.website)) return { kind: 'honeypot' };
  // Renters are never sent to buyers and nothing about them is stored (see the privacy policy).
  if (homeownerOf(f.homeowner) === false) return { kind: 'disqualified', reason: 'renter' };

  const home = validateHome(f);
  const project = validateProject(f);
  const contact = validateContact(f);
  const errors: FieldErrors = { ...home.errors, ...project.errors, ...contact.errors };
  if (!home.value || !project.value || !contact.value || Object.keys(errors).length) return { kind: 'invalid', fieldErrors: errors };

  // Optional calculator context (results only). Anything malformed is dropped rather than rejected.
  const billN = typeof f.bill === 'number' ? f.bill : Number(str(f.bill));
  const batteryN = typeof f.battery === 'number' ? f.battery : has(f.battery) ? Number(str(f.battery)) : NaN;
  const source = str(f.source);
  const { homeowner: _homeowner, ...homeRest } = home.value;

  return {
    kind: 'ok',
    lead: {
      ...homeRest,
      ...project.value,
      ...contact.value,
      homeowner: true,
      avg_monthly_bill: has(f.bill) && Number.isFinite(billN) && billN > 0 && billN < 1e6 ? billN : null,
      battery: batteryN === 0 || batteryN === 1 || batteryN === 2 ? batteryN : null,
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
