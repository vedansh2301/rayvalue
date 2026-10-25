/**
 * What to do with the estimate, as three separate actions under the headline numbers:
 *  1. Primary: "Get real installer prices for this system" opens the quote form (prefilled with the calculator answers).
 *  2. Secondary: "Email me this estimate" (email + consent, no phone).
 *  3. Tertiary: "Talk to someone now" click-to-call, only during staffed hours and only when a number is configured.
 * On phones a sticky bottom bar repeats the primary action while the primary card is off screen.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { State } from '../../data/schemas';
import { fetchQuoteConfig, fetchServiced, type ClientQuoteConfig } from '../../lib/leads/client';
import { estimateChip } from '../../lib/leads/snapshot';
import Icon from '../icons/Icon';
import { isStaffedNow } from '../../lib/leads/hours';
import { trackEvent } from '../../lib/track';
import { btnPrimary } from '../ui/buttons';
import EstimateEmailForm from './EstimateEmailForm';
import QuoteForm, { type QuoteContext } from './QuoteForm';

interface Props {
  state: State;
  zip: string;
  pagePath: string;
  context: QuoteContext;
  /** Rates are still being verified: there is no estimate to email. */
  pending: boolean;
  /** Tells the page when the fixed bottom bar shows, so the page can leave room for it at its end. */
  onStickyChange?: (shown: boolean) => void;
}

