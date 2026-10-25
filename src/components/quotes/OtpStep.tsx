/**
 * Step 4 of the quote form (only when phone verification is configured): confirm the mobile number with an SMS
 * code. The lead is already saved; verified or skipped, the person moves on. The verified flag is set by the
 * server after Twilio approves the code; this component only sends the code the person typed.
 * Resend is allowed after 30 seconds, at most 3 codes in total.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_SENDS, RESEND_AFTER_SECONDS } from '../../lib/leads/verify-limits';
import { btnPrimary, btnSecondary, btnText } from '../ui/buttons';

interface Props {
  id: string;
  leadId: string;
  token: string;
  /** Last four digits, for the prompt. */
  lastFour: string;
  onDone: (verified: boolean) => void;
}

interface Reply {
  ok?: boolean;
  sent?: boolean;
  verified?: boolean;
  error?: string;
  retry_after?: number;
  sends_left?: number;
}

async function call(body: object): Promise<{ status: number; data: Reply | null }> {
  try {
    const res = await fetch('/api/leads/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: (await res.json().catch(() => null)) as Reply | null };
  } catch {
    return { status: 0, data: null };
  }
}

export default function OtpStep(p: Props) {
  const [code, setCode] = useState('');
  const [sends, setSends] = useState(0);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);

  useEffect(() => {
    headingRef.current?.focus();
    if (!started.current) {
      started.current = true;
      void send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send() {
    setBusy(true);
    setError('');
    const { status, data } = await call({ lead_id: p.leadId, token: p.token, action: 'send' });
    setBusy(false);
    if (data?.sent) {
      setSends((n) => n + 1);
      setWait(data.retry_after ?? RESEND_AFTER_SECONDS);
      setMessage(`We texted a code to the number ending in ${p.lastFour}.`);
      return;
    }
    if (status === 429 && data?.retry_after) setWait(data.retry_after);
    setError(data?.error ?? 'We could not send the code. You can skip this step.');
  }

  async function check() {
    if (busy) return;
    if (!/^\d{4,10}$/.test(code.trim())) {
      setError('Enter the code from the text message.');
      return;
    }
    setBusy(true);
    setError('');
    const { data } = await call({ lead_id: p.leadId, token: p.token, action: 'check', code: code.trim() });
    setBusy(false);
    if (data?.verified) return p.onDone(true);
    setError(data?.error ?? 'That code didn’t work. Check it and try again, or ask for a new code.');
  }

  const canResend = wait <= 0 && sends < MAX_SENDS && !busy;
  return (
    <div class="space-y-4">
      <h3 ref={headingRef} tabIndex={-1} class="text-xl font-bold tracking-tight text-stone-900 focus:outline-none">
        Confirm your mobile number
      </h3>
      <p class="text-stone-700">A confirmed number helps installers reach you. Your request is already saved &mdash; this step is optional.</p>
      <p role="status" class="text-stone-800">
        {message}
      </p>
      <form
        class="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
      <div>
        <label for={`${p.id}-otp`} class="block font-medium text-stone-900">
          6-digit code
        </label>
        <input
          id={`${p.id}-otp`}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={10}
          value={code}
          onInput={(e) => setCode(e.currentTarget.value)}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${p.id}-otp-error` : undefined}
          class="mt-1 block min-h-11 w-full max-w-48 rounded-lg border border-stone-400 bg-white px-3 py-2 text-base tracking-widest text-stone-900 aria-[invalid=true]:border-red-700"
        />
        {error && (
          <p id={`${p.id}-otp-error`} role="alert" class="mt-1 text-sm font-medium text-red-800">
            {error}
          </p>
        )}
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button type="submit" class={btnPrimary} disabled={busy || sends === 0}>
          {busy ? 'Checking…' : 'Confirm number'}
        </button>
        <button type="button" class={btnSecondary} onClick={send} disabled={!canResend}>
          {sends >= MAX_SENDS ? 'No more codes' : wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        </button>
        <button type="button" class={btnText} onClick={() => p.onDone(false)}>
          Skip for now
        </button>
      </div>
      </form>
      <p class="text-sm text-stone-600">Message and data rates may apply. You can ask for up to {MAX_SENDS} codes.</p>
    </div>
  );
}
