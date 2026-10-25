/**
 * "Get free installer quotes" form. Used inside the calculator island (results) and as its own small
 * island on /quotes. Works without JavaScript (plain POST to /api/leads -> 303 /quotes/thanks); with
 * JavaScript it validates in the browser, posts JSON and shows the result inline.
 *
 * Owner: legal review of the consent text (src/lib/leads/consent.ts) before paid traffic.
 */
import type { TargetedSubmitEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { State } from '../../data/schemas';
import { CONSENT_LEAD } from '../../lib/leads/consent';
import type { EstimateSnapshot, FieldErrors, LeadField } from '../../lib/leads/validate';
import { PHONE_ERROR, TIMELINES, TIMELINE_LABELS, normalizePhone, validateLead } from '../../lib/leads/validate';
import { trackEvent } from '../../lib/track';
import { btnPrimary, btnText } from '../ui/buttons';

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
  /** Show the ZIP as text with a "Change" button (results card) instead of an input. */
  onChangeZip?: () => void;
  context?: QuoteContext;
  /** /quotes: read state, zip and source from the query string, and offer a state select when absent. */
  fromQuery?: boolean;
}

const ORDER: LeadField[] = ['first_name', 'email', 'phone', 'zip', 'state', 'homeowner', 'timeline', 'consent'];
const SOURCE_PARAM_RE = /^city:(florida|california)\/[a-z0-9-]+$|^home$/;

const inputCls =
  'mt-1 block min-h-11 w-full rounded-lg border border-stone-400 bg-white px-3 py-2 text-base text-stone-900 aria-[invalid=true]:border-red-700';
const cardCls =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-stone-300 bg-white px-3 py-2 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50';

type Status = 'idle' | 'sending' | 'done' | 'error';

