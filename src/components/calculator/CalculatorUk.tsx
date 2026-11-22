/**
 * The UK calculator island (en-GB, GBP). It collects inputs, looks up solar yield through /api/pvgis and calls
 * calculateGlobal() from src/lib/calc. It does no calculator math itself: every number shown comes from the engine
 * (already rounded) or from a database row, and is only formatted here. No lead form: leads are US-only.
 *
 * Bundle: the initial chunk holds only the form and formatting; the engine + chart load when an estimate is run.
 */
import type { TargetedSubmitEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GlobalCalcResult, GlobalCalcSuccess } from '../../lib/calc/global-types';
import type { Shading } from '../../lib/calc/types';
import { displayPayback, displayRange, formatKw, moneyFormats, type RangeDisplay } from '../../lib/calculator/display';
import { parseBill } from '../../lib/calculator/form';
import { createRunGuard } from '../../lib/calculator/run-guard';
import {
  batteryAvailable,
  billFromAnnualKwh,
  buildUkContext,
  exportOffers,
  installOptions,
  locationFor,
  lossesFor,
  orientationFactor,
  pvgisUrl,
  runSources,
  scaleProduction,
  type Orientation,
  type SourceRef,
  type UkBattery,
  type UkCalculatorProps,
} from '../../lib/calculator/uk';
import { calcVatWindow } from '../../lib/db/map-global';
import { btnPrimary, btnSecondary, btnText } from '../ui/buttons';
import SavingsChart from './SavingsChart';

const loadEngine = () => import('../../lib/calculator/uk-engine');

type UsageMode = 'bill' | 'kwh';
const ORIENTATIONS: { value: Orientation; label: string; hint: string }[] = [
  { value: 'south', label: 'South', hint: 'Facing south, or close to it' },
  { value: 'east_west', label: 'East or west', hint: 'Facing east or west' },
  { value: 'north', label: 'North', hint: 'Facing north' },
];
const SHADING: { value: Shading; label: string; hint: string }[] = [
  { value: 'none', label: 'Little or none', hint: 'Open roof, full sun most of the day' },
  { value: 'some', label: 'Some', hint: 'Trees or buildings shade part of the day' },
  { value: 'heavy', label: 'Heavy', hint: 'Shaded for much of the day' },
];

interface Shown {
  result: GlobalCalcResult;
  regionName: string;
  locationName: string;
  offerName: string;
  battery: UkBattery;
  installLabel: string;
  sources: SourceRef[];
  chart: ReturnType<typeof import('../../lib/calc/chart').buildSavingsChart>;
}
type Outcome = { kind: 'result'; shown: Shown } | { kind: 'no_production' } | { kind: 'error' };

interface Errors {
  region?: string;
  usage?: string;
  offer?: string;
}

const inputCls = 'mt-2 block min-h-11 w-full rounded-lg border border-stone-400 bg-white px-3 py-2 text-lg text-stone-900 aria-[invalid=true]:border-red-700';
const regionLabel = (name: string) => name.replace(/ \(Ofgem price cap region\)$/, '');

