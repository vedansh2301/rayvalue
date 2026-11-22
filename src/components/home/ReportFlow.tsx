/**
 * "Your free payback report": the home page's 3-step flow (design: RayValue Home v2).
 * Step 1 country + what you are deciding on, step 2 bill / ownership / timing, step 3 a hand-off. The last button is real:
 * - US homes: opens /quotes with the answers as query params (the existing quote form reads them and keeps its own
 *   consent wording, validation and signed-token lead flow). Only a ZIP code is asked here; nothing is sent from this card.
 * - US ZIPs outside Florida and California, the UK, Germany and Australia: no installer partners, so no quotes are promised.
 *   An optional email + consent box offers "my payback report + deadline alerts" (double opt-in through /api/subscribe); the
 *   button still opens the country's calculator (the US guides for a US ZIP outside FL/CA), after the email is submitted.
 * - Every other country: no personal data is collected. The button opens that country's calculator prefilled with the bill
 *   and battery choice, or its guides where there is no calculator.
 * Answers live in component state only. The UI does no calculator math: the numbers come from the calculator it opens.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { stateByPrefix } from '../../lib/calculator/zip';
import { signupText, type SignupCountry } from '../../lib/i18n/signup';
import { submitSignup } from '../../lib/subscribe/client';

/** Home-flow country code (URL segment) to the sign-up country; only these collect an email. */
const SIGNUP_BY_SEGMENT: Record<string, SignupCountry> = { us: 'US', uk: 'GB', de: 'DE', au: 'AU' };

export interface FlowCountry { code: string; name: string; href: string; kind: 'calc' | 'hub' }
export interface FlowOutline { w: number; h: number; d: string }
interface Props {
  countries: FlowCountry[];
  /** [segment, short label] of the six one-tap countries, in design order. */
  quick: [string, string][];
  outlines: Record<string, FlowOutline>;
  initial?: string;
}

type Goal = 'solar' | 'both' | 'battery';
type Own = 'own' | 'buying' | 'rent';
type When = 'asap' | '1_3_months' | '3_6_months' | 'researching';

const GOALS: { id: Goal; icon: string; title: string }[] = [
  { id: 'solar', icon: '☀️', title: 'Solar panels' },
  { id: 'both', icon: '🔋', title: 'Solar + battery' },
  { id: 'battery', icon: '⚡', title: 'Battery only' },
];
const OWN: { id: Own; icon: string; label: string }[] = [
  { id: 'own', icon: '🏡', label: 'I own it' },
  { id: 'buying', icon: '🔑', label: 'Buying soon' },
  { id: 'rent', icon: '🏢', label: 'I rent' },
];
const WHEN: { id: When; label: string }[] = [
  { id: 'asap', label: 'As soon as possible' },
  { id: '1_3_months', label: 'In 1–3 months' },
  { id: '3_6_months', label: 'In 3–6 months' },
  { id: 'researching', label: 'Just researching' },
];
// Display symbols only (the bill slider's currency); the real rates live in each calculator.
const CUR: Record<string, string> = { us: '$', ca: '$', au: '$', uk: '£', in: '₹', jp: '¥', br: 'R$', za: 'R', ch: 'CHF ', cl: '$', co: '$', se: 'kr ', no: 'kr ', dk: 'kr ', pl: 'zł ', cz: 'Kč ', ro: 'lei ' };

const card = (on: boolean) => (on ? 'border-2 border-sun-500 bg-sun-50' : 'border border-stone-300 bg-white');
const focusCls = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900';