export default function QuoteForm(p: Props) {
  const [state, setState] = useState<State | ''>(p.state ?? '');
  const [stateFixed, setStateFixed] = useState(!!p.state || !p.fromQuery);
  const [source, setSource] = useState(p.source);
  const [zip, setZip] = useState(p.zip ?? '');
  const [first, setFirst] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [homeowner, setHomeowner] = useState<'yes' | 'no' | ''>('');
  const [timeline, setTimeline] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>('idle');
  const [doneName, setDoneName] = useState('');
  const started = useRef(false);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const fid = (f: string) => `${p.id}-${f}`;
  // A locked ZIP (results card) always follows the prop: the card stays mounted when the estimate is re-run
  // for a different ZIP, so copying it into state once would send a stale ZIP.
  const zipValue = p.onChangeZip ? (p.zip ?? '') : zip;

  useEffect(() => {
    if (!p.fromQuery) return;
    const q = new URLSearchParams(window.location.search);
    const s = (q.get('state') ?? '').toUpperCase();
    if (s === 'FL' || s === 'CA') {
      setState(s);
      setStateFixed(true);
    }
    const z = q.get('zip') ?? '';
    if (/^\d{5}$/.test(z)) setZip(z);
    const src = q.get('source') ?? '';
    if (SOURCE_PARAM_RE.test(src)) setSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === 'done') doneRef.current?.focus();
  }, [status]);

  const ctx = p.context;
  const fields = () => ({
    first_name: first,
    email,
    phone,
    zip: zipValue,
    state,
    homeowner,
    timeline,
    consent: consent ? 'on' : '',
    source,
    page_path: p.pagePath,
    ...(ctx
      ? {
          utility_id: ctx.utilityId ?? '',
          bill: ctx.bill === null ? '' : String(ctx.bill),
          battery: ctx.battery === null ? '' : String(ctx.battery),
          shading: ctx.shading ?? '',
          estimate_snapshot: ctx.snapshot ? JSON.stringify(ctx.snapshot) : '',
        }
      : {}),
  });

  function showErrors(e: FieldErrors) {
    setErrors(e);
    const firstBad = ORDER.find((f) => e[f]);
    if (!firstBad) return;
    // Radio groups focus their first option.
    const target = firstBad === 'homeowner' ? fid('homeowner-yes') : firstBad === 'timeline' ? fid(`timeline-${TIMELINES[0]}`) : fid(firstBad);
    requestAnimationFrame(() => document.getElementById(target)?.focus());
  }

  function onPhoneBlur() {
    if (!phone.trim()) return;
    setErrors((e) => ({ ...e, phone: normalizePhone(phone) ? undefined : PHONE_ERROR }));
  }

  /** quote_form_start: once per page view, on the first focus inside the form (no field values). */
  function onFirstFocus() {
    if (started.current) return;
    started.current = true;
    trackEvent('quote_form_start', { source: source.startsWith('city:') ? 'city' : source, state });
  }

  async function onSubmit(e: TargetedSubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'sending') return;
    const f = fields();
    const v = validateLead(f);
    if (v.kind === 'invalid') return showErrors(v.fieldErrors);
    if (v.kind === 'honeypot') return;
    setErrors({});
    setStatus('sending');
    try {
      const res = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(f) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; fieldErrors?: FieldErrors } | null;
      if (res.ok && body?.ok) {
        setDoneName(v.lead.first_name);
        setStatus('done');
        trackEvent('quote_submit', { source: v.lead.source.startsWith('city:') ? 'city' : v.lead.source, state: v.lead.state });
        return;
      }
      if (res.status === 400 && body?.fieldErrors && Object.keys(body.fieldErrors).some((k) => k !== 'form')) {
        setStatus('idle');
        return showErrors(body.fieldErrors);
      }
      setStatus('error');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <p ref={doneRef} tabIndex={-1} role="status" class="rounded-lg border border-stone-200 bg-white px-4 py-3 font-medium text-stone-900 focus:outline-none">
        Thanks, {doneName}! Up to 3 local installers may reach out soon.
      </p>
    );
  }

  const err = (f: LeadField) =>
    errors[f] ? (
      <p id={fid(`${f}-error`)} role="alert" class="mt-1 text-sm font-medium text-red-800">
        {errors[f]}
      </p>
    ) : null;
  const aria = (f: LeadField) => ({ 'aria-invalid': errors[f] ? ('true' as const) : ('false' as const), 'aria-describedby': errors[f] ? fid(`${f}-error`) : undefined });
  const sending = status === 'sending';

  return (
    <form method="post" action="/api/leads" noValidate onSubmit={onSubmit} onFocusIn={onFirstFocus} class="space-y-4">
      <fieldset disabled={sending} class="min-w-0 space-y-4">
        {/* Honeypot: hidden from people and assistive tech; bots fill it in. */}
        <div class="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
          <label for={fid('website')}>Leave this field empty</label>
          <input id={fid('website')} name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <input type="hidden" name="source" value={source} />
        <input type="hidden" name="page_path" value={p.pagePath} />
        {ctx && (
          <>
            <input type="hidden" name="utility_id" value={ctx.utilityId ?? ''} />
            <input type="hidden" name="bill" value={ctx.bill === null ? '' : String(ctx.bill)} />
            <input type="hidden" name="battery" value={ctx.battery === null ? '' : String(ctx.battery)} />
            <input type="hidden" name="shading" value={ctx.shading ?? ''} />
            <input type="hidden" name="estimate_snapshot" value={ctx.snapshot ? JSON.stringify(ctx.snapshot) : ''} />
          </>
        )}

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for={fid('first_name')} class="block font-medium text-stone-900">
              First name
            </label>
            <input id={fid('first_name')} name="first_name" type="text" autoComplete="given-name" maxLength={60} value={first} onInput={(e) => setFirst(e.currentTarget.value)} class={inputCls} {...aria('first_name')} />
            {err('first_name')}
          </div>
          <div>
            <label for={fid('email')} class="block font-medium text-stone-900">
              Email
            </label>
            <input id={fid('email')} name="email" type="email" autoComplete="email" maxLength={254} value={email} onInput={(e) => setEmail(e.currentTarget.value)} class={inputCls} {...aria('email')} />
            {err('email')}
          </div>
          <div>
            <label for={fid('phone')} class="block font-medium text-stone-900">
              Phone
            </label>
            <input
              id={fid('phone')}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={40}
              value={phone}
              onInput={(e) => setPhone(e.currentTarget.value)}
              onBlur={onPhoneBlur}
              class={inputCls}
              {...aria('phone')}
            />
            {err('phone')}
          </div>
          {p.onChangeZip ? (
            <div>
              <input type="hidden" name="zip" value={zipValue} />
              <p class="block font-medium text-stone-900">ZIP code</p>
              <p class="mt-1 flex min-h-11 items-center gap-2 text-stone-900">
                <span>{zipValue}</span>
                <button type="button" class={btnText} onClick={p.onChangeZip}>
                  Change<span class="sr-only"> ZIP code</span>
                </button>
              </p>
              {err('zip')}
            </div>
          ) : (
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
                value={zip}
                onInput={(e) => setZip(e.currentTarget.value)}
                class={`${inputCls} max-w-40`}
                {...aria('zip')}
              />
              {err('zip')}
            </div>
          )}
        </div>

        {stateFixed ? (
          <input type="hidden" name="state" value={state} />
        ) : (
          <div>
            <label for={fid('state')} class="block font-medium text-stone-900">
              State
            </label>
            <select id={fid('state')} name="state" value={state} onChange={(e) => setState(e.currentTarget.value as State | '')} class={`${inputCls} max-w-60`} {...aria('state')}>
              <option value="">Choose your state</option>
              <option value="FL">Florida</option>
              <option value="CA">California</option>
            </select>
            {err('state')}
          </div>
        )}

        <fieldset aria-describedby={errors.homeowner ? fid('homeowner-error') : undefined}>
          <legend class="font-medium text-stone-900">Do you own this home?</legend>
          <div class="mt-2 grid grid-cols-2 gap-2 sm:max-w-sm">
            {(['yes', 'no'] as const).map((v) => (
              <label key={v} for={fid(`homeowner-${v}`)} class={cardCls}>
                <input id={fid(`homeowner-${v}`)} type="radio" name="homeowner" value={v} checked={homeowner === v} onChange={() => setHomeowner(v)} class="h-5 w-5 accent-amber-600" />
                <span class="font-medium text-stone-900">{v === 'yes' ? 'Yes' : 'No'}</span>
              </label>
            ))}
          </div>
          {err('homeowner')}
        </fieldset>

        <fieldset aria-describedby={errors.timeline ? fid('timeline-error') : undefined}>
          <legend class="font-medium text-stone-900">When are you hoping to go solar?</legend>
          <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TIMELINES.map((t) => (
              <label key={t} for={fid(`timeline-${t}`)} class={cardCls}>
                <input id={fid(`timeline-${t}`)} type="radio" name="timeline" value={t} checked={timeline === t} onChange={() => setTimeline(t)} class="h-5 w-5 shrink-0 accent-amber-600" />
                <span class="text-sm font-medium text-stone-900">{TIMELINE_LABELS[t]}</span>
              </label>
            ))}
          </div>
          {err('timeline')}
        </fieldset>

        <div>
          <label for={fid('consent')} class="flex cursor-pointer items-start gap-3 text-sm leading-6 text-stone-700">
            <input
              id={fid('consent')}
              name="consent"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.currentTarget.checked)}
              class="mt-0.5 h-5 w-5 shrink-0 accent-amber-600"
              {...aria('consent')}
            />
            <span>
              {CONSENT_LEAD} See our{' '}
              <a href="/privacy" class="text-sun-ink underline underline-offset-2 hover:text-stone-900">
                Privacy Policy
              </a>
              .
            </span>
          </label>
          {err('consent')}
        </div>
      </fieldset>

      <div>
        <button type="submit" class={btnPrimary} disabled={sending}>
          {sending ? 'Sending…' : 'Get my free quotes'}
        </button>
        <p class="mt-2 text-sm text-stone-600">Free and no obligation. We only share your request with up to 3 local installers.</p>
        {status === 'error' && (
          <p role="alert" class="mt-2 font-medium text-red-800">
            Something went wrong — please try again.
          </p>
        )}
      </div>
    </form>
  );
}
