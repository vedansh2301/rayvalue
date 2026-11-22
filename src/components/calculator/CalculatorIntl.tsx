/**
 * The shared international calculator island (UK en-GB/GBP, Germany de-DE/EUR, Australia en-AU/AUD). It collects inputs,
 * looks up solar yield through /api/pvgis and calls calculateGlobal() from src/lib/calc. It does no calculator math
 * itself: every number shown comes from the engine (already rounded) or from a database row, and is only formatted
 * here. Text comes from src/lib/calculator/intl-strings.ts, chosen by the market code. No lead form: leads are US-only.
 *
 * Bundle: the initial chunk holds only the form and formatting; the engine + chart load when an estimate is run.
 */
import type { TargetedSubmitEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GlobalCalcResult, GlobalCalcSuccess } from '../../lib/calc/global-types';
import type { Shading } from '../../lib/calc/types';
import { displayRange, moneyFormats, type RangeDisplay } from '../../lib/calculator/display';
import { formatKwLocale, longDate, paybackText, parseKwhInput, parseMoneyInput, periodLabel } from '../../lib/calculator/intl';
import { idPrefixFor, stringsFor, type CalcStrings } from '../../lib/calculator/intl-strings';
import { createRunGuard } from '../../lib/calculator/run-guard';
import {
  batteryAvailable,
  billFromAnnualKwh,
  buildUkContext,
  exportOffers,
  installHorizon,
  installPeriodsFor,
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
import { btnPrimary, btnSecondary, btnText } from '../ui/buttons';
import SavingsChart from './SavingsChart';

const loadEngine = () => import('../../lib/calculator/uk-engine');

type UsageMode = 'bill' | 'kwh';

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

export default function CalculatorIntl(props: UkCalculatorProps) {
  const { market, utilities, costs, assumptions } = props;
  const s = stringsFor(market.code);
  const px = idPrefixFor(market.code);
  const fmt = moneyFormats(market.locale, market.currency);
  const pct = new Intl.NumberFormat(market.locale, { style: 'percent', maximumFractionDigits: 2 });
  const maxBill = assumptions.max_monthly_bill.value;
  const periods = installPeriodsFor(props);
  const horizon = installHorizon(assumptions);
  const batteryOk = batteryAvailable(costs);

  const [regionId, setRegionId] = useState('');
  const [mode, setMode] = useState<UsageMode>('bill');
  const [usageRaw, setUsageRaw] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('south');
  const [shading, setShading] = useState<Shading>('none');
  const [installId, setInstallId] = useState(periods[0]?.id ?? '');
  const [offerId, setOfferId] = useState('');
  const [battery, setBattery] = useState<UkBattery>(0);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const focusResults = useRef(false);
  const runs = useRef(createRunGuard()).current;

  const periodIndex = Math.max(0, periods.findIndex((p) => p.id === installId));
  const install = periods[periodIndex];
  const installText = install ? periodLabel(install, periodIndex, s, market.locale) : '';
  const offers = exportOffers(props.exportPolicies, install?.installDate ?? props.today);
  const offer = offers.find((o) => o.id === offerId);
  const region = utilities.find((u) => u.id === regionId);

  // ?bill= (monthly bill in the local currency) and ?battery=1 prefill the form (links from the home-page report).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const b = Number(q.get('bill'));
    if (q.get('bill') && Number.isFinite(b) && b > 0 && b <= maxBill) { setMode('bill'); setUsageRaw(String(Math.round(b))); }
    if (q.get('battery') === '1' && batteryOk) setBattery(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!region) e.region = s.regionError;
    if (!offer || offer.pence === null) e.offer = s.offerError;
    let bill = 0;
    if (mode === 'bill') {
      const b = parseMoneyInput(usageRaw, market.locale, maxBill);
      if (b.ok) bill = b.value;
      else e.usage = b.error === 'too_high' ? s.usageErrors.tooHigh(fmt.money(maxBill)) : b.error === 'too_low' ? s.usageErrors.tooLow : b.error === 'empty' ? s.usageErrors.emptyBill : s.usageErrors.notNumberBill;
    } else if (usageRaw.trim() === '') e.usage = s.usageErrors.emptyKwh;
    else {
      const kwh = parseKwhInput(usageRaw, market.locale);
      if (kwh === null) e.usage = s.usageErrors.badKwh;
      else if (region) {
        const converted = billFromAnnualKwh(region, kwh);
        if (converted === null) e.usage = s.usageErrors.convert;
        else bill = converted;
      }
    }
    setErrors(e);
    if (e.region) return document.getElementById(`${px}-region`)?.focus(), null;
    if (e.usage) return document.getElementById(`${px}-usage`)?.focus(), null;
    if (e.offer) return document.getElementById(`${px}-offer`)?.focus(), null;
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
              regionName: s.regionName(region.name),
              locationName: loc.name,
              offerName: offer.name,
              battery,
              installLabel: installText,
              sources: runSources(props, runInput, install.installDate, battery, s.sources),
              chart: result.ok && result.annualUsageKwh > 0 ? engine.buildSavingsChart(engine.chartSource(result), fmt.symbol, s.chart) : null,
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
  const hint = s.regionHint(utilities.length);
  const helpUrl = s.regionHelpUrl ?? region?.avg_rate_per_kwh?.source_url ?? null;
  const horizonText = horizon ? s.horizonNote(longDate(horizon, market.locale)) : null;

  return (
    <div class="space-y-8">
      <form onSubmit={onSubmit} noValidate class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
        <fieldset disabled={busy} class="min-w-0 space-y-7">
          <legend class="sr-only">{s.formLegend}</legend>

          <div>
            <label for={`${px}-region`} class="block font-medium text-stone-900">{s.regionLabel}</label>
            <p id={`${px}-region-hint`} class="mt-1 text-sm text-stone-600">
              {hint.before}
              {hint.linkLabel !== '' && (helpUrl ? (
                <a href={helpUrl} rel="noopener" class="text-sun-ink underline underline-offset-2">{hint.linkLabel}</a>
              ) : (
                hint.linkLabel
              ))}
              {hint.after}
            </p>
            <select
              id={`${px}-region`}
              value={regionId}
              onChange={(e) => setRegionId(e.currentTarget.value)}
              aria-invalid={errors.region ? 'true' : 'false'}
              aria-describedby={errors.region ? `${px}-region-hint ${px}-region-error` : `${px}-region-hint`}
              class={inputCls}
            >
              <option value="">{s.regionPlaceholder}</option>
              {utilities.map((u) => (
                <option key={u.id} value={u.id}>
                  {s.regionName(u.name)}
                </option>
              ))}
            </select>
            {region?.rate_note && <p class="mt-2 text-sm text-stone-700">{region.rate_note}</p>}
            {errors.region && (
              <p id={`${px}-region-error`} role="alert" class="mt-2 text-sm font-medium text-red-800">
                {errors.region}
              </p>
            )}
          </div>

          <fieldset>
            <legend class="font-medium text-stone-900">{s.usageLegend}</legend>
            <div class="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ['bill', s.modeBill],
                  ['kwh', s.modeKwh],
                ] as const
              ).map(([v, label]) => (
                <label key={v} for={`${px}-mode-${v}`} class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50">
                  <input id={`${px}-mode-${v}`} type="radio" name={`${px}-mode`} value={v} checked={mode === v} onChange={() => setMode(v)} class="h-5 w-5 accent-amber-600" />
                  <span class="font-medium text-stone-900">{label}</span>
                </label>
              ))}
            </div>
            <label for={`${px}-usage`} class="mt-3 block font-medium text-stone-900">
              {mode === 'bill' ? s.usageLabelBill : s.usageLabelKwh}
            </label>
            <p id={`${px}-usage-hint`} class="mt-1 text-sm text-stone-600">
              {mode === 'bill' ? s.usageHintBill : s.usageHintKwh}
            </p>
            <div class="relative max-w-48">
              {mode === 'bill' && (
                <span class="pointer-events-none absolute left-3 top-1/2 mt-1 -translate-y-1/2 text-lg text-stone-600" aria-hidden="true">
                  {fmt.symbol}
                </span>
              )}
              <input
                id={`${px}-usage`}
                type="text"
                inputMode="decimal"
                value={usageRaw}
                onInput={(e) => setUsageRaw(e.currentTarget.value)}
                aria-invalid={errors.usage ? 'true' : 'false'}
                aria-describedby={errors.usage ? `${px}-usage-hint ${px}-usage-error` : `${px}-usage-hint`}
                class={`${inputCls} ${mode === 'bill' ? 'pl-7' : ''}`}
              />
            </div>
            {errors.usage && (
              <p id={`${px}-usage-error`} role="alert" class="mt-2 text-sm font-medium text-red-800">
                {errors.usage}
              </p>
            )}
          </fieldset>

          <RadioGroup legend={s.orientationLegend} name={`${px}-orientation`} options={s.orientations} value={orientation} onChange={setOrientation} />
          <RadioGroup legend={s.shadingLegend} name={`${px}-shading`} options={s.shadings} value={shading} onChange={setShading} />

          {periods.length > 0 && (
            <fieldset>
              <legend class="font-medium text-stone-900">{s.installLegend}</legend>
              <p class="mt-1 text-sm text-stone-600">{s.installHint}</p>
              <div class="mt-2 grid gap-2 sm:grid-cols-2">
                {periods.map((p, i) => (
                  <label key={p.id} for={`${px}-install-${p.id}`} class="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-stone-300 bg-white p-3 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50">
                    <input id={`${px}-install-${p.id}`} type="radio" name={`${px}-install`} value={p.id} checked={installId === p.id} onChange={() => setInstallId(p.id)} class="mt-1 h-5 w-5 accent-amber-600" />
                    <span>
                      <span class="block font-medium text-stone-900">{periodLabel(p, i, s, market.locale)}</span>
                      {p.solarVat !== null && <span class="block text-sm text-stone-600">{s.vatLine(pct.format(p.solarVat))}</span>}
                      {p.batteryRebatePerKwh !== null && <span class="block text-sm text-stone-600">{s.rebateLine(fmt.money(p.batteryRebatePerKwh))}</span>}
                    </span>
                  </label>
                ))}
              </div>
              {horizonText && <p class="mt-2 text-sm text-stone-700">{horizonText}</p>}
            </fieldset>
          )}

          <div>
            <label for={`${px}-offer`} class="block font-medium text-stone-900">{s.offerLabel}</label>
            <p id={`${px}-offer-hint`} class="mt-1 text-sm text-stone-600">
              {s.offerHint}
            </p>
            <select
              id={`${px}-offer`}
              value={offerId}
              onChange={(e) => setOfferId(e.currentTarget.value)}
              aria-invalid={errors.offer ? 'true' : 'false'}
              aria-describedby={errors.offer ? `${px}-offer-hint ${px}-offer-error` : `${px}-offer-hint`}
              class={inputCls}
            >
              <option value="">{s.offerPlaceholder}</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id} disabled={o.pence === null}>
                  {s.offerOption(o.name, o.pence !== null ? s.offerRate(o.pence) : null)}
                </option>
              ))}
            </select>
            {offer?.note && <p class="mt-2 text-sm text-stone-700">{offer.note}</p>}
            {errors.offer && (
              <p id={`${px}-offer-error`} role="alert" class="mt-2 text-sm font-medium text-red-800">
                {errors.offer}
              </p>
            )}
          </div>

          <fieldset>
            <legend class="font-medium text-stone-900">{s.batteryLegend}</legend>
            <div class="mt-2 grid gap-2 sm:grid-cols-2">
              <label for={`${px}-battery-0`} class="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-stone-300 bg-white p-3 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50">
                <input id={`${px}-battery-0`} type="radio" name={`${px}-battery`} checked={battery === 0} onChange={() => setBattery(0)} class="mt-1 h-5 w-5 accent-amber-600" />
                <span>
                  <span class="block font-medium text-stone-900">{s.noBattery.label}</span>
                  <span class="block text-sm text-stone-600">{s.noBattery.hint}</span>
                </span>
              </label>
              <label
                for={`${px}-battery-1`}
                class={`flex min-h-11 items-start gap-3 rounded-lg border border-stone-300 p-3 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50 ${batteryOk ? 'cursor-pointer bg-white' : 'cursor-not-allowed bg-stone-100'}`}
              >
                <input id={`${px}-battery-1`} type="radio" name={`${px}-battery`} checked={battery === 1} disabled={!batteryOk} onChange={() => setBattery(1)} class="mt-1 h-5 w-5 accent-amber-600" />
                <span>
                  <span class="block font-medium text-stone-900">{s.oneBattery.label}</span>
                  <span class="block text-sm text-stone-600">{batteryOk ? s.oneBattery.hintOk : s.oneBattery.hintNo}</span>
                </span>
              </label>
            </div>
          </fieldset>

          <div>
            <button type="submit" class={btnPrimary} disabled={busy}>
              {busy ? s.buttonBusy : outcome ? s.buttonUpdate : s.buttonSee}
            </button>
          </div>
        </fieldset>
      </form>

      <div aria-live="polite" class="sr-only">
        {busy ? s.liveBusy : ''}
      </div>

      {outcome && (
        <section aria-labelledby={`${px}-results-heading`} class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm motion-safe:animate-fade-in sm:p-8">
          <h2 ref={resultsRef} id={`${px}-results-heading`} tabIndex={-1} class="scroll-mt-4 text-2xl font-bold tracking-tight text-stone-900 focus:outline-none">
            {s.resultsHeading}
          </h2>
          {outcome.kind === 'no_production' && <p class="mt-4 text-stone-700">{s.noProduction}</p>}
          {outcome.kind === 'error' && <p class="mt-4 text-stone-700">{s.error}</p>}
          {outcome.kind === 'result' && !outcome.shown.result.ok && <p class="mt-4 text-stone-700">{outcome.shown.result.reason === 'missing_data' ? s.missingData : s.checkAnswers}</p>}
          {ok && ok.result.ok && <Results shown={ok} r={ok.result} fmt={fmt} s={s} locale={market.locale} />}
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

function Metric(p: { label: string; d: RangeDisplay; s: CalcStrings; note?: string; hero?: boolean; extra?: string; wide?: boolean }) {
  const value = p.hero ? 'text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl' : 'text-2xl font-bold text-stone-900';
  const box = p.hero ? 'rounded-xl border-2 border-sun-300 bg-white p-4' : 'rounded-xl border border-stone-200 bg-stone-50 p-4';
  return (
    <div class={p.wide ? `${box} col-span-2` : box}>
      <dt class="text-sm font-medium text-stone-700">{p.label}</dt>
      <dd class="mt-1">
        {p.d.kind === 'single' ? (
          <span class={value}>{p.d.value}</span>
        ) : (
          <>
            <span class={`block ${value}`}>
              <span class="sr-only">{p.s.likelySr}</span>
              {p.d.likely}
              <span class="ml-2 align-middle text-xs font-semibold uppercase tracking-wide text-sun-ink" aria-hidden="true">
                {p.s.likelyBadge}
              </span>
            </span>
            <span class="mt-1 block text-sm text-stone-700">{p.s.rangeWord(p.d.low, p.d.high)}</span>
          </>
        )}
        {p.note && <span class="mt-1 block text-xs text-stone-600">{p.note}</span>}
        {p.extra && <span class="mt-2 block border-t border-stone-200 pt-2 text-sm text-stone-800">{p.extra}</span>}
      </dd>
    </div>
  );
}

function Results(p: { shown: Shown; r: GlobalCalcSuccess; fmt: ReturnType<typeof moneyFormats>; s: CalcStrings; locale: string }) {
  const { shown, r, fmt, s, locale } = p;
  const noUsage = r.annualUsageKwh === 0;
  const hasIncentive = r.incentivesApplied.length > 0;
  const size = displayRange(r.size, (kw) => formatKwLocale(kw, locale));
  const sizeText = size.kind === 'single' ? size.value : s.systemSizeText(size.likely, size.low, size.high);
  return (
    <div>
      <p class="mt-2 text-stone-700">{s.summary({ region: shown.regionName, offer: shown.offerName, install: shown.installLabel, battery: shown.battery > 0 })}</p>
      {!noUsage && (
        <dl class="mt-4 grid grid-cols-2 gap-3">
          <Metric hero s={s} label={s.metrics.payback} d={paybackText(r.paybackYears, r.analysisYears, s.years, locale)} note={s.metrics.paybackNote} />
          <Metric hero s={s} label={s.metrics.netSavings(r.analysisYears)} d={displayRange(r.netSavings25, fmt.signed)} note={s.metrics.netSavingsNote} />
          <Metric s={s} label={s.metrics.upfront} d={displayRange(r.cost, fmt.money)} note={s.metrics.upfrontNote(hasIncentive)} extra={`${s.metrics.systemSize}: ${sizeText}`} />
          <Metric s={s} label={s.metrics.year1} d={displayRange(r.year1Savings, fmt.money)} note={s.metrics.year1Note} />
          {hasIncentive && <Metric wide s={s} label={s.metrics.rebate} d={displayRange(r.upfrontIncentive, fmt.money)} note={s.metrics.rebateNote} />}
        </dl>
      )}
      <p class="mt-3 text-sm text-stone-700">{s.grantNote(r.incentivesApplied.map((i) => i.name))}</p>
      <p class="mt-1 text-sm text-stone-700">{s.yieldNote(shown.locationName)}</p>
      {s.secondaryCostNote && <p class="mt-1 text-sm text-stone-700">{s.secondaryCostNote}</p>}

      {r.warnings.length > 0 && (
        <div class="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <h3 class="font-semibold text-stone-900">{s.warningsHeading}</h3>
          <ul class="mt-1 list-disc space-y-1 pl-5 text-stone-800">
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {shown.chart && <SavingsChart chart={shown.chart} years={r.analysisYears} money={fmt.money} text={s.chartText} />}

      <details class="mt-6 rounded-lg border border-stone-200 bg-white">
        <summary class="min-h-11 cursor-pointer px-4 py-3 font-semibold text-stone-900">{s.assumptionsSummary(r.assumptions.length)}</summary>
        <ul class="list-disc space-y-2 px-4 pb-4 pl-9 text-sm leading-6 text-stone-700">
          {r.assumptions.map((a) => (
            <li key={a} class="break-words" lang={locale.startsWith('en') ? undefined : 'en'}>
              {a}
            </li>
          ))}
        </ul>
      </details>

      <details class="mt-4 rounded-lg border border-stone-200 bg-white">
        <summary class="min-h-11 cursor-pointer px-4 py-3 font-semibold text-stone-900">{s.sourcesSummary(shown.sources.length)}</summary>
        <ul class="list-disc space-y-2 px-4 pb-4 pl-9 text-sm leading-6 text-stone-700">
          {shown.sources.map((src) => (
            <li key={src.url + src.label} class="break-words">
              <a href={src.url} rel="noopener" class="text-sun-ink underline underline-offset-2">
                {src.label}
              </a>
              {s.sourceChecked(src.verifiedOn)}
            </li>
          ))}
        </ul>
      </details>

      <p class="mt-4 text-sm text-stone-700">
        {s.disclaimer.before}
        <a href="/methodology" class="text-sun-ink underline underline-offset-2">{s.disclaimer.link}</a>
        {s.disclaimer.after}
      </p>
      <p class="mt-4">
        <button type="button" class={btnSecondary} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          {s.changeAnswers}
        </button>
        <button type="button" class={btnText} onClick={() => window.location.reload()}>
          {s.startOver}
        </button>
      </p>
    </div>
  );
}
