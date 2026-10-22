/**
 * The calculator island. It collects inputs, fetches solar production and calls
 * calculate() from src/lib/calc. It does no calculator math itself: every number shown
 * comes from calculate() (already rounded) and is only formatted here.
 *
 * Bundle: the initial chunk holds only the form and formatting. The page state's ZIP table
 * is loaded on first ZIP check (zip.ts) and the calc engine + fallback (engine.ts, no ZIP
 * tables) when an estimate is run; both via dynamic import(). The other state's table is never loaded.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedSubmitEvent } from 'preact';
import type { BatteryCount, CalcResult, CalcSuccess, Shading } from '../../lib/calc/types';
import { displayPayback, displayRange, formatKw, formatSignedUsd, type RangeDisplay } from '../../lib/calculator/display';
import { CALCULATOR_PATHS, STATE_NAMES, parseBill } from '../../lib/calculator/form';
import type { CalculatorProps } from '../../lib/calculator/page-data';
import { createRunGuard } from '../../lib/calculator/run-guard';
import { checkZipIn, loadZipTable, type ZipCheck } from '../../lib/calculator/zip';
import { formatUsd } from '../../lib/format';
import { parseShareParams, serializeShareParams } from '../../lib/share';

const loadEngine = () => import('../../lib/calculator/engine');

type Step = 1 | 2 | 3 | 4;
const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'ZIP code' },
  { n: 2, label: 'Utility' },
  { n: 3, label: 'Monthly bill' },
  { n: 4, label: 'Battery & shade' },
];
const NEXT: Record<Step, Step> = { 1: 2, 2: 3, 3: 4, 4: 4 };
const PREV: Record<Step, Step> = { 1: 1, 2: 1, 3: 2, 4: 3 };
/** The input to focus when a step fails validation. */
const FIELD_IDS: Record<Step, string> = { 1: 'calc-zip', 2: 'calc-utility', 3: 'calc-bill', 4: 'calc-battery-0' };

const BATTERY_OPTIONS: { value: BatteryCount; label: string; hint: string }[] = [
  { value: 0, label: 'No battery', hint: 'Solar panels only' },
  { value: 1, label: '1 battery', hint: 'Backup for essentials' },
  { value: 2, label: '2 batteries', hint: 'More backup capacity' },
];
const SHADING_OPTIONS: { value: Shading; label: string; hint: string }[] = [
  { value: 'none', label: 'Little or none', hint: 'Open roof, full sun most of the day' },
  { value: 'some', label: 'Some', hint: 'Trees or buildings shade part of the day' },
  { value: 'heavy', label: 'Heavy', hint: 'Shaded for much of the day' },
];

type Outcome =
  | { kind: 'result'; result: CalcResult; fallbackCity: string | null }
  | { kind: 'no_production' }
  | { kind: 'error' };

type ZipError = (ZipCheck & { ok: false }) | { ok: false; error: 'load' };
interface Errors {
  zip?: ZipError;
  utility?: string;
  bill?: string;
}

interface RunInput {
  lat: number;
  lon: number;
  zip: string;
  utilityId: string;
  bill: number;
  battery: BatteryCount;
  shading: Shading;
}

const BILL_ERRORS = {
  empty: 'Enter your average monthly electric bill.',
  not_number: 'Enter a dollar amount, like 180 or 180.50.',
  too_low: 'Enter an amount greater than $0.',
} as const;

const btnPrimary =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-sun-400 px-5 py-2.5 font-semibold text-stone-900 hover:bg-sun-500 disabled:opacity-60';
const btnSecondary =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-5 py-2.5 font-semibold text-stone-800 hover:bg-stone-100 disabled:opacity-60';
const inputCls =
  'mt-2 block min-h-11 w-full rounded-lg border border-stone-400 bg-white px-3 py-2 text-lg text-stone-900 aria-[invalid=true]:border-red-700';

const focusField = (s: Step) => document.getElementById(FIELD_IDS[s])?.focus();

