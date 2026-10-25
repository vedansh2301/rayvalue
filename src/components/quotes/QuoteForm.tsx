/**
 * "Get my free quotes": a 3-step form (Your home, Your project, Contact), then an optional SMS code step.
 * Used inside the calculator results (prefilled with the calculator answers and estimate) and on /quotes.
 *
 * - Validation runs here per step and again, in full, on the server (src/lib/leads/validate.ts).
 * - Renters are not sent to installers and nothing they entered is sent anywhere: they get a friendly message,
 *   community-solar pointers and an optional "email me the estimate" form.
 * - A ZIP no active installer serves is still accepted (status "unserviced") with a clear message.
 * - The consent text next to the submit button is composed from the installers serving the ZIP
 *   (src/lib/leads/consent.ts); the server recomputes it and stores exactly that text.
 *
 * Owner: attorney review of the consent wording before paid traffic.
 */
import type { ComponentChildren, TargetedSubmitEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { State } from '../../data/schemas';
import Icon, { type IconName } from '../icons/Icon';
import { stateByPrefix } from '../../lib/calculator/zip';
import { SUBMIT_LABEL, consentFor, splitAtPrivacyPolicy } from '../../lib/leads/consent';
import { loadTrustedForm, trustedFormEnabled, TRUSTEDFORM_FIELD } from '../../lib/leads/consent-vendor';
import { readAttribution } from '../../lib/attribution';
import { fetchQuoteConfig, fetchServiced, lastFour, type ClientQuoteConfig, type Serviced } from '../../lib/leads/client';
import {
  BATTERY_INTERESTS,
  BATTERY_INTEREST_LABELS,
  BILL_BUCKETS,
  BILL_BUCKET_LABELS,
  OTHER_UTILITY,
  PAY_METHODS,
  PAY_METHOD_LABELS,
  ROOF_AGES,
  ROOF_AGE_LABELS,
  SHADES,
  SHADE_LABELS,
  TIMELINES,
  TIMELINE_LABELS,
  batteryToInterest,
  billToBucket,
} from '../../lib/leads/options';
import { eventSource, saveSummary } from '../../lib/leads/summary';
import type { EstimateSnapshot, FieldErrors, LeadField, LeadStep } from '../../lib/leads/validate';
import { PHONE_ERROR, STEP_FIELDS, normalizePhone, stepOfField, validateContact, validateHome, validateLead, validateProject } from '../../lib/leads/validate';
import { trackEvent } from '../../lib/track';
import { btnPrimary, btnSecondary, btnText } from '../ui/buttons';
import EstimateEmailForm from './EstimateEmailForm';
import OtpStep from './OtpStep';

/** Calculator answers sent along with a lead from the results card. */
export interface QuoteContext {
  utilityId: string | null;
  bill: number | null;
  battery: 0 | 1 | 2 | null;
  shading: 'none' | 'some' | 'heavy' | null;
  snapshot: EstimateSnapshot | null;
}

interface Props {
  /** Unique per page, so field ids never collide. */
  id: string;
  source: string;
  pagePath: string;
  state?: State;
  zip?: string;
  context?: QuoteContext;
  /** /quotes: read state, zip and source from the query string. */
  fromQuery?: boolean;
  /** Move focus to the first field when the form mounts (used when it opens from a button). */
  autoFocus?: boolean;
}

interface Values {
  zip: string;
  street_address: string;
  homeowner: 'yes' | 'no' | '';
  bill_bucket: string;
  utility_id: string;
  shading: string;
  roof_age: string;
  battery_interest: string;
  pay_method: string;
  timeline: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

const EMPTY: Values = {
  zip: '',
  street_address: '',
  homeowner: '',
  bill_bucket: '',
  utility_id: '',
  shading: '',
  roof_age: '',
  battery_interest: '',
  pay_method: '',
  timeline: '',
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
};

const SOURCE_PARAM_RE = /^city:(florida|california)\/[a-z0-9-]+$|^utility:(fpl|duke-energy-florida|teco|pge|sce|sdge)$|^home$/;
const STEPS = ['Your home', 'Your project', 'Contact'] as const;
const FIRST_OPTION: Partial<Record<LeadField, string>> = {
  homeowner: 'yes',
  bill_bucket: BILL_BUCKETS[0],
  shading: SHADES[0],
  roof_age: ROOF_AGES[0],
  battery_interest: BATTERY_INTERESTS[0],
  pay_method: PAY_METHODS[0],
  timeline: TIMELINES[0],
};

const inputCls =
  'mt-1 block min-h-11 w-full rounded-lg border border-stone-400 bg-white px-3 py-2 text-base text-stone-900 aria-[invalid=true]:border-red-700';
const HOMEOWNER_ICONS: Record<'yes' | 'no', IconName> = { yes: 'home', no: 'key' };
const TIMELINE_ICONS: Record<(typeof TIMELINES)[number], IconName> = { asap: 'bolt', '1_3_months': 'calendar', '3_6_months': 'calendar-plus', researching: 'search' };

/** Icon tile: the radio stays in the DOM (keyboard and screen readers) but is visually replaced by the tile's border and fill. */
const tileCls =
  'flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-stone-300 bg-white px-2 py-2 text-center has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50 has-[:checked]:ring-2 has-[:checked]:ring-sun-400 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-stone-900';
const cardCls =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-stone-300 bg-white px-3 py-2 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50';

/** The form's starting values from the calculator context and props (all stay editable). */
function prefill(p: Pick<Props, 'zip' | 'context'>): Partial<Values> {
  const c = p.context;
  const out: Partial<Values> = {};
  if (p.zip) out.zip = p.zip;
  if (c) {
    const bucket = billToBucket(c.bill);
    if (bucket) out.bill_bucket = bucket;
    if (c.utilityId) out.utility_id = c.utilityId === 'unlisted' ? OTHER_UTILITY : c.utilityId;
    if (c.shading) out.shading = c.shading;
    const battery = batteryToInterest(c.battery);
    if (battery) out.battery_interest = battery;
  }
  return out;
}

type Phase = 'form' | 'renter' | 'otp';

export default function QuoteForm(p: Props) {
  const [values, setValues] = useState<Values>(() => ({ ...EMPTY, ...prefill(p) }));
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [declaredState, setDeclaredState] = useState<State | ''>(p.state ?? '');
  const [source, setSource] = useState(p.source);
  const [step, setStep] = useState<LeadStep>(1);
  const [phase, setPhase] = useState<Phase>('form');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [svc, setSvc] = useState<(Serviced & { zip: string }) | null>(null);
  const [svcLoading, setSvcLoading] = useState(false);
  const [config, setConfig] = useState<ClientQuoteConfig | null>(null);
  const [otp, setOtp] = useState<{ leadId: string; token: string; done: Summary } | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const touched = useRef(new Set<keyof Values>());
  const started = useRef(false);
  const focusNext = useRef<'heading' | LeadField | null>(p.autoFocus ? 'heading' : null);
  const fid = (f: string) => `${p.id}-${f}`;

  const zipOk = /^\d{5}$/.test(values.zip);
  const zipState = zipOk ? stateByPrefix(values.zip) : null;
  const state: State | null = zipState ?? (declaredState || null);

  const set = <K extends keyof Values>(k: K, v: Values[K]) => {
    touched.current.add(k);
    setValues((cur) => ({ ...cur, [k]: v }));
    if (errors[k as LeadField]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  // /quotes?state=&zip=&source= (read in the browser; the page is static).
  useEffect(() => {
    if (!p.fromQuery) return;
    const q = new URLSearchParams(window.location.search);
    const s = (q.get('state') ?? '').toUpperCase();
    if (s === 'FL' || s === 'CA') setDeclaredState(s);
    const z = q.get('zip') ?? '';
    if (/^\d{5}$/.test(z) && !touched.current.has('zip')) setValues((v) => ({ ...v, zip: z }));
    const src = q.get('source') ?? '';
    if (SOURCE_PARAM_RE.test(src)) setSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the calculator re-runs with other answers, refresh the prefilled fields the person has not edited.
  const prefillKey = JSON.stringify(prefill(p));
  useEffect(() => {
    const next = prefill(p);
    setValues((cur) => {
      const merged = { ...cur };
      for (const [k, v] of Object.entries(next) as [keyof Values, string][]) if (!touched.current.has(k)) (merged as Record<string, string>)[k] = v;
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey]);

  // Utility dropdown options for the state.
  useEffect(() => {
    if (!state) return;
    let live = true;
    void fetchQuoteConfig(state).then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, [state]);

  // Focus after a step/phase change.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (!target) return;
    if (target === 'heading') headingRef.current?.focus();
    else document.getElementById(fid(FIRST_OPTION[target] ? `${target}-${FIRST_OPTION[target]}` : target))?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, phase]);

  // On step 3, look up the installers again so the consent text is current.
  useEffect(() => {
    if (step !== 3 || phase !== 'form' || !zipOk) return;
    let live = true;
    setSvcLoading(true);
    void fetchServiced(values.zip).then((r) => {
      if (!live) return;
      setSvcLoading(false);
      if (r) setSvc({ ...r, zip: values.zip });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, phase]);

  const installers = svc && svc.zip === values.zip ? svc.installers : [];
  const unserviced = svc !== null && svc.zip === values.zip && !svc.serviced;

  /** quote_form_start: once per page view, on the first focus inside the form (no field values). Also loads the optional consent vendor. */
  function onFirstFocus() {
    if (started.current) return;
    started.current = true;
    trackEvent('quote_form_start', { source: eventSource(source), state: state ?? '' });
    if (trustedFormEnabled(import.meta.env.PUBLIC_TRUSTEDFORM_ENABLED)) loadTrustedForm();
  }

  const fieldsFor = (): Record<string, unknown> => ({
    ...values,
    state: declaredState || (state ?? ''),
    consent: consent ? 'on' : '',
    website: hp,
    source,
    page_path: p.pagePath,
    ...(p.context
      ? {
          bill: p.context.bill === null ? '' : String(p.context.bill),
          battery: p.context.battery === null ? '' : String(p.context.battery),
          estimate_snapshot: p.context.snapshot ? JSON.stringify(p.context.snapshot) : '',
        }
      : {}),
  });

  function showErrors(e: FieldErrors, from: LeadStep) {
    setErrors(e);
    const bad = (STEP_FIELDS[from] as readonly LeadField[]).find((f) => e[f]);
    if (bad) requestAnimationFrame(() => document.getElementById(fid(FIRST_OPTION[bad] ? `${bad}-${FIRST_OPTION[bad]}` : bad))?.focus());
  }

  async function next1() {
    if (values.homeowner === 'no') {
      focusNext.current = 'heading';
      setPhase('renter');
      return;
    }
    const v = validateHome(fieldsFor());
    if (!v.value) return showErrors(v.errors, 1);
    setErrors({});
    setNotice('');
    setSvcLoading(true);
    const r = await fetchServiced(values.zip);
    setSvcLoading(false);
    if (r) setSvc({ ...r, zip: values.zip });
    focusNext.current = 'heading';
    setStep(2);
  }

  function next2() {
    const v = validateProject(fieldsFor());
    if (!v.value) return showErrors(v.errors, 2);
    setErrors({});
    focusNext.current = 'heading';
    setStep(3);
  }

  function back() {
    setErrors({});
    focusNext.current = 'heading';
    setStep((s) => (s > 1 ? ((s - 1) as LeadStep) : s));
  }

  function onPhoneBlur() {
    if (!values.phone.trim()) return;
    setErrors((e) => ({ ...e, phone: normalizePhone(values.phone) ? undefined : PHONE_ERROR }));
  }

  async function submit() {
    if (sending) return;
    const f = fieldsFor();
    const c = validateContact(f);
    if (!c.value) return showErrors(c.errors, 3);
    const v = validateLead({ ...f, homeowner: 'yes' });
    if (v.kind === 'invalid') {
      // Should not happen after steps 1-2, but a ZIP/state edit could: go back to the earliest step with an error.
      const first = (Object.keys(v.fieldErrors) as LeadField[]).map((k) => stepOfField(k)).filter((s): s is LeadStep => s !== null).sort()[0] ?? 3;
      setStep(first);
      return showErrors(v.fieldErrors, first);
    }
    setErrors({});
    setFormError('');
    setNotice('');
    setSending(true);
    const cert = (formRef.current?.elements.namedItem(TRUSTEDFORM_FIELD) as HTMLInputElement | null)?.value ?? '';
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...f, attribution: readAttribution(), consent_installers: installers, page_url: `${window.location.origin}${window.location.pathname}`, [TRUSTEDFORM_FIELD]: cert }),
      });
      const body = (await res.json().catch(() => null)) as ApiReply | null;
      setSending(false);
      if (res.ok && body?.ok) {
        if (body.disqualified === 'renter') {
          focusNext.current = 'heading';
          return setPhase('renter');
        }
        const summary: Summary = {
          firstName: c.value.first_name,
          installers: body.installers ?? [],
          serviced: body.serviced === true,
          status: body.status ?? 'new',
          phoneVerified: false,
          state: state ?? 'FL',
          source: eventSource(source),
          tracked: false,
        };
        if (body.verify?.token && body.lead_id) {
          focusNext.current = 'heading';
          setOtp({ leadId: body.lead_id, token: body.verify.token, done: summary });
          return setPhase('otp');
        }
        return finish(summary);
      }
      if (res.status === 409 && body?.consent_changed) {
        // The installers serving this ZIP changed since the wording was shown: show the new wording, ask again.
        setSvc({ zip: values.zip, installers: body.installers ?? [], serviced: (body.installers ?? []).length > 0 });
        setConsent(false);
        setNotice('The installers serving your ZIP code just changed. Please read the updated wording and check the box again.');
        return;
      }
      if (res.status === 400 && body?.fieldErrors && Object.keys(body.fieldErrors).some((k) => k !== 'form')) {
        const keys = Object.keys(body.fieldErrors) as LeadField[];
        const first = keys.map((k) => stepOfField(k)).filter((s): s is LeadStep => s !== null).sort()[0] ?? 3;
        setStep(first);
        return showErrors(body.fieldErrors, first);
      }
      setFormError('Something went wrong — please try again.');
    } catch {
      setSending(false);
      setFormError('Something went wrong — please try again.');
    }
  }

  function finish(summary: Summary, verified = false) {
    saveSummary({ ...summary, phoneVerified: verified });
    window.location.assign('/quotes/thank-you');
  }

  function onSubmit(e: TargetedSubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step === 1) void next1();
    else if (step === 2) next2();
    else void submit();
  }

  // ---------------------------------------------------------------- phases
  if (phase === 'renter') {
    return (
      <div class="space-y-4">
        <h3 ref={headingRef} tabIndex={-1} class="text-xl font-bold tracking-tight text-stone-900 focus:outline-none">
          Thanks for being upfront
        </h3>
        <p class="leading-7 text-stone-700">
          Installers need the property owner&rsquo;s okay to put solar on a roof, so we don&rsquo;t send renters&rsquo; details to installers.
          Nothing you entered here was sent to us or saved.
        </p>
        <p class="leading-7 text-stone-700">
          If you rent, <strong>community solar</strong> may be an option: you subscribe to part of a shared solar project instead of putting panels on your roof.
          Whether it is available depends on your state and utility, so check your utility&rsquo;s website or your state energy office for what exists at your address.
        </p>
        <div class="rounded-lg border border-stone-200 bg-white p-4">
          <h4 class="font-semibold text-stone-900">Want the numbers anyway?</h4>
          <p class="mb-3 mt-1 text-sm text-stone-700">We can email you a copy of your estimate and occasional updates, no phone number needed.</p>
          <EstimateEmailForm id={fid('renter')} state={state} snapshot={p.context?.snapshot ?? null} source="renter" />
        </div>
        <button type="button" class={btnText} onClick={() => { setValues((v) => ({ ...v, homeowner: 'yes' })); setPhase('form'); }}>
          I own this home &mdash; go back
        </button>
      </div>
    );
  }

  if (phase === 'otp' && otp) {
    return (
      <OtpStep
        id={fid('otp')}
        leadId={otp.leadId}
        token={otp.token}
        lastFour={lastFour(values.phone)}
        onDone={(verified) => {
          if (verified) trackEvent('phone_verified', { source: eventSource(source), state: state ?? '' });
          finish(otp.done, verified);
        }}
      />
    );
  }

  const err = (f: LeadField) =>
    errors[f] ? (
      <p id={fid(`${f}-error`)} role="alert" class="mt-1 text-sm font-medium text-red-800">
        {errors[f]}
      </p>
    ) : null;
  const aria = (f: LeadField) => ({ 'aria-invalid': errors[f] ? ('true' as const) : ('false' as const), 'aria-describedby': errors[f] ? fid(`${f}-error`) : undefined });
  const consentText = consentFor(installers);
  const consentParts = splitAtPrivacyPolicy(consentText.text);
  const utilities = config?.utilities ?? [];

  return (
    <form ref={formRef} method="post" action="/api/leads" noValidate onSubmit={onSubmit} onFocusIn={onFirstFocus} class="space-y-5">
      <ol class="flex gap-2" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i + 1 === step ? 'step' : undefined}
            class={`flex-1 border-t-4 pt-2 text-xs font-medium sm:text-sm ${i + 1 <= step ? 'border-sun-400 text-stone-900' : 'border-stone-200 text-stone-600'}`}
          >
            <span class="sr-only">Step </span>
            {i + 1}
            <span class="sr-only"> of 3:</span> {label}
          </li>
        ))}
      </ol>

      <h3 ref={headingRef} tabIndex={-1} class="text-xl font-bold tracking-tight text-stone-900 focus:outline-none">
        {step === 1 ? 'Tell us about your home' : step === 2 ? 'Tell us about your project' : 'Where should installers reach you?'}
      </h3>

      {step > 1 && unserviced && (
        <p role="status" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-stone-900">
          We don&rsquo;t have installers near you yet &mdash; we&rsquo;ll email you when we do. You can still send your details below.
        </p>
      )}

      <fieldset disabled={sending} class="min-w-0 space-y-5">
        {/* Honeypot: hidden from people and assistive tech; bots fill it in. */}
        <div class="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
          <label for={fid('website')}>Leave this field empty</label>
          <input id={fid('website')} name="website" type="text" tabIndex={-1} autoComplete="off" value={hp} onInput={(e) => setHp(e.currentTarget.value)} />
        </div>

        {step === 1 && (
          <>
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label for={fid('zip')} class="block font-medium text-stone-900">
                  ZIP code
                </label>
                <input
                  id={fid('zip')}
                  name="zip"
                  type="text"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={5}
                  value={values.zip}
                  onInput={(e) => set('zip', e.currentTarget.value)}
                  class={`${inputCls} max-w-40`}
                  {...aria('zip')}
                />
                {err('zip')}
              </div>
              <div>
                <label for={fid('street_address')} class="block font-medium text-stone-900">
                  Street address
                </label>
                <input
                  id={fid('street_address')}
                  name="street_address"
                  type="text"
                  autoComplete="street-address"
                  maxLength={200}
                  value={values.street_address}
                  onInput={(e) => set('street_address', e.currentTarget.value)}
                  class={inputCls}
                  {...aria('street_address')}
                />
                {err('street_address')}
              </div>
            </div>

            <ChoiceGroup id={fid('')} name="homeowner" legend="Do you own this home?" options={['yes', 'no'] as const} labels={{ yes: 'Yes', no: 'No' }} icons={HOMEOWNER_ICONS} value={values.homeowner} onChange={(v) => set('homeowner', v)} error={err('homeowner')} errorId={errors.homeowner ? fid('homeowner-error') : undefined} cols="grid-cols-2 sm:max-w-sm" />

            <ChoiceGroup id={fid('')} name="bill_bucket" legend="Average monthly electric bill" options={BILL_BUCKETS} labels={BILL_BUCKET_LABELS} value={values.bill_bucket} onChange={(v) => set('bill_bucket', v)} error={err('bill_bucket')} errorId={errors.bill_bucket ? fid('bill_bucket-error') : undefined} cols="grid-cols-2 sm:grid-cols-3" />

            <div>
              <label for={fid('utility_id')} class="block font-medium text-stone-900">
                Electric utility
              </label>
              <select id={fid('utility_id')} name="utility_id" value={values.utility_id} onChange={(e) => set('utility_id', e.currentTarget.value)} class={`${inputCls} max-w-sm`} {...aria('utility_id')}>
                <option value="">{state ? 'Choose your utility' : 'Enter your ZIP code first'}</option>
                {utilities.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
                {state && <option value={OTHER_UTILITY}>Other / not sure</option>}
              </select>
              {err('utility_id')}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <ChoiceGroup id={fid('')} name="shading" legend="How much shade does your roof get?" options={SHADES} labels={SHADE_LABELS} value={values.shading} onChange={(v) => set('shading', v)} error={err('shading')} errorId={errors.shading ? fid('shading-error') : undefined} cols="grid-cols-2 sm:grid-cols-4" />
            <ChoiceGroup id={fid('')} name="roof_age" legend="How old is your roof?" options={ROOF_AGES} labels={ROOF_AGE_LABELS} value={values.roof_age} onChange={(v) => set('roof_age', v)} error={err('roof_age')} errorId={errors.roof_age ? fid('roof_age-error') : undefined} cols="grid-cols-2 sm:grid-cols-4" />
            <ChoiceGroup id={fid('')} name="battery_interest" legend="Do you want a battery?" options={BATTERY_INTERESTS} labels={BATTERY_INTEREST_LABELS} value={values.battery_interest} onChange={(v) => set('battery_interest', v)} error={err('battery_interest')} errorId={errors.battery_interest ? fid('battery_interest-error') : undefined} cols="grid-cols-3 sm:max-w-md" />
            <ChoiceGroup id={fid('')} name="pay_method" legend="How would you like to pay?" options={PAY_METHODS} labels={PAY_METHOD_LABELS} value={values.pay_method} onChange={(v) => set('pay_method', v)} error={err('pay_method')} errorId={errors.pay_method ? fid('pay_method-error') : undefined} cols="grid-cols-2 sm:grid-cols-4" />
            <ChoiceGroup id={fid('')} name="timeline" legend="When are you hoping to go solar?" options={TIMELINES} labels={TIMELINE_LABELS} icons={TIMELINE_ICONS} value={values.timeline} onChange={(v) => set('timeline', v)} error={err('timeline')} errorId={errors.timeline ? fid('timeline-error') : undefined} cols="grid-cols-2 sm:grid-cols-4" />
          </>
        )}

        {step === 3 && (
          <>
            <div class="grid gap-4 sm:grid-cols-2">
              <TextField id={fid('first_name')} name="first_name" label="First name" auto="given-name" max={60} value={values.first_name} onInput={(v) => set('first_name', v)} error={err('first_name')} aria={aria('first_name')} />
              <TextField id={fid('last_name')} name="last_name" label="Last name" auto="family-name" max={60} value={values.last_name} onInput={(v) => set('last_name', v)} error={err('last_name')} aria={aria('last_name')} />
              <TextField id={fid('email')} name="email" label="Email" type="email" auto="email" max={254} value={values.email} onInput={(v) => set('email', v)} error={err('email')} aria={aria('email')} />
              <TextField id={fid('phone')} name="phone" label="Mobile phone" type="tel" auto="tel" inputMode="tel" max={40} value={values.phone} onInput={(v) => set('phone', v)} onBlur={onPhoneBlur} error={err('phone')} aria={aria('phone')} />
            </div>

            {installers.length > 0 && (
              <div class="rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800">
                <p class="font-medium text-stone-900">Installers serving {values.zip}:</p>
                <ul class="mt-1 list-disc pl-5">
                  {installers.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* ATTORNEY REVIEW REQUIRED: consent wording (src/lib/leads/consent.ts). Shown exactly as it will be stored. */}
            <div>
              <label for={fid('consent')} class="flex max-w-[60ch] cursor-pointer items-start gap-3 text-sm leading-6 text-stone-700">
                <input
                  id={fid('consent')}
                  name="consent"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.currentTarget.checked);
                    if (e.currentTarget.checked) setErrors((x) => ({ ...x, consent: undefined }));
                  }}
                  class="mt-0.5 h-5 w-5 shrink-0 accent-amber-600"
                  {...aria('consent')}
                />
                <span>
                  {consentParts ? (
                    <>
                      {consentParts[0]}
                      <a href="/privacy" class="text-sun-ink underline underline-offset-2 hover:text-stone-900">
                        Privacy Policy
                      </a>
                      {consentParts[1]}
                    </>
                  ) : (
                    consentText.text
                  )}
                </span>
              </label>
              {err('consent')}
            </div>
            {notice && (
              <p role="alert" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 font-medium text-stone-900">
                {notice}
              </p>
            )}
          </>
        )}
      </fieldset>

      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-3">
          {step > 1 && (
            <button type="button" class={btnSecondary} onClick={back} disabled={sending}>
              Back
            </button>
          )}
          <button type="submit" class={btnPrimary} disabled={sending || svcLoading}>
            {step === 3 ? (sending ? 'Sending…' : SUBMIT_LABEL) : svcLoading ? 'Checking…' : 'Continue'}
          </button>
        </div>
        {step === 3 && (
          <p class="text-sm text-stone-600">
            {installers.length > 0
              ? 'Free and no obligation. We only share your details with the installers named above.'
              : "Free and no obligation. We won't share your details until an installer serves your area."}
          </p>
        )}
        {formError && (
          <p role="alert" class="font-medium text-red-800">
            {formError}
          </p>
        )}
      </div>
    </form>
  );
}