export default function ReportFlow({ countries, quick, outlines, initial = 'us' }: Props) {
  const [step, setStep] = useState(1);
  const [country, setCountry] = useState(initial);
  const [goal, setGoal] = useState<Goal>('both');
  const [bill, setBill] = useState(180);
  const [own, setOwn] = useState<Own>('own');
  const [when, setWhen] = useState<When>('1_3_months');
  const [zip, setZip] = useState('');
  const [touched, setTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState('');
  const stepRef = useRef<HTMLDivElement>(null);

  // A guide card's "Get my <country> payback" link picks the country here (and returns to step 1).
  useEffect(() => {
    const on = (e: Event) => {
      const code = (e as CustomEvent<string>).detail;
      if (countries.some((c) => c.code === code)) { setCountry(code); setStep(1); }
    };
    window.addEventListener('rv:pick-country', on);
    return () => window.removeEventListener('rv:pick-country', on);
  }, [countries]);

  const isUs = country === 'us';
  const cur = CUR[country] ?? '€';
  const dest = countries.find((c) => c.code === country);
  const name = dest?.name ?? country;
  const zipOk = /^\d{5}$/.test(zip);
  // Installer quotes are Florida and California only. A valid ZIP elsewhere in the US is not an error: the flow says so
  // and routes to the US guides instead of sending the visitor to a quote form that would reject them.
  const zipState = zipOk ? stateByPrefix(zip) : null;
  const zipOutside = zipOk && !zipState;
  const valid = step !== 3 || !isUs || zipOk;
  // Email box: US only once the ZIP is known to be outside FL/CA (FL/CA go to the quote form with its own consent); UK, DE and AU always.
  const signupCountry = SIGNUP_BY_SEGMENT[country];
  const emailBox = signupCountry !== undefined && (isUs ? zipOutside : dest?.kind === 'calc');
  const t = signupText('en');
  const topics = isUs ? (['deadline_alerts'] as const) : (['report', 'deadline_alerts'] as const);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const goalTitle = (GOALS.find((g) => g.id === goal)?.title ?? '').toLowerCase();
  const summary = `${goalTitle} in ${name}, ${cur}${bill}${bill >= 600 ? '+' : ''}/month bill`;

  const go = (n: number) => {
    setStep(n);
    setTouched(false);
    // Move focus to the new step so keyboard and screen-reader users land on it.
    setTimeout(() => stepRef.current?.focus(), 0);
  };

  function open() {
    if (isUs && zipOutside) {
      window.location.assign('/us');
      return;
    }
    if (isUs) {
      const p = new URLSearchParams({ source: 'home', zip, bill: String(bill), battery: goal === 'solar' ? 'no' : 'yes', timeline: when });
      if (own !== 'buying') p.set('homeowner', own === 'own' ? 'yes' : 'no');
      window.location.assign(`/quotes?${p.toString()}`);
      return;
    }
    if (!dest) return;
    if (dest.kind === 'calc') {
      const p = new URLSearchParams({ bill: String(bill) });
      if (goal !== 'solar') p.set('battery', '1');
      window.location.assign(`${dest.href}?${p.toString()}`);
    } else window.location.assign(dest.href);
  }

  /** Submits the optional email (when typed) before opening the calculator. A failed submit stays here so nobody leaves believing they signed up. */
  async function finish() {
    if (emailBox && email.trim() !== '' && signupCountry) {
      if (!emailOk || !consent) {
        setTouched(true);
        return;
      }
      if (sending) return;
      setSending(true);
      setFormError('');
      const res = await submitSignup({
        email: email.trim(),
        country: signupCountry,
        topics: [...topics],
        source: 'home-report',
        locale: 'en',
        params: isUs ? undefined : { bill: String(bill), ...(goal !== 'solar' ? { battery: '1' } : {}) },
      });
      setSending(false);
      if (!res.ok) {
        setFormError(res.kind === 'rate' ? t.errors.tooMany : `${t.errors.generic} You can also leave the email empty to carry on.`);
        return;
      }
    }
    open();
  }

  function next() {
    if (step < 3) return go(step + 1);
    if (!valid) { setTouched(true); return; }
    void finish();
  }

  const finalLabel = isUs ? (zipOutside ? 'See US solar guides' : 'Continue to installer quotes') : dest?.kind === 'calc' ? `Open my ${name} calculator` : `See ${name} guides`;

  return (
    <div class="overflow-hidden rounded-[20px] bg-white shadow-form">
      <div class="flex items-center justify-between gap-3 px-6 pt-5">
        <h3 class="font-display-tight text-[1.375rem] text-stone-900">Your free payback report</h3>
        <span class="shrink-0 whitespace-nowrap rounded-full bg-sun-100 px-2.5 py-1 text-[13px] font-semibold text-sun-ink" aria-live="polite">Step {step} of 3</span>
      </div>
      <div class="grid grid-cols-3 gap-1.5 px-6 pt-3.5" aria-hidden="true">
        {[1, 2, 3].map((n) => <div class={`h-1.5 rounded-full ${step >= n ? 'bg-sun-500' : 'bg-stone-200'}`} />)}
      </div>

      <div ref={stepRef} tabIndex={-1} class="flex flex-col gap-5 px-6 py-[22px] outline-none" aria-label={`Step ${step} of 3`} role="group">
        {step === 1 && (
          <>
            <div class="flex flex-col gap-2.5">
              <p class="font-semibold text-stone-900" id="rf-where">Where is your home?</p>
              <div role="group" aria-labelledby="rf-where" class="grid grid-cols-3 gap-2">
                {quick.map(([code, label]) => {
                  const o = outlines[code];
                  const on = country === code;
                  return (
                    <button type="button" aria-pressed={on} onClick={() => setCountry(code)} class={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm font-semibold text-stone-900 hover:border-sky-pastel-600 ${card(on)} ${focusCls}`}>
                      {o && (
                        <svg viewBox={`0 0 ${o.w} ${o.h}`} class="size-6 flex-none" aria-hidden="true" focusable="false">
                          <path d={o.d} fill={on ? '#fbbf24' : '#d6e8f8'} stroke="#5f8fbd" stroke-width="1.2" vector-effect="non-scaling-stroke" />
                        </svg>
                      )}
                      {label}
                    </button>
                  );
                })}
              </div>
              <select aria-label="Another country" value={country} onChange={(e) => setCountry(e.currentTarget.value)} class="outline-none focus-visible:outline-none focus:border-sun-500 focus:ring-2 focus:ring-sun-400 min-h-11 rounded-[10px] border border-stone-300 bg-stone-50 px-3 text-[15px] text-stone-900">
                {countries.map((c) => <option value={c.code} selected={c.code === country}>{c.name}</option>)}
              </select>
            </div>
            <div class="flex flex-col gap-2.5">
              <p class="font-semibold text-stone-900" id="rf-goal">What are you deciding on?</p>
              <div role="group" aria-labelledby="rf-goal" class="grid grid-cols-3 gap-2">
                {GOALS.map((g) => (
                  <button type="button" aria-pressed={goal === g.id} onClick={() => setGoal(g.id)} class={`flex cursor-pointer flex-col items-start gap-2 rounded-[14px] p-3 text-left text-stone-900 hover:border-sky-pastel-600 ${card(goal === g.id)} ${focusCls}`}>
                    <span class="text-[26px] leading-none" aria-hidden="true">{g.icon}</span>
                    <strong class="text-sm font-bold leading-tight">{g.title}</strong>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div class="flex flex-col gap-2.5">
              <div class="flex items-baseline justify-between gap-3">
                <label for="rf-bill" class="font-semibold text-stone-900">Typical monthly electricity bill</label>
                <output for="rf-bill" class="font-display-tight text-[1.875rem] tabular-nums text-stone-900">{cur}{bill}{bill >= 600 ? '+' : ''}</output>
              </div>
              <input id="rf-bill" type="range" min="20" max="600" step="10" value={bill} onInput={(e) => setBill(Number(e.currentTarget.value))} class="w-full accent-amber-500" />
              <div class="flex justify-between text-xs text-stone-700" aria-hidden="true"><span>{cur}20</span><span>{cur}600+</span></div>
            </div>
            <div class="flex flex-col gap-2.5">
              <p class="font-semibold text-stone-900" id="rf-own">Do you own the home?</p>
              <div role="group" aria-labelledby="rf-own" class="grid grid-cols-3 gap-2">
                {OWN.map((o) => (
                  <button type="button" aria-pressed={own === o.id} onClick={() => setOwn(o.id)} class={`flex min-h-12 cursor-pointer flex-col items-start gap-1.5 rounded-[14px] p-3 text-left text-sm font-semibold text-stone-900 hover:border-sky-pastel-600 ${card(own === o.id)} ${focusCls}`}>
                    <span class="text-[22px] leading-none" aria-hidden="true">{o.icon}</span>{o.label}
                  </button>
                ))}
              </div>
            </div>
            <div class="flex flex-col gap-2.5">
              <p class="font-semibold text-stone-900" id="rf-when">When would you install?</p>
              <div role="group" aria-labelledby="rf-when" class="grid grid-cols-2 gap-2">
                {WHEN.map((o) => (
                  <button type="button" aria-pressed={when === o.id} onClick={() => setWhen(o.id)} class={`min-h-11 cursor-pointer rounded-xl px-3 py-2 text-left text-sm font-semibold text-stone-900 hover:border-sky-pastel-600 ${card(when === o.id)} ${focusCls}`}>{o.label}</button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <div class="flex flex-col gap-4">
            <div class="rounded-xl border border-sky-pastel-300 bg-sky-pastel-50 px-3.5 py-3 text-sm leading-normal text-stone-800">Report for <strong class="text-stone-900">{summary}</strong></div>
            {isUs ? (
              <>
                <label class="flex flex-col gap-1.5 font-semibold text-stone-900">
                  ZIP code (Florida or California)
                  <input type="text" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={zip} aria-invalid={touched && !zipOk ? 'true' : 'false'} aria-describedby="rf-zip-hint"
                    onInput={(e) => setZip(e.currentTarget.value.replace(/\D/g, '').slice(0, 5))}
                    class="min-h-[46px] rounded-[10px] border border-stone-300 bg-stone-50 px-3 font-normal text-stone-900 aria-[invalid=true]:border-red-700" />
                  <span id="rf-zip-hint" class={`text-sm font-normal ${touched && !zipOk ? 'text-red-800' : 'text-stone-700'}`} role={touched && !zipOk ? 'alert' : undefined}>{touched && !zipOk ? 'Enter your 5-digit ZIP code.' : 'Used to find installers that serve your area.'}</span>
                </label>
                {zipOutside ? (
                  <div role="status" class="rounded-xl border border-sky-pastel-300 bg-sky-pastel-50 p-3 text-sm leading-snug text-stone-900">That ZIP is outside Florida and California. Installer quotes and our US calculators cover only those two states for now, so we do not offer quotes there. Our US guides explain costs, incentives and when solar pays, and you can ask us to email you when a deadline or rate change affects solar in the United States.</div>
                ) : (
                  <div class="rounded-xl border border-sun-200 bg-sun-50 p-3 text-sm leading-snug text-stone-900">Next is a short form for your contact details. Up to 3 local installers in Florida or California can send quotes to check against your report, and only the ones you agree to hear from receive your details.</div>
                )}
              </>
            ) : (
              <div class="rounded-xl border border-sun-200 bg-sun-50 p-3 text-sm leading-snug text-stone-900">
                {dest?.kind === 'calc'
                  ? `We open the ${name} calculator with your bill and battery choice filled in, and it shows your payback as a low, likely and high range. We have no installer partners in ${name}, so there are no quotes: just your numbers.`
                  : `No sign-up and no personal details. We have no ${name} calculator yet, so this opens our ${name} guides, where you can check whether solar is worth it there.`}
              </div>
            )}
            {emailBox && signupCountry && (
              <div class="flex flex-col gap-3 rounded-xl border border-sky-pastel-300 bg-white p-3.5">
                <div>
                  <p class="font-semibold text-stone-900">{isUs ? t.home.alertsOnlyHeading : t.home.reportHeading}</p>
                  <p class="mt-1 text-sm leading-snug text-stone-700">{isUs ? t.home.alertsSub : t.home.reportSub}</p>
                </div>
                <label class="flex flex-col gap-1.5 text-sm font-semibold text-stone-900">
                  {t.emailOptionalLabel}
                  <input type="email" autoComplete="email" inputMode="email" maxLength={254} placeholder={t.emailPlaceholder} value={email} aria-invalid={touched && email.trim() !== '' && !emailOk ? 'true' : 'false'} aria-describedby="rf-email-hint"
                    onInput={(e) => { setEmail(e.currentTarget.value); setFormError(''); }}
                    class="min-h-[46px] rounded-[10px] border border-stone-300 bg-stone-50 px-3 text-base font-normal text-stone-900 aria-[invalid=true]:border-red-700" />
                  <span id="rf-email-hint" class={`text-sm font-normal ${touched && email.trim() !== '' && !emailOk ? 'text-red-800' : 'text-stone-700'}`} role={touched && email.trim() !== '' && !emailOk ? 'alert' : undefined}>{touched && email.trim() !== '' && !emailOk ? t.errors.email : t.home.optionalNote}</span>
                </label>
                {email.trim() !== '' && (
                  <div>
                    <label for="rf-consent" class="flex cursor-pointer items-start gap-3 text-sm leading-6 text-stone-800">
                      <input id="rf-consent" type="checkbox" checked={consent} onChange={(e) => { setConsent(e.currentTarget.checked); setFormError(''); }} aria-invalid={touched && !consent ? 'true' : 'false'} aria-describedby="rf-consent-error" class="mt-0.5 size-5 shrink-0 accent-amber-600" />
                      <span>
                        {t.consent(signupCountry, topics).before}
                        <a href="/privacy" class="text-sun-ink underline underline-offset-2 hover:text-stone-900">{t.consent(signupCountry, topics).link}</a>
                        {t.consent(signupCountry, topics).after}
                      </span>
                    </label>
                    {touched && !consent && <p id="rf-consent-error" role="alert" class="mt-1 text-sm font-medium text-red-800">{t.errors.consent}</p>}
                    <p class="mt-2 text-xs leading-5 text-stone-700">{t.confirmNote}</p>
                  </div>
                )}
                {formError && <p role="alert" class="text-sm font-medium text-red-800">{formError}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      <div class="flex flex-col gap-2.5 px-6 pb-[22px]">
        <div class="flex gap-2">
          {step > 1 && <button type="button" onClick={() => go(step - 1)} class={`min-h-[50px] cursor-pointer rounded-lg border border-stone-300 bg-white px-[18px] font-semibold text-stone-800 hover:bg-stone-100 ${focusCls}`}>Back</button>}
          <button type="button" onClick={next} aria-disabled={!valid || sending} class={`flex min-h-[50px] flex-1 cursor-pointer items-center justify-center gap-2.5 rounded-lg bg-sun-400 px-[18px] text-base font-bold text-stone-900 hover:bg-sun-500 aria-disabled:opacity-60 ${focusCls}`}>
            {step === 3 ? (sending ? t.buttons.sending : finalLabel) : 'Continue'} <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
        <p class="text-xs leading-normal text-stone-700">{emailBox ? 'Free. No quotes and no installer contact here. Your email is optional and is never shared with installers.' : isUs ? 'Free, no obligation. Your details are shared only with installers you choose.' : 'Free, no obligation. We do not collect personal details for this country.'}</p>
      </div>
    </div>
  );
}
