/**
 * "Email me this estimate": email + an unchecked consent box, no phone number. Posts to /api/estimate-email, which
 * stores the request (with the exact consent wording) and enrolls the address in the nurture list. Also used by
 * renters (source "renter"), who are not stored as leads.
 * Owner: attorney review of the consent wording (src/lib/leads/consent.ts, ESTIMATE_EMAIL_CONSENT_TEXT).
 */
import type { TargetedSubmitEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { State } from '../../data/schemas';
import { ESTIMATE_EMAIL_CONSENT_TEXT, splitAtPrivacyPolicy } from '../../lib/leads/consent';
import type { EstimateSnapshot } from '../../lib/leads/validate';
import { normalizeEmail } from '../../lib/leads/validate';
import { trackEvent } from '../../lib/track';
import { CONTACT_EMAIL } from '../../lib/contact';
import { submitErrorText } from '../../lib/leads/client';
import { btnSecondary } from '../ui/buttons';

interface Props {
  id: string;
  state: State | null;
  snapshot: EstimateSnapshot | null;
  source: 'results' | 'renter';
  heading?: string;
}

type Status = 'idle' | 'sending' | 'done' | 'error';

export default function EstimateEmailForm(p: Props) {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [errors, setErrors] = useState<{ email?: string; consent?: string }>({});
  const [status, setStatus] = useState<Status>('idle');
  const [emailed, setEmailed] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const consentParts = splitAtPrivacyPolicy(ESTIMATE_EMAIL_CONSENT_TEXT);

  // On a failed send, move focus to the message; the button stays enabled and the typed email is kept.
  useEffect(() => {
    if (status === 'error') alertRef.current?.focus();
  }, [status]);

  async function onSubmit(e: TargetedSubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'sending') return;
    const next: typeof errors = {};
    if (!normalizeEmail(email)) next.email = 'Enter a valid email address, like name@example.com.';
    if (!consent) next.consent = 'Check the box to agree to receive the email.';
    setErrors(next);
    if (next.email) return void emailRef.current?.focus();
    if (next.consent) return void document.getElementById(`${p.id}-consent`)?.focus();
    setStatus('sending');
    try {
      const res = await fetch('/api/estimate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, consent: 'on', state: p.state ?? '', source: p.source, estimate_snapshot: p.snapshot ? JSON.stringify(p.snapshot) : '', website: hp }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; emailed?: boolean; fieldErrors?: typeof errors } | null;
      if (res.ok && body?.ok) {
        setEmailed(body.emailed === true);
        setStatus('done');
        trackEvent('results_cta_click', { state: p.state ?? '', placement: 'email_estimate' });
        return;
      }
      if (res.status === 400 && body?.fieldErrors) {
        setErrors(body.fieldErrors);
        setStatus('idle');
        return;
      }
      setStatus('error');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <p role="status" class="font-medium text-stone-900">
        {emailed ? 'Sent. Check your inbox (and spam folder) for your estimate.' : 'Thanks. We saved your request and will email your estimate.'}
      </p>
    );
  }

  const sending = status === 'sending';
  return (
    <form onSubmit={onSubmit} noValidate class="space-y-3">
      <fieldset disabled={sending} class="min-w-0 space-y-3">
        <div class="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
          <label for={`${p.id}-website`}>Leave this field empty</label>
          <input id={`${p.id}-website`} type="text" tabIndex={-1} autoComplete="off" value={hp} onInput={(e) => setHp(e.currentTarget.value)} />
        </div>
        <div>
          <label for={`${p.id}-email`} class="block font-medium text-stone-900">
            {p.heading ?? 'Email address'}
          </label>
          <input
            ref={emailRef}
            id={`${p.id}-email`}
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
            aria-invalid={errors.email ? 'true' : 'false'}
            aria-describedby={errors.email ? `${p.id}-email-error` : undefined}
            class="mt-1 block min-h-11 w-full max-w-md rounded-lg border border-stone-400 bg-white px-3 py-2 text-base text-stone-900 aria-[invalid=true]:border-red-700"
          />
          {errors.email && (
            <p id={`${p.id}-email-error`} role="alert" class="mt-1 text-sm font-medium text-red-800">
              {errors.email}
            </p>
          )}
        </div>
        <div>
          <label for={`${p.id}-consent`} class="flex cursor-pointer items-start gap-3 text-sm leading-6 text-stone-700">
            <input
              id={`${p.id}-consent`}
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.currentTarget.checked)}
              aria-invalid={errors.consent ? 'true' : 'false'}
              aria-describedby={errors.consent ? `${p.id}-consent-error` : undefined}
              class="mt-0.5 h-5 w-5 shrink-0 accent-amber-600"
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
                ESTIMATE_EMAIL_CONSENT_TEXT
              )}
            </span>
          </label>
          {errors.consent && (
            <p id={`${p.id}-consent-error`} role="alert" class="mt-1 text-sm font-medium text-red-800">
              {errors.consent}
            </p>
          )}
        </div>
      </fieldset>
      <button type="submit" class={btnSecondary} disabled={sending}>
        {sending ? 'Sending…' : 'Email me this estimate'}
      </button>
      {status === 'error' && (
        <p ref={alertRef} tabIndex={-1} role="alert" class="font-medium text-red-800 focus:outline-none">
          {submitErrorText(CONTACT_EMAIL)}
        </p>
      )}
    </form>
  );
}