interface Summary {
  firstName: string;
  installers: string[];
  serviced: boolean;
  status: 'new' | 'unserviced' | 'nurture';
  phoneVerified: boolean;
  state: 'FL' | 'CA';
  source: string;
  tracked: boolean;
}

interface ApiReply {
  ok?: boolean;
  disqualified?: 'renter';
  status?: 'new' | 'unserviced' | 'nurture';
  serviced?: boolean;
  installers?: string[];
  lead_id?: string;
  verify?: { token: string } | null;
  consent_changed?: boolean;
  fieldErrors?: FieldErrors;
}

function TextField(p: {
  id: string;
  name: string;
  label: string;
  value: string;
  onInput: (v: string) => void;
  onBlur?: () => void;
  type?: 'text' | 'email' | 'tel';
  auto: string;
  inputMode?: 'tel';
  max: number;
  error: ComponentChildren;
  aria: { 'aria-invalid': 'true' | 'false'; 'aria-describedby': string | undefined };
}) {
  return (
    <div>
      <label for={p.id} class="block font-medium text-stone-900">
        {p.label}
      </label>
      <input id={p.id} name={p.name} type={(p.type ?? 'text') as 'text'} autoComplete={p.auto} inputMode={p.inputMode} maxLength={p.max} value={p.value} onInput={(e) => p.onInput(e.currentTarget.value)} onBlur={p.onBlur} class={inputCls} {...p.aria} />
      {p.error}
    </div>
  );
}