export default function Calculator(props: CalculatorProps) {
  const { state, utilities, costs, assumptions, fallbackCities, fallbackProduction } = props;
  const maxBill = assumptions.max_monthly_bill.value;
  const stateName = STATE_NAMES[state];

  const [step, setStep] = useState<Step>(1);
  const [zip, setZip] = useState('');
  const [utilityId, setUtilityId] = useState('');
  const [billRaw, setBillRaw] = useState('');
  const [battery, setBattery] = useState<BatteryCount>(0);
  const [shading, setShading] = useState<Shading>('none');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');

  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  // Focus requests, honoured by the effects below once the matching render has happened.
  const focusStep = useRef<'heading' | 'field' | null>(null);
  const focusResults = useRef(false);
  // A run that is superseded (new run) or cancelled ("Start over") is aborted and never committed.
  const runs = useRef(createRunGuard()).current;

  useEffect(() => {
    if (focusStep.current === 'heading') headingRef.current?.focus();
    if (focusStep.current === 'field') focusField(step);
    focusStep.current = null;
  }, [step]);
  useEffect(() => {
    if (focusResults.current) resultsRef.current?.focus();
    focusResults.current = false;
  }, [outcome]);

  // Prefill and auto-run from a shared link.
  useEffect(() => {
    const p = parseShareParams(window.location.search);
    if (!p) return;
    const b = parseBill(String(p.bill), maxBill);
    if (!b.ok || !utilities.some((u) => u.id === p.utility)) return;
    void (async () => {
      const z = await checkZip(p.zip);
      if (!z.ok) return;
      setZip(p.zip);
      setUtilityId(p.utility);
      setBillRaw(String(p.bill));
      setBattery(p.battery);
      setShading(p.shading);
      setStep(4);
      void run({ lat: z.location.lat, lon: z.location.lon, zip: p.zip, utilityId: p.utility, bill: b.value, battery: p.battery, shading: p.shading }, false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Loads the state's ZIP table on first use; a load failure is reported as its own error. */
  async function checkZip(raw: string): Promise<ZipCheck | { ok: false; error: 'load' }> {
    try {
      return checkZipIn(raw, state, await loadZipTable(state));
    } catch {
      return { ok: false, error: 'load' };
    }
  }

  function goTo(s: Step, focus: 'heading' | 'field' = 'heading') {
    focusStep.current = focus;
    setStep(s);
    if (s !== 1) void loadEngine().catch(() => undefined); // warm the engine chunk before it is needed
  }

  async function validateStep(s: Step): Promise<boolean> {
    if (s === 1) {
      const z = await checkZip(zip);
      setErrors((e) => ({ ...e, zip: z.ok ? undefined : z }));
      return z.ok;
    }
    if (s === 2) {
      const bad = !utilities.some((u) => u.id === utilityId);
      setErrors((e) => ({ ...e, utility: bad ? 'Choose your electric utility.' : undefined }));
      return !bad;
    }
    if (s === 3) {
      const b = parseBill(billRaw, maxBill);
      const msg = b.ok ? undefined : b.error === 'too_high' ? `Enter an amount up to ${formatUsd(maxBill)}.` : BILL_ERRORS[b.error];
      setErrors((e) => ({ ...e, bill: msg }));
      return b.ok;
    }
    return true;
  }

  async function run(i: RunInput, wantFocus: boolean) {
    const ticket = runs.start();
    const current = ticket.isCurrent;
    setBusy(true);
    setCopied('idle');
    let next: Outcome;
    try {
      const [engine, zipTable] = await Promise.all([loadEngine(), loadZipTable(state)]);
      if (!current()) return;
      // calculate() resolves the ZIP through this lookup over the page state's table only.
      const lookupZip = (z: string) => {
        const c = checkZipIn(z, state, zipTable);
        return c.ok ? c.location : null;
      };
      const prod = await engine.getProduction(
        { lat: i.lat, lon: i.lon, state, losses: engine.lossesForShading(i.shading, assumptions), cities: fallbackCities, rows: fallbackProduction },
        undefined,
        undefined,
        ticket.signal,
      );
      if (!current()) return;
      if (!prod.ok) {
        next = { kind: 'no_production' };
      } else {
        const result = engine.calculate(
          { zip: i.zip, utilityId: i.utilityId, avgMonthlyBill: i.bill, battery: i.battery, shading: i.shading },
          { lookupZip, utilities, costs, assumptions, production: prod.production },
        );
        next = { kind: 'result', result, fallbackCity: prod.source === 'fallback' ? prod.cityName : null };
        if (result.ok) {
          const qs = serializeShareParams({ zip: i.zip, utility: i.utilityId, bill: i.bill, battery: i.battery, shading: i.shading });
          window.history.replaceState(null, '', `${window.location.pathname}${qs}`);
        }
      }
    } catch {
      if (!current()) return;
      next = { kind: 'error' };
    }
    focusResults.current = wantFocus;
    setOutcome(next);
    setBusy(false);
  }

  async function onSubmit(e: TargetedSubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (step !== 4) {
      if (await validateStep(step)) goTo(NEXT[step]);
      else focusField(step);
      return;
    }
    // Final submit: re-check every step; send the user to the first invalid one.
    for (const s of [1, 2, 3] as const) {
      if (!(await validateStep(s))) return goTo(s, 'field');
    }
    const z = await checkZip(zip);
    const b = parseBill(billRaw, maxBill);
    if (!z.ok || !b.ok) return;
    void run({ lat: z.location.lat, lon: z.location.lon, zip: zip.trim(), utilityId, bill: b.value, battery, shading }, true);
  }

  function startOver() {
    runs.cancel();
    setBusy(false);
    setOutcome(null);
    setCopied('idle');
    window.history.replaceState(null, '', window.location.pathname);
    goTo(1);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  }

  const zipErr = errors.zip;
  const stepTitle = STEPS.find((s) => s.n === step)!.label;

  return (
    <div>
      <form onSubmit={onSubmit} noValidate class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
        {/* Disabled while an estimate runs, so inputs cannot change under it. */}
        <fieldset disabled={busy} class="min-w-0">
        <ol class="flex gap-2" aria-label="Progress">
          {STEPS.map((s) => (
            <li
              key={s.n}
              aria-current={s.n === step ? 'step' : undefined}
              class={`flex-1 border-t-4 pt-2 text-xs font-medium sm:text-sm ${s.n <= step ? 'border-sun-400 text-stone-900' : 'border-stone-200 text-stone-600'}`}
            >
              <span class="sr-only">Step </span>
              {s.n}
              <span class="hidden sm:inline">. {s.label}</span>
              {s.n < step && <span class="sr-only"> (done)</span>}
            </li>
          ))}
        </ol>

        <h2 ref={headingRef} tabIndex={-1} class="mt-6 text-xl font-semibold text-stone-900 focus:outline-none sm:text-2xl">
          Step {step} of 4: {stepTitle}
        </h2>

        {step === 1 && (
          <div class="mt-4">
            <label for="calc-zip" class="block font-medium text-stone-900">
              Your home&rsquo;s ZIP code
            </label>
            <p id="calc-zip-hint" class="mt-1 text-sm text-stone-600">
              We use it only to look up how much sun your area gets.
            </p>
            <input
              id="calc-zip"
              name="zip"
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={5}
              value={zip}
              onInput={(e) => setZip(e.currentTarget.value)}
              onFocus={() => void loadZipTable(state).catch(() => undefined)}
              aria-invalid={zipErr ? 'true' : 'false'}
              aria-describedby={zipErr ? 'calc-zip-hint calc-zip-error' : 'calc-zip-hint'}
              class={`${inputCls} max-w-40`}
            />
            {zipErr && (
              <p id="calc-zip-error" role="alert" class="mt-2 text-sm font-medium text-red-800">
                {zipErr.error === 'format' && 'Enter a 5-digit ZIP code.'}
                {zipErr.error === 'load' && 'We couldn’t check your ZIP code just now. Please try again.'}
                {zipErr.error === 'not_found' && `We don't recognize that ZIP code as a ${stateName} ZIP. Check it and try again.`}
                {zipErr.error === 'other_state' && (
                  <>
                    That ZIP code is in {STATE_NAMES[zipErr.otherState]}.{' '}
                    <a href={CALCULATOR_PATHS[zipErr.otherState]} class="text-sun-ink underline underline-offset-2">
                      Use the {STATE_NAMES[zipErr.otherState]} calculator
                    </a>
                    .
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div class="mt-4">
            <label for="calc-utility" class="block font-medium text-stone-900">
              Your electric utility
            </label>
            <p id="calc-utility-hint" class="mt-1 text-sm text-stone-600">
              It&rsquo;s printed at the top of your electric bill.
            </p>
            <select
              id="calc-utility"
              name="utility"
              value={utilityId}
              onChange={(e) => setUtilityId(e.currentTarget.value)}
              aria-invalid={errors.utility ? 'true' : 'false'}
              aria-describedby={errors.utility ? 'calc-utility-hint calc-utility-error' : 'calc-utility-hint'}
              class={inputCls}
            >
              <option value="">Choose your utility</option>
              {utilities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            {errors.utility && (
              <p id="calc-utility-error" role="alert" class="mt-2 text-sm font-medium text-red-800">
                {errors.utility}
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div class="mt-4">
            <label for="calc-bill" class="block font-medium text-stone-900">
              Average monthly electric bill
            </label>
            <p id="calc-bill-hint" class="mt-1 text-sm text-stone-600">
              A 12-month average works best, since bills change with the seasons.
            </p>
            <div class="relative max-w-48">
              <span class="pointer-events-none absolute left-3 top-1/2 mt-1 -translate-y-1/2 text-lg text-stone-600" aria-hidden="true">
                $
              </span>
              <input
                id="calc-bill"
                name="bill"
                type="text"
                inputMode="decimal"
                value={billRaw}
                onInput={(e) => setBillRaw(e.currentTarget.value)}
                aria-invalid={errors.bill ? 'true' : 'false'}
                aria-describedby={errors.bill ? 'calc-bill-hint calc-bill-error' : 'calc-bill-hint'}
                class={`${inputCls} pl-7`}
              />
            </div>
            {errors.bill && (
              <p id="calc-bill-error" role="alert" class="mt-2 text-sm font-medium text-red-800">
                {errors.bill}
              </p>
            )}
          </div>
        )}

        {step === 4 && (
          <div class="mt-4 space-y-6">
            <RadioGroup
              legend="Add a home battery?"
              name="battery"
              options={BATTERY_OPTIONS}
              value={battery}
              onChange={setBattery}
            />
            <RadioGroup legend="How much shade does your roof get?" name="shading" options={SHADING_OPTIONS} value={shading} onChange={setShading} />
          </div>
        )}

        <div class="mt-8 flex flex-wrap gap-3">
          {step > 1 && (
            <button type="button" class={btnSecondary} onClick={() => goTo(PREV[step])}>
              Back
            </button>
          )}
          <button type="submit" class={btnPrimary} disabled={busy}>
            {step < 4 ? 'Next' : busy ? 'Calculating…' : outcome ? 'Update my estimate' : 'See my estimate'}
          </button>
        </div>
        </fieldset>
      </form>

      <div aria-live="polite" class="sr-only">
        {busy ? 'Calculating your estimate…' : ''}
      </div>

      {outcome && (
        <section aria-labelledby="calc-results-heading" class="mt-8 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
          <h2 ref={resultsRef} id="calc-results-heading" tabIndex={-1} class="text-2xl font-bold tracking-tight text-stone-900 focus:outline-none">
            Your solar estimate
          </h2>
          {outcome.kind === 'no_production' && (
            <p class="mt-4 text-stone-700">
              We couldn&rsquo;t get solar production data for your area right now. Please try again in a minute.
            </p>
          )}
          {outcome.kind === 'error' && <p class="mt-4 text-stone-700">Something went wrong while calculating. Please try again.</p>}
          {outcome.kind === 'result' && !outcome.result.ok && (
            <p class="mt-4 text-stone-700">
              {outcome.result.reason === 'missing_data'
                ? 'We’re still verifying rates for this utility, so we can’t show an estimate yet. Check back soon, or sign up below to hear when it’s ready.'
                : 'Please check your answers and try again.'}
            </p>
          )}
          {outcome.kind === 'result' && outcome.result.ok && (
            <Results
              r={outcome.result}
              fallbackCity={outcome.fallbackCity}
              utilityName={utilities.find((u) => u.id === (outcome.result as CalcSuccess).utilityId)?.name ?? ''}
              copied={copied}
              busy={busy}
              onCopy={copyLink}
              onStartOver={startOver}
            />
          )}
        </section>
      )}
    </div>
  );
}

function RadioGroup<V extends string | number>(p: {
  legend: string;
  name: string;
  options: { value: V; label: string; hint: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <fieldset>
      <legend class="font-medium text-stone-900">{p.legend}</legend>
      <div class="mt-2 grid gap-2 sm:grid-cols-3">
        {p.options.map((o) => {
          const id = `calc-${p.name}-${o.value}`;
          return (
            <label
              key={id}
              for={id}
              class="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-stone-300 bg-white p-3 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50"
            >
              <input
                id={id}
                type="radio"
                name={p.name}
                value={String(o.value)}
                checked={p.value === o.value}
                onChange={() => p.onChange(o.value)}
                class="mt-1 h-5 w-5 accent-amber-600"
              />
              <span>
                <span class="block font-medium text-stone-900">{o.label}</span>
                <span class="block text-sm text-stone-600">{o.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Metric(p: { label: string; d: RangeDisplay; note?: string }) {
  return (
    <div class="rounded-xl border border-stone-200 bg-stone-50 p-4">
      <dt class="text-sm font-medium text-stone-700">{p.label}</dt>
      <dd class="mt-1">
        {p.d.kind === 'single' ? (
          <span class="text-2xl font-bold text-stone-900">{p.d.value}</span>
        ) : (
          <>
            <span class="block text-2xl font-bold text-stone-900">
              <span class="sr-only">Likely </span>
              {p.d.likely}
              <span class="ml-2 align-middle text-xs font-semibold uppercase tracking-wide text-sun-ink" aria-hidden="true">
                likely
              </span>
            </span>
            <span class="mt-1 block text-sm text-stone-700">
              Range {p.d.low} to {p.d.high}
            </span>
          </>
        )}
        {p.note && <span class="mt-1 block text-xs text-stone-600">{p.note}</span>}
      </dd>
    </div>
  );
}

function Results(p: {
  r: CalcSuccess;
  fallbackCity: string | null;
  utilityName: string;
  copied: 'idle' | 'ok' | 'fail';
  busy: boolean;
  onCopy: () => void;
  onStartOver: () => void;
}) {
  const { r } = p;
  const noUsage = r.annualUsageKwh === 0;
  return (
    <div>
      {p.utilityName && <p class="mt-2 text-stone-700">For a home on {p.utilityName}.</p>}

      <p class="mt-4 rounded-lg border-l-4 border-sun-400 bg-sun-50 px-4 py-3 font-medium text-stone-900">
        No federal tax credit applied — the federal residential clean energy credit ended for expenditures after Dec 31, 2025.
      </p>

      {p.fallbackCity && (
        <p class="mt-3 text-sm text-stone-700">
          Live solar data was unavailable, so we&rsquo;re using a nearby city estimate ({p.fallbackCity}).
        </p>
      )}

      {r.warnings.length > 0 && (
        <div class="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <h3 class="font-semibold text-stone-900">Worth knowing</h3>
          <ul class="mt-1 list-disc space-y-1 pl-5 text-stone-800">
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {!noUsage && (
        <dl class="mt-6 grid gap-3 sm:grid-cols-2">
          <Metric label="System size" d={displayRange(r.size, formatKw)} />
          <Metric label="Upfront cost" d={displayRange(r.cost, formatUsd)} note="Before any incentives" />
          <Metric label="First-year bill savings" d={displayRange(r.year1Savings, formatUsd)} />
          <Metric label="Payback" d={displayPayback(r.paybackYears, r.analysisYears)} note="Range runs from shortest (best case) to longest" />
          <Metric label={`Net savings over ${r.analysisYears} years`} d={displayRange(r.netSavings25, formatSignedUsd)} note="Bill savings minus upfront cost" />
        </dl>
      )}

      <details class="mt-6 rounded-lg border border-stone-200 bg-white">
        <summary class="min-h-11 cursor-pointer px-4 py-3 font-semibold text-stone-900">How this estimate was built ({r.assumptions.length} assumptions)</summary>
        <ul class="list-disc space-y-2 px-4 pb-4 pl-9 text-sm leading-6 text-stone-700">
          {r.assumptions.map((a) => (
            <li key={a} class="break-words">
              {a}
            </li>
          ))}
        </ul>
      </details>

      <div class="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" class={btnSecondary} onClick={p.onCopy} disabled={p.busy}>
          Copy link to this estimate
        </button>
        <button type="button" class={btnSecondary} onClick={p.onStartOver} disabled={p.busy}>
          Start over
        </button>
        <span role="status" class="text-sm text-stone-700">
          {p.copied === 'ok' ? 'Link copied.' : p.copied === 'fail' ? 'Copy failed. Copy the address from your browser bar instead.' : ''}
        </span>
      </div>
    </div>
  );
}