export default function CalculatorUk(props: UkCalculatorProps) {
  const { market, utilities, costs, assumptions } = props;
  const fmt = moneyFormats(market.locale, market.currency);
  const maxBill = assumptions.max_monthly_bill.value;
  const options = installOptions(props.vatRates.map(calcVatWindow), props.today, market.locale);
  const batteryOk = batteryAvailable(costs);

  const [regionId, setRegionId] = useState('');
  const [mode, setMode] = useState<UsageMode>('bill');
  const [usageRaw, setUsageRaw] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('south');
  const [shading, setShading] = useState<Shading>('none');
  const [installId, setInstallId] = useState(options[0]?.id ?? '');
  const [offerId, setOfferId] = useState('');
  const [battery, setBattery] = useState<UkBattery>(0);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const focusResults = useRef(false);
  const runs = useRef(createRunGuard()).current;

  const install = options.find((o) => o.id === installId) ?? options[0];
  const offers = exportOffers(props.exportPolicies, install?.installDate ?? props.today);
  const offer = offers.find((o) => o.id === offerId);
  const region = utilities.find((u) => u.id === regionId);

  useEffect(() => {
    if (focusResults.current && resultsRef.current) {
      resultsRef.current.focus({ preventScroll: true });
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      resultsRef.current.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    }
    focusResults.current = false;
  }, [outcome]);

  function validate(): { bill: number } | null {
    const e: Errors = {};
    if (!region) e.region = 'Choose your electricity price cap region.';
    if (!offer) e.offer = 'Choose the export payment you are on or expect to be on.';
    let bill = 0;
    const raw = usageRaw.trim().replace(/^£/, '').replace(/,/g, '');
    if (mode === 'bill') {
      const b = parseBill(raw, maxBill);
      if (b.ok) bill = b.value;
      else e.usage = b.error === 'too_high' ? `Enter an amount up to ${fmt.money(maxBill)}.` : b.error === 'too_low' ? 'Enter an amount greater than £0.' : b.error === 'empty' ? 'Enter your average monthly electricity bill.' : 'Enter a pound amount, like 90 or 90.50.';
    } else if (raw === '') e.usage = 'Enter your yearly electricity use in kWh.';
    else if (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0) e.usage = 'Enter a number of kWh greater than 0, like 3100.';
    else if (region) {
      const converted = billFromAnnualKwh(region, Number(raw));
      if (converted === null) e.usage = 'We could not convert that yet. Enter your monthly bill instead.';
      else bill = converted;
    }
    setErrors(e);
    if (e.region) return document.getElementById('uk-region')?.focus(), null;
    if (e.usage) return document.getElementById('uk-usage')?.focus(), null;
    if (e.offer) return document.getElementById('uk-offer')?.focus(), null;
    return { bill };
  }

  async function run(bill: number) {
    if (!region || !offer || !install) return;
    const ticket = runs.start();
    const current = ticket.isCurrent;
    setBusy(true);
    let next: Outcome;
    try {
      const engine = await loadEngine();
      if (!current()) return;
      const loc = locationFor(props, region.id);
      const factor = orientationFactor(assumptions, orientation);
      if (!loc || factor === null) {
        next = { kind: 'error' };
      } else {
        const live = await engine.fetchLivePvgis(pvgisUrl(market.code, loc.lat, loc.lon, lossesFor(assumptions, shading)), undefined, undefined, ticket.signal);
        if (!current()) return;
        if (!live) {
          next = { kind: 'no_production' };
        } else {
          const production = scaleProduction(live, factor);
          const runInput = { utilityId: region.id, exportPolicyId: offer.id };
          const ctx = buildUkContext(props, runInput, production);
          if (!ctx) throw new Error('context');
          const result = engine.calculateGlobal({ utilityId: region.id, avgMonthlyBill: bill, battery, shading, installDate: install.installDate }, ctx);
          next = {
            kind: 'result',
            shown: {
              result,
              regionName: regionLabel(region.name),
              locationName: loc.name,
              offerName: offer.name,
              battery,
              installLabel: install.label,
              sources: runSources(props, runInput, install.installDate, battery),
              chart: result.ok && result.annualUsageKwh > 0 ? engine.buildSavingsChart(result, fmt.symbol) : null,
            },
          };
        }
      }
    } catch {
      if (!current()) return;
      next = { kind: 'error' };
    }
    focusResults.current = true;
    setOutcome(next);
    setBusy(false);
  }

  async function onSubmit(e: TargetedSubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const v = validate();
    if (v) await run(v.bill);
  }

  const ok = outcome?.kind === 'result' && outcome.shown.result.ok ? outcome.shown : null;

  return (
    <div class="space-y-8">
      <form onSubmit={onSubmit} noValidate class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
        <fieldset disabled={busy} class="min-w-0 space-y-7">
          <legend class="sr-only">Your home and your electricity</legend>

          <div>
            <label for="uk-region" class="block font-medium text-stone-900">Your electricity price cap region</label>
            <p id="uk-region-hint" class="mt-1 text-sm text-stone-600">
              Ofgem sets a different price cap for each of {utilities.length} regions. It is printed on your bill, or look it up from your postcode on{' '}
              {region?.avg_rate_per_kwh?.source_url ? (
                <a href={region.avg_rate_per_kwh.source_url} rel="noopener" class="text-sun-ink underline underline-offset-2">Ofgem&rsquo;s regional page</a>
              ) : (
                'Ofgem’s regional page'
              )}
              .
            </p>
            <select
              id="uk-region"
              value={regionId}
              onChange={(e) => setRegionId(e.currentTarget.value)}
              aria-invalid={errors.region ? 'true' : 'false'}
              aria-describedby={errors.region ? 'uk-region-hint uk-region-error' : 'uk-region-hint'}
              class={inputCls}
            >
              <option value="">Choose your region</option>
              {utilities.map((u) => (
                <option key={u.id} value={u.id}>
                  {regionLabel(u.name)}
                </option>
              ))}
            </select>
            {region?.rate_note && <p class="mt-2 text-sm text-stone-700">{region.rate_note}</p>}
            {errors.region && (
              <p id="uk-region-error" role="alert" class="mt-2 text-sm font-medium text-red-800">
                {errors.region}
              </p>
            )}
          </div>

          <fieldset>
            <legend class="font-medium text-stone-900">How much electricity do you use?</legend>
            <div class="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ['bill', 'Monthly bill'],
                  ['kwh', 'Yearly kWh'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} for={`uk-mode-${v}`} class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50">
                  <input id={`uk-mode-${v}`} type="radio" name="uk-mode" value={v} checked={mode === v} onChange={() => setMode(v)} class="h-5 w-5 accent-amber-600" />
                  <span class="font-medium text-stone-900">{label}</span>
                </label>
              ))}
            </div>
            <label for="uk-usage" class="mt-3 block font-medium text-stone-900">
              {mode === 'bill' ? 'Average monthly electricity bill' : 'Electricity used in a year'}
            </label>
            <p id="uk-usage-hint" class="mt-1 text-sm text-stone-600">
              {mode === 'bill' ? 'A 12-month average works best, since bills change with the seasons. Electricity only, not gas.' : 'The kWh total for the last 12 months, from your bill or supplier app.'}
            </p>
            <div class="relative max-w-48">
              {mode === 'bill' && (
                <span class="pointer-events-none absolute left-3 top-1/2 mt-1 -translate-y-1/2 text-lg text-stone-600" aria-hidden="true">
                  £
                </span>
              )}
              <input
                id="uk-usage"
                type="text"
                inputMode="decimal"
                value={usageRaw}
                onInput={(e) => setUsageRaw(e.currentTarget.value)}
                aria-invalid={errors.usage ? 'true' : 'false'}
                aria-describedby={errors.usage ? 'uk-usage-hint uk-usage-error' : 'uk-usage-hint'}
                class={`${inputCls} ${mode === 'bill' ? 'pl-7' : ''}`}
              />
            </div>
            {errors.usage && (
              <p id="uk-usage-error" role="alert" class="mt-2 text-sm font-medium text-red-800">
                {errors.usage}
              </p>
            )}
          </fieldset>

          <RadioGroup legend="Which way does the main roof face?" name="uk-orientation" options={ORIENTATIONS} value={orientation} onChange={setOrientation} />
          <RadioGroup legend="How much shade does the roof get?" name="uk-shading" options={SHADING} value={shading} onChange={setShading} />

          {options.length > 0 && (
            <fieldset>
              <legend class="font-medium text-stone-900">When would the system be installed?</legend>
              <p class="mt-1 text-sm text-stone-600">VAT on solar installation depends on the install date.</p>
              <div class="mt-2 grid gap-2 sm:grid-cols-2">
                {options.map((o) => (
                  <label key={o.id} for={`uk-install-${o.id}`} class="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-stone-300 bg-white p-3 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50">
                    <input id={`uk-install-${o.id}`} type="radio" name="uk-install" value={o.id} checked={installId === o.id} onChange={() => setInstallId(o.id)} class="mt-1 h-5 w-5 accent-amber-600" />
                    <span>
                      <span class="block font-medium text-stone-900">{o.label}</span>
                      <span class="block text-sm text-stone-600">VAT on the installation: {Number((o.solarVat * 100).toFixed(2))}%</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div>
            <label for="uk-offer" class="block font-medium text-stone-900">What are you paid for the electricity you export?</label>
            <p id="uk-offer-hint" class="mt-1 text-sm text-stone-600">
              Under the Smart Export Guarantee your supplier sets the rate. Pick the one you are on, or one you might choose. Some are only open to that supplier&rsquo;s customers.
            </p>
            <select
              id="uk-offer"
              value={offerId}
              onChange={(e) => setOfferId(e.currentTarget.value)}
              aria-invalid={errors.offer ? 'true' : 'false'}
              aria-describedby={errors.offer ? 'uk-offer-hint uk-offer-error' : 'uk-offer-hint'}
              class={inputCls}
            >
              <option value="">Choose an export payment</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id} disabled={o.pence === null}>
                  {o.name}
                  {o.pence !== null ? `: ${o.pence}p per kWh` : ' (no rate on this install date)'}
                </option>
              ))}
            </select>
            {offer?.note && <p class="mt-2 text-sm text-stone-700">{offer.note}</p>}
            {errors.offer && (
              <p id="uk-offer-error" role="alert" class="mt-2 text-sm font-medium text-red-800">
                {errors.offer}
              </p>
            )}
          </div>

          <fieldset>
            <legend class="font-medium text-stone-900">Add a home battery?</legend>
            <div class="mt-2 grid gap-2 sm:grid-cols-2">
              <label for="uk-battery-0" class="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-stone-300 bg-white p-3 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50">
                <input id="uk-battery-0" type="radio" name="uk-battery" checked={battery === 0} onChange={() => setBattery(0)} class="mt-1 h-5 w-5 accent-amber-600" />
                <span>
                  <span class="block font-medium text-stone-900">No battery</span>
                  <span class="block text-sm text-stone-600">Solar panels only</span>
                </span>
              </label>
              <label
                for="uk-battery-1"
                class={`flex min-h-11 items-start gap-3 rounded-lg border border-stone-300 p-3 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50 ${batteryOk ? 'cursor-pointer bg-white' : 'cursor-not-allowed bg-stone-100'}`}
              >
                <input id="uk-battery-1" type="radio" name="uk-battery" checked={battery === 1} disabled={!batteryOk} onChange={() => setBattery(1)} class="mt-1 h-5 w-5 accent-amber-600" />
                <span>
                  <span class="block font-medium text-stone-900">1 battery</span>
                  <span class="block text-sm text-stone-600">{batteryOk ? 'Priced from official MCS retrofit battery data' : 'No sourced UK battery cost yet'}</span>
                </span>
              </label>
            </div>
          </fieldset>

          <div>
            <button type="submit" class={btnPrimary} disabled={busy}>
              {busy ? 'Calculating…' : outcome ? 'Update my estimate' : 'See my estimate'}
            </button>
          </div>
        </fieldset>
      </form>

      <div aria-live="polite" class="sr-only">
        {busy ? 'Calculating your estimate…' : ''}
      </div>

      {outcome && (
        <section aria-labelledby="uk-results-heading" class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm motion-safe:animate-fade-in sm:p-8">
          <h2 ref={resultsRef} id="uk-results-heading" tabIndex={-1} class="scroll-mt-4 text-2xl font-bold tracking-tight text-stone-900 focus:outline-none">
            Your solar estimate
          </h2>
          {outcome.kind === 'no_production' && <p class="mt-4 text-stone-700">We couldn&rsquo;t get solar production data for your area right now. Please try again in a minute.</p>}
          {outcome.kind === 'error' && <p class="mt-4 text-stone-700">Something went wrong while calculating. Please try again.</p>}
          {outcome.kind === 'result' && !outcome.shown.result.ok && (
            <p class="mt-4 text-stone-700">
              {outcome.shown.result.reason === 'missing_data' ? 'We’re still verifying some of the data for this estimate, so we can’t show it yet.' : 'Please check your answers and try again.'}
            </p>
          )}
          {ok && ok.result.ok && <Results shown={ok} r={ok.result} fmt={fmt} />}
        </section>
      )}
    </div>
  );
}