function ChoiceGroup<V extends string>(p: {
  id: string;
  name: string;
  legend: string;
  options: readonly V[];
  labels: Record<V, string>;
  /** Optional decorative icon per option (the text label always carries the meaning). */
  icons?: Partial<Record<V, IconName>>;
  value: string;
  onChange: (v: V) => void;
  error: ComponentChildren;
  errorId?: string;
  cols: string;
}) {
  return (
    <fieldset aria-describedby={p.errorId}>
      <legend class="font-medium text-stone-900">{p.legend}</legend>
      <div class={`mt-2 grid gap-2 ${p.cols}`}>
        {p.options.map((o) => (
          <label key={o} for={`${p.id}${p.name}-${o}`} class={p.icons?.[o] ? tileCls : cardCls}>
            <input id={`${p.id}${p.name}-${o}`} type="radio" name={p.name} value={o} checked={p.value === o} onChange={() => p.onChange(o)} class={p.icons?.[o] ? 'sr-only' : 'h-5 w-5 shrink-0 accent-amber-600'} />
            {p.icons?.[o] && <Icon name={p.icons[o]!} class="text-stone-900" />}
            <span class="text-sm font-medium text-stone-900 sm:text-base">{p.labels[o]}</span>
          </label>
        ))}
      </div>
      {p.error}
    </fieldset>
  );
}
