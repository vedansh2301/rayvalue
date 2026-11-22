/**
 * "Email me this estimate" (calculator results) and "Deadline alerts for your country" (blog index): an email field, a
 * consent checkbox, and one POST to /api/subscribe (double opt-in; the server emails a confirmation link). No installer
 * quotes are offered or implied. Texts come from src/lib/i18n/signup.ts (English and German). The UI does no maths: the
 * calculator answers it forwards are plain inputs, never computed figures.
 */
import type { TargetedSubmitEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { SIGNUP_COUNTRIES, signupLocale, signupText, type SignupCountry, type SignupTopic } from '../../lib/i18n/signup';
import { submitSignup } from '../../lib/subscribe/client';
import { btnPrimary } from '../ui/buttons';

interface Props {
  /** Unique id prefix for the fields. */
  id: string;
  /** BCP47 tag of the page; German texts for de*. */
  lang: string;
  /** 'estimate': report email for a calculator result; 'alerts': deadline alerts with a country select. */
  mode: 'estimate' | 'alerts';
  /** Country of the calculator (estimate) or the pre-selected country (alerts; '' = none). */
  country: SignupCountry | '';
  source: string;
  region?: string;
  /** Calculator answers behind the reopen link. */
  params?: Record<string, string>;
  /** Display names for the country select (alerts mode), in the page language. */
  countryNames?: Partial<Record<SignupCountry, string>>;
}

type Status = 'idle' | 'sending' | 'done';
type Errors = { email?: string; consent?: string; country?: string; form?: string };

const field = 'mt-1 block min-h-11 w-full rounded-lg border border-sky-pastel-400 bg-white px-3 py-2 text-base text-stone-900 aria-[invalid=true]:border-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900';

export default function EmailSignup(p: Props) {
  const t = signupText(p.lang);
  const locale = signupLocale(p.lang);
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState<SignupCountry | ''>(p.country);
  const [consent, setConsent] = useState(false);
  const [alsoAlerts, setAlsoAlerts] = useState(false);
  const [hp, setHp] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>('idle');
  const emailRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const alertsMode = p.mode === 'alerts';

  useEffect(() => {
    if (status === 'done') doneRef.current?.focus();
  }, [status]);

  const topics: SignupTopic[] = alertsMode ? ['deadline_alerts'] : alsoAlerts ? ['report', 'deadline_alerts'] : ['report'];
  const consentParts = country ? t.consent(country, topics.length === 2 ? ['report'] : topics) : null;

  async function onSubmit(e: TargetedSubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'sending') return;
    const next: Errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = t.errors.email;
    if (!country) next.country = t.errors.country;
    if (!consent) next.consent = t.errors.consent;
    setErrors(next);
    if (next.country) return void document.getElementById(`${p.id}-country`)?.focus();
    if (next.email) return void emailRef.current?.focus();
    if (next.consent) return void document.getElementById(`${p.id}-consent`)?.focus();
    if (!country) return;
    setStatus('sending');
    const res = await submitSignup({ email: email.trim(), country, region: p.region, topics, source: p.source, locale, params: alertsMode ? undefined : p.params, website: hp });
    if (res.ok) return setStatus('done');
    setStatus('idle');
    setErrors({ form: res.kind === 'rate' ? t.errors.tooMany : res.kind === 'invalid' && res.field === 'email' ? t.errors.email : t.errors.generic });
  }

  if (status === 'done') {
    return (
      <p ref={doneRef} tabIndex={-1} role="status" class="font-semibold text-stone-900 focus:outline-none">
        <span aria-hidden="true">☀️ </span>
        {t.done.confirm}
      </p>
    );
  }

  const sending = status === 'sending';
  const err = (id: string, msg?: string) => (msg ? <p id={id} role="alert" class="mt-1 text-sm font-medium text-red-800">{msg}</p> : null);
  return (
    <form onSubmit={onSubmit} noValidate class="space-y-3">
      <fieldset disabled={sending} class="min-w-0 space-y-3 border-0 p-0">
        <div class="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
          <label for={`${p.id}-website`}>Leave this field empty</label>
          <input id={`${p.id}-website`} type="text" tabIndex={-1} autoComplete="off" value={hp} onInput={(e) => setHp(e.currentTarget.value)} />
        </div>
        <div class="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          {alertsMode && (
            <div>
              <label for={`${p.id}-country`} class="block text-sm font-semibold text-stone-900">{t.blog.countryLabel}</label>
              <select id={`${p.id}-country`} value={country} onChange={(e) => setCountry(e.currentTarget.value as SignupCountry | '')} aria-invalid={errors.country ? 'true' : 'false'} aria-describedby={errors.country ? `${p.id}-country-error` : undefined} class={field}>
                <option value="">{t.errors.country}</option>
                {SIGNUP_COUNTRIES.map((c) => <option key={c} value={c}>{p.countryNames?.[c] ?? c}</option>)}
              </select>
              {err(`${p.id}-country-error`, errors.country)}
            </div>
          )}
          <div class={alertsMode ? '' : 'sm:col-span-2'}>
            <label for={`${p.id}-email`} class="block text-sm font-semibold text-stone-900">{t.emailLabel}</label>
            <input ref={emailRef} id={`${p.id}-email`} type="email" autoComplete="email" inputMode="email" maxLength={254} placeholder={t.emailPlaceholder} value={email} onInput={(e) => setEmail(e.currentTarget.value)} aria-invalid={errors.email ? 'true' : 'false'} aria-describedby={errors.email ? `${p.id}-email-error` : undefined} class={field} />
            {err(`${p.id}-email-error`, errors.email)}
          </div>
        </div>
        <div>
          <label for={`${p.id}-consent`} class="flex cursor-pointer items-start gap-3 text-sm leading-6 text-stone-800">
            <input id={`${p.id}-consent`} type="checkbox" checked={consent} onChange={(e) => setConsent(e.currentTarget.checked)} aria-invalid={errors.consent ? 'true' : 'false'} aria-describedby={errors.consent ? `${p.id}-consent-error` : undefined} class="mt-0.5 size-5 shrink-0 accent-amber-600" />
            <span>
              {consentParts ? (
                <>
                  {consentParts.before}
                  <a href="/privacy" class="text-sun-ink underline underline-offset-2 hover:text-stone-900">{consentParts.link}</a>
                  {consentParts.after}
                </>
              ) : (
                t.errors.country
              )}
            </span>
          </label>
          {err(`${p.id}-consent-error`, errors.consent)}
        </div>
        {!alertsMode && country && (
          <label for={`${p.id}-alerts`} class="flex cursor-pointer items-start gap-3 text-sm leading-6 text-stone-800">
            <input id={`${p.id}-alerts`} type="checkbox" checked={alsoAlerts} onChange={(e) => setAlsoAlerts(e.currentTarget.checked)} class="mt-0.5 size-5 shrink-0 accent-amber-600" />
            <span>{t.alertsAlsoLabel(country)}</span>
          </label>
        )}
      </fieldset>
      <p class="text-xs leading-5 text-stone-700">{t.confirmNote}</p>
      <button type="submit" class={btnPrimary} disabled={sending}>{sending ? t.buttons.sending : alertsMode ? t.buttons.alerts : t.buttons.report}</button>
      {err(`${p.id}-form-error`, errors.form)}
    </form>
  );
}