function RadioGroup<V extends string>(p: { legend: string; name: string; options: { value: V; label: string; hint: string }[]; value: V; onChange: (v: V) => void }) {
  return (
    <fieldset>
      <legend class="font-medium text-stone-900">{p.legend}</legend>
      <div class="mt-2 grid gap-2 sm:grid-cols-3">
        {p.options.map((o) => {
          const id = `${p.name}-${o.value}`;
          return (
            <label key={id} for={id} class="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-stone-300 bg-white p-3 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50">
              <input id={id} type="radio" name={p.name} value={o.value} checked={p.value === o.value} onChange={() => p.onChange(o.value)} class="mt-1 h-5 w-5 accent-amber-600" />
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

/** "3.1 kW (2.7 kW to 3.4 kW)": a displayed range as one phrase (formatting only). */
const rangeText = (d: RangeDisplay): string => (d.kind === 'single' ? d.value : `${d.likely} (${d.low} to ${d.high})`);

function Metric(p: { label: string; d: RangeDisplay; note?: string; hero?: boolean; extra?: string }) {
  const value = p.hero ? 'text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl' : 'text-2xl font-bold text-stone-900';
  return (
    <div class={p.hero ? 'rounded-xl border-2 border-sun-300 bg-white p-4' : 'rounded-xl border border-stone-200 bg-stone-50 p-4'}>
      <dt class="text-sm font-medium text-stone-700">{p.label}</dt>
      <dd class="mt-1">
        {p.d.kind === 'single' ? (
          <span class={value}>{p.d.value}</span>
        ) : (
          <>
            <span class={`block ${value}`}>
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
        {p.extra && <span class="mt-2 block border-t border-stone-200 pt-2 text-sm text-stone-800">{p.extra}</span>}
      </dd>
    </div>
  );
}

function Results(p: { shown: Shown; r: GlobalCalcSuccess; fmt: ReturnType<typeof moneyFormats> }) {
  const { shown, r, fmt } = p;
  const noUsage = r.annualUsageKwh === 0;
  return (
    <div>
      <p class="mt-2 text-stone-700">
        For a home in {shown.regionName}, paid by {shown.offerName}. {shown.installLabel}. {shown.battery > 0 ? 'With one battery.' : 'Solar panels only.'}
      </p>
      {!noUsage && (
        <dl class="mt-4 grid grid-cols-2 gap-3">
          <Metric hero label="Payback" d={displayPayback(r.paybackYears, r.analysisYears)} note="Range runs from shortest (best case) to longest" />
          <Metric hero label={`Net savings over ${r.analysisYears} years`} d={displayRange(r.netSavings25, fmt.signed)} note="Bill savings and export payments, minus upfront cost" />
          <Metric label="Upfront cost" d={displayRange(r.cost, fmt.money)} note="Including VAT, before any grant or loan" extra={`System size: ${rangeText(displayRange(r.size, formatKw))}`} />
          <Metric label="First-year savings" d={displayRange(r.year1Savings, fmt.money)} note="Lower bills plus export payments" />
        </dl>
      )}
      <p class="mt-3 text-sm text-stone-700">No grant or government payment is included: there is no universal UK solar grant. Loans, where offered, are not counted.</p>
      <p class="mt-1 text-sm text-stone-700">Solar yield is looked up at {shown.locationName}, the place we use for your region.</p>

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

      {shown.chart && <SavingsChart chart={shown.chart} years={r.analysisYears} money={fmt.money} />}

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

      <details class="mt-4 rounded-lg border border-stone-200 bg-white">
        <summary class="min-h-11 cursor-pointer px-4 py-3 font-semibold text-stone-900">Where the numbers come from ({shown.sources.length} sources)</summary>
        <ul class="list-disc space-y-2 px-4 pb-4 pl-9 text-sm leading-6 text-stone-700">
          {shown.sources.map((s) => (
            <li key={s.url + s.label} class="break-words">
              <a href={s.url} rel="noopener" class="text-sun-ink underline underline-offset-2">
                {s.label}
              </a>
              , checked {s.verifiedOn}
            </li>
          ))}
        </ul>
      </details>

      <p class="mt-4 text-sm text-stone-700">
        Estimates are not a quote: installer prices, your actual usage and your supplier&rsquo;s rates will differ. Read the <a href="/methodology" class="text-sun-ink underline underline-offset-2">methodology</a>.
      </p>
      <p class="mt-4">
        <button type="button" class={btnSecondary} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          Change my answers
        </button>
        <button type="button" class={btnText} onClick={() => window.location.reload()}>
          Start over
        </button>
      </p>
    </div>
  );
}
