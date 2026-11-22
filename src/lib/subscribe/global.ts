/**
 * Validation for the global email sign-up (pure; shared by the API route and the forms). Allow-lists only: the country,
 * the region shape, the topics and the calculator parameters behind a "reopen my estimate" link. It never computes or
 * accepts figures. Endpoint: src/pages/api/subscribe.ts via src/lib/server/global-subscribe.ts.
 */
import { countryCalculator } from '../content/country-calc';
import { SIGNUP_COUNTRIES, SIGNUP_TOPICS, signupLocale, type SignupCountry, type SignupLocale, type SignupTopic } from '../i18n/signup';
import { EMAIL_RE } from '../leads/validate';

export const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const;

/** Region ids look like the calculators' own ids ("gb-cap-london", "de-hamburg", "au-ausgrid"): country prefix plus a slug. US uses the state code. */
const REGION_PREFIX: Record<Exclude<SignupCountry, 'US'>, string> = { GB: 'gb-', DE: 'de-', AU: 'au-' };
const REGION_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Calculator query parameters that may be carried into an email link (the ones the calculators read to prefill). */
export const REPORT_PARAM_KEYS = ['region', 'bill', 'kwh', 'battery', 'roof', 'shade', 'install', 'offer'] as const;
const PARAM_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9/_.:-]{0,79}$/;
export const MAX_BODY_BYTES = 4096;

export interface GlobalSignupFields {
  email?: unknown;
  country?: unknown;
  region?: unknown;
  topics?: unknown;
  consent?: unknown;
  source?: unknown;
  locale?: unknown;
  payload?: unknown;
  website?: unknown;
}

export interface GlobalSignup {
  email: string;
  country: SignupCountry;
  region: string | null;
  topics: SignupTopic[];
  locale: SignupLocale;
  source: string | null;
  /** Allow-listed calculator parameters for the reopen link (only when the report topic is requested), else null. */
  params: Record<string, string> | null;
}

export type GlobalValidation =
  | { kind: 'honeypot' }
  | { kind: 'invalid'; field: 'email' | 'country' | 'region' | 'topics' | 'consent' | 'source' | 'payload'; error: string }
  | { kind: 'ok'; value: GlobalSignup };

const truthy = (v: unknown) => v === true || v === 'on' || v === 'true' || v === 'yes';
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function normalizeCountry(raw: unknown): SignupCountry | null {
  const c = str(raw).toUpperCase();
  const code = c === 'UK' ? 'GB' : c;
  return (SIGNUP_COUNTRIES as readonly string[]).includes(code) ? (code as SignupCountry) : null;
}

/** True when `region` is a plausible region for the country (US: a state code; others: the calculator's id with its country prefix). */
export function isValidRegion(country: SignupCountry, region: string): boolean {
  if (country === 'US') return (US_STATE_CODES as readonly string[]).includes(region);
  return region.length <= 64 && region.startsWith(REGION_PREFIX[country]) && REGION_SLUG_RE.test(region) && region.length > REGION_PREFIX[country].length;
}

/** Topics from an array or a comma-separated string; null when empty, unknown or duplicated entries make no sense. */
export function parseTopics(raw: unknown): SignupTopic[] | null {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null;
  if (!list || list.length === 0 || list.length > SIGNUP_TOPICS.length) return null;
  const out: SignupTopic[] = [];
  for (const t of list) {
    const topic = str(t);
    if (!(SIGNUP_TOPICS as readonly string[]).includes(topic)) return null;
    if (!out.includes(topic as SignupTopic)) out.push(topic as SignupTopic);
  }
  return out.length > 0 ? out : null;
}

/** Calculator answers for the reopen link: `{ params: { region, bill, ... } }`. Unknown keys or odd values reject the whole payload. */
export function parsePayload(raw: unknown): Record<string, string> | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid';
  const params = (raw as { params?: unknown }).params;
  if (params === undefined) return null;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return 'invalid';
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (!(REPORT_PARAM_KEYS as readonly string[]).includes(k)) return 'invalid';
    const val = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
    if (!PARAM_VALUE_RE.test(val)) return 'invalid';
    out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function validateGlobalSignup(f: GlobalSignupFields): GlobalValidation {
  if (typeof f.website === 'string' && f.website.trim() !== '') return { kind: 'honeypot' };
  const email = str(f.email).toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { kind: 'invalid', field: 'email', error: 'Please enter a valid email address.' };
  const country = normalizeCountry(f.country);
  if (!country) return { kind: 'invalid', field: 'country', error: 'Country must be one of US, GB, DE or AU.' };
  let region: string | null = null;
  if (f.region !== undefined && f.region !== null && str(f.region) !== '') {
    const r = country === 'US' ? str(f.region).toUpperCase() : str(f.region).toLowerCase();
    if (!isValidRegion(country, r)) return { kind: 'invalid', field: 'region', error: 'That region is not valid for the country.' };
    region = r;
  }
  const topics = parseTopics(f.topics);
  if (!topics) return { kind: 'invalid', field: 'topics', error: 'Choose what to receive: report, deadline_alerts, or both.' };
  if (!truthy(f.consent)) return { kind: 'invalid', field: 'consent', error: 'Consent is required.' };
  let source: string | null = null;
  if (f.source !== undefined && f.source !== null && str(f.source) !== '') {
    source = str(f.source);
    if (!SOURCE_RE.test(source)) return { kind: 'invalid', field: 'source', error: 'Invalid source.' };
  }
  const payload = parsePayload(f.payload);
  if (payload === 'invalid') return { kind: 'invalid', field: 'payload', error: 'Invalid report parameters.' };
  const rawLocale = str(f.locale).toLowerCase();
  const locale: SignupLocale = rawLocale === 'de' || rawLocale === 'en' ? rawLocale : signupLocale(country === 'DE' ? 'de' : 'en');
  return { kind: 'ok', value: { email, country, region, topics, locale, source, params: topics.includes('report') ? payload : null } };
}

/**
 * Calculator URL that reopens a person's estimate: the country's calculator with the allow-listed answers in the query string
 * (the calculators prefill from them). No figures. Countries without a calculator (US outside FL/CA) link to their guides.
 */
export function reportUrl(siteUrl: string, country: SignupCountry, params: Record<string, string> | null): string {
  const site = siteUrl.replace(/\/+$/, '');
  const calc = countryCalculator(country);
  if (!calc) return `${site}/us`;
  const q = new URLSearchParams();
  for (const k of REPORT_PARAM_KEYS) {
    const v = params?.[k];
    if (v !== undefined) q.set(k, v);
  }
  const qs = q.toString();
  return `${site}${calc.href}${qs ? `?${qs}` : ''}`;
}