export default function ResultsActions(p: Props) {
  const [open, setOpen] = useState(false);
  const [primaryVisible, setPrimaryVisible] = useState(true);
  const [footerVisible, setFooterVisible] = useState(false);
  const [config, setConfig] = useState<ClientQuoteConfig | null>(null);
  /** null until the lookup answers (or if it fails): treated as served. */
  const [serviced, setServiced] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => new Date());
  const primaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    void fetchQuoteConfig(p.state).then((c) => live && setConfig(c));
    // Re-check staffed hours once a minute while the page is open.
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [p.state]);

  useEffect(() => {
    let live = true;
    void fetchServiced(p.zip).then((r) => live && r && setServiced(r.serviced));
    return () => {
      live = false;
    };
  }, [p.zip]);

  // The sticky bar hides while the primary card or the footer is on screen, so it never covers them.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const obs: IntersectionObserver[] = [];
    if (primaryRef.current) {
      const o = new IntersectionObserver(([e]) => e && setPrimaryVisible(e.isIntersecting));
      o.observe(primaryRef.current);
      obs.push(o);
    }
    const footer = document.querySelector('footer');
    if (footer) {
      const o = new IntersectionObserver(([e]) => e && setFooterVisible(e.isIntersecting));
      o.observe(footer);
      obs.push(o);
    }
    return () => obs.forEach((o) => o.disconnect());
  }, []);

  function openForm(placement: 'primary' | 'sticky') {
    // From lg up the primary card sits in the sticky right rail.
    const inRail = placement === 'primary' && typeof matchMedia === 'function' && matchMedia('(min-width: 1024px)').matches;
    trackEvent('results_cta_click', { state: p.state, placement: inRail ? 'rail' : placement });
    setOpen(true);
    requestAnimationFrame(() => primaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  const call = config?.call && isStaffedNow(now, config.call.hours) ? config.call : null;
  const waitlist = serviced === false;
  const showSticky = !open && !primaryVisible && !footerVisible;
  useEffect(() => {
    p.onStickyChange?.(showSticky);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSticky]);

  return (
    <div class="mt-6 space-y-4 lg:mt-0">
      {/* 1. Primary */}
      <section ref={primaryRef} aria-labelledby="calc-quote-heading" class="scroll-mt-4 rounded-2xl border-2 border-sun-400 bg-sun-50 p-5 sm:p-6">
        <h3 id="calc-quote-heading" class="text-xl font-bold tracking-tight text-stone-900">
          {waitlist ? `Get notified when installers cover ${p.zip}` : 'Next step: real prices'}
        </h3>
        {waitlist ? <EstimateChip chip={estimateChip(p.context.snapshot)} /> : <QuoteBridge chip={estimateChip(p.context.snapshot)} />}
        {p.pending && <p class="mt-1 text-stone-700">We&rsquo;re still verifying rates &mdash; installers can still quote your home.</p>}
        {!open ? (
          <>
            <div class="mt-3">
              <button type="button" class={`${btnPrimary} w-full sm:w-auto`} aria-expanded="false" aria-controls="calc-quote-form" onClick={() => openForm('primary')}>
                {waitlist ? 'Join the installer waitlist' : 'Get real installer prices for this system'}
              </button>
            </div>
            <p class="mt-2 text-stone-700">{waitlist ? FREE_LINE_WAITLIST : FREE_LINE}</p>
          </>
        ) : (
          <div id="calc-quote-form" class="mt-3">
            <p class="mb-4 text-stone-700">{waitlist ? FREE_LINE_WAITLIST : FREE_LINE}</p>
            <QuoteForm id="calc-quote" source="results" pagePath={p.pagePath} state={p.state} zip={p.zip} context={p.context} autoFocus />
          </div>
        )}
      </section>

      {/* 2. Secondary */}
      {!p.pending && (
        <section aria-labelledby="calc-email-heading" class="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
          <h3 id="calc-email-heading" class="text-lg font-semibold text-stone-900">
            Email me this estimate
          </h3>
          <p class="mb-3 mt-1 text-sm text-stone-700">Get a copy of these numbers in your inbox. No phone number needed.</p>
          <EstimateEmailForm id="calc-email" state={p.state} snapshot={p.context.snapshot} source="results" />
        </section>
      )}

      {/* 3. Tertiary: only inside staffed hours, only with a configured number */}
      {call && (
        <p class="px-1 text-stone-700">
          Prefer to talk?{' '}
          <a href={`tel:${call.tel}`} class="font-semibold text-sun-ink underline underline-offset-4 hover:text-stone-900" onClick={() => trackEvent('call_click', { placement: 'results' })}>
            Talk to someone now: {call.display}
          </a>
        </p>
      )}

      {showSticky && (
        <div class="fixed inset-x-0 bottom-0 z-40 border-t border-stone-300 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] sm:hidden">
          <button type="button" class={`${btnPrimary} w-full`} onClick={() => openForm('sticky')}>
            {waitlist ? 'Join the installer waitlist' : 'Get real installer prices'}
          </button>
        </div>
      )}
    </div>
  );
}

const FREE_LINE = 'Free, no obligation. Up to 3 local installers. We only share your details with installers you agree to.';
const FREE_LINE_WAITLIST = 'Free, no obligation. We only share your details with installers you agree to.';

function EstimateChip({ chip }: { chip: string | null }) {
  return chip ? <p class="mt-3 inline-block rounded-full border border-sun-500 bg-white px-3 py-1.5 text-sm font-semibold text-stone-900">{chip}</p> : null;
}

/** What happens next: share the estimate, up to 3 local installers, compare. Vertical list on mobile. */
function QuoteBridge({ chip }: { chip: string | null }) {
  const steps = [
    { icon: 'home', label: 'Share your estimate' },
    { icon: 'users', label: 'Up to 3 local installers' },
    { icon: 'scale', label: 'Compare and choose' },
  ] as const;
  return (
    <div class="mt-3" role="group" aria-label="How it works: share your estimate, up to 3 local installers, compare and choose">
      {chip && <p class="mb-2 inline-block rounded-full border border-sun-500 bg-white px-3 py-1.5 text-sm font-semibold text-stone-900">{chip}</p>}
      <ol class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 lg:flex-col lg:items-start lg:gap-2">
        {steps.map((st, n) => (
          <li key={st.label} class="!mt-0 flex items-center gap-2 text-sm font-semibold text-stone-900">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white"><Icon name={st.icon} size={20} /></span>
            <span><span class="text-stone-700">{n + 1}.</span> {st.label}</span>
            {n < steps.length - 1 && <Icon name="arrow" class="ml-1 hidden text-stone-700 sm:block lg:hidden" />}
          </li>
        ))}
      </ol>
    </div>
  );
}
