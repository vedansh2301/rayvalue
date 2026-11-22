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
import { btnSecondary, btnText } from '../ui/buttons';
import { COMPASS_DEG, USAGE_SLIDER, answeredCount, progressPct, rateBarPct, regionDot, sliderPosition } from '../../lib/calculator/design';
import SavingsChart from './SavingsChart';
import EmailSignup from '../subscribe/EmailSignup';
import { signupText, type SignupCountry } from '../../lib/i18n/signup';
import { zeroVatDaysLeft, zeroVatEnd } from '../../lib/calculator/design';

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
  /** The answers behind this estimate (inputs only, no figures), for the "email me this estimate" link back. */
  params: Record<string, string>;
  chart: ReturnType<typeof import('../../lib/calc/chart').buildSavingsChart>;
}
type Outcome = { kind: 'result'; shown: Shown } | { kind: 'no_production' } | { kind: 'error' };

interface Errors {
  region?: string;
  usage?: string;
  roof?: string;
  shade?: string;
  install?: string;
  offer?: string;
}

/** The island's props: the market rows, plus the UK outline path (drawn by the page from the outline library) for the region map. */
export type CalculatorIslandProps = UkCalculatorProps & { mapOutline?: string };

const inputCls = 'mt-2 block min-h-11 w-full rounded-lg border border-sky-pastel-400 bg-white px-3 py-2 text-lg text-stone-900 aria-[invalid=true]:border-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900';

export default function CalculatorIntl(props: CalculatorIslandProps) {
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
  const [orientation, setOrientation] = useState<Orientation | null>(null);
  const [shading, setShading] = useState<Shading | null>(null);
  const [installId, setInstallId] = useState('');
  const [offerId, setOfferId] = useState('');
  const [battery, setBattery] = useState<UkBattery>(0);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const focusResults = useRef(false);
  const runs = useRef(createRunGuard()).current;

  const periodIndex = periods.findIndex((p) => p.id === installId);
  const install = periodIndex >= 0 ? periods[periodIndex] : undefined;
  const installText = install ? periodLabel(install, periodIndex, s, market.locale) : '';
  const offers = exportOffers(props.exportPolicies, install?.installDate ?? props.today);
  const offer = offers.find((o) => o.id === offerId);
  const region = utilities.find((u) => u.id === regionId);

  // Query parameters prefill the form: ?bill= and ?battery=1 from the home-page report, and every answer (region, bill or kwh,
  // battery, roof, shade, install, offer) from the "email me this estimate" link. A link with a complete, valid set of
  // answers runs the estimate straight away. Unknown or stale values are ignored.
  const autoRun = useRef(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const b = Number(q.get('bill'));
    const hasBill = !!q.get('bill') && Number.isFinite(b) && b > 0 && b <= maxBill;
    if (hasBill) { setMode('bill'); setUsageRaw(String(b % 1 === 0 ? Math.round(b) : b)); }
    const kwh = Number(q.get('kwh'));
    const hasKwh = !hasBill && !!q.get('kwh') && Number.isFinite(kwh) && kwh > 0 && kwh <= 1_000_000;
    if (hasKwh) { setMode('kwh'); setUsageRaw(String(kwh)); }
    if (q.get('battery') === '1' && batteryOk) setBattery(1);
    const r = utilities.find((u) => u.id === q.get('region'));
    if (r) setRegionId(r.id);
    const roof = s.orientations.find((o) => o.value === q.get('roof'));
    if (roof) setOrientation(roof.value);
    const shade = s.shadings.find((o) => o.value === q.get('shade'));
    if (shade) setShading(shade.value);
    const inst = periods.find((x) => x.id === q.get('install'));
    if (inst) setInstallId(inst.id);
    const o = exportOffers(props.exportPolicies, inst?.installDate ?? props.today).find((x) => x.id === q.get('offer') && x.pence !== null);
    if (o) setOfferId(o.id);
    autoRun.current = !!(r && (hasBill || hasKwh) && roof && shade && o && (periods.length === 0 || inst));
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
    if (!orientation) e.roof = s.ui.chooseOne;
    if (!shading) e.shade = s.ui.chooseOne;
    if (periods.length > 0 && !install) e.install = s.ui.chooseOne;
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
    if (e.roof) return document.getElementById(`${px}-q-roof`)?.focus(), null;
    if (e.shade) return document.getElementById(`${px}-q-shade`)?.focus(), null;
    if (e.install) return document.getElementById(`${px}-q-install`)?.focus(), null;
    if (e.offer) return document.getElementById(`${px}-offer`)?.focus(), null;
    return { bill };
  }

  async function run(bill: number) {
    if (!region || !offer || !install || !orientation || !shading) return;
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
              params: {
                region: region.id,
                ...(mode === 'bill' ? { bill: String(bill) } : { kwh: String(parseKwhInput(usageRaw, market.locale) ?? '') }),
                battery: String(battery),
                roof: orientation,
                shade: shading,
                ...(periods.length > 0 ? { install: install.id } : {}),
                offer: offer.id,
              },
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

  // Usage as typed (for the big value box and the slider thumb); formatting only.
  const parsedUsage = mode === 'bill' ? (() => { const b = parseMoneyInput(usageRaw, market.locale, maxBill); return b.ok ? b.value : null; })() : parseKwhInput(usageRaw, market.locale);
  const bigValue = parsedUsage === null ? '—' : mode === 'bill' ? new Intl.NumberFormat(market.locale, { style: 'currency', currency: market.currency, maximumFractionDigits: parsedUsage % 1 === 0 ? 0 : 2 }).format(parsedUsage) : new Intl.NumberFormat(market.locale).format(parsedUsage);
  const range = USAGE_SLIDER[mode];
  const hasMap = market.code === 'GB' && !!props.mapOutline && utilities.every((u) => regionDot(s.regionName(u.name)) !== null);
  const progress = answeredCount({ region: !!region, usage: parsedUsage !== null, roof: !!orientation, shade: !!shading, install: periods.length > 0 ? !!install : null, offer: !!offer && offer.pence !== null });
  const ready = progress.done === progress.total;
  useEffect(() => {
    if (!autoRun.current || !ready) return;
    autoRun.current = false;
    const v = validate();
    if (v) void run(v.bill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const maxPence = Math.max(0, ...offers.map((o) => o.pence ?? 0));
  const orientationLabel = s.orientations.find((o) => o.value === orientation)?.label;
  const shadingLabel = s.shadings.find((o) => o.value === shading)?.label;
  const none = '—';
  const summaryRows: [string, string | null][] = [
    [s.ui.summary.region, region ? s.regionName(region.name) : null],
    [s.ui.summary.usage, parsedUsage !== null ? `${bigValue} ${mode === 'bill' ? s.ui.perMonth : s.ui.perYear}` : null],
    [s.ui.summary.roof, orientationLabel ?? null],
    [s.ui.summary.shade, shadingLabel ?? null],
    ...(periods.length > 0 ? [[s.ui.summary.install, install ? installText : null] as [string, string | null]] : []),
    [s.ui.summary.offer, offer && offer.pence !== null ? s.offerRate(offer.pence) : null],
    [s.ui.summary.battery, battery === 1 ? s.oneBattery.label : s.noBattery.label],
  ];
  const cardCls = 'rounded-[20px] border border-sky-pastel-300 bg-white p-5 sm:p-6';
  const choiceCls = 'relative flex cursor-pointer flex-col items-start gap-2 rounded-[14px] border border-stone-300 bg-white p-3.5 text-left transition-colors has-[:checked]:border-2 has-[:checked]:border-sun-500 has-[:checked]:bg-sun-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-stone-900 hover:border-sky-pastel-600 has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-stone-100';
  const err = (id: string, msg?: string) => (msg ? <p id={id} role="alert" class="mt-2 text-sm font-medium text-red-800">{msg}</p> : null);

  return (
    <div id={`${px}-calc`}>
      <form onSubmit={onSubmit} noValidate aria-label={s.formLegend}>
        <fieldset disabled={busy} class="min-w-0 border-0 p-0">
          <legend class="sr-only">{s.formLegend}</legend>
          <div class="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <h2 class="font-display-tight text-[clamp(1.75rem,3.2vw,2.5rem)] leading-tight text-stone-900">{s.ui.sectionHeading}</h2>
            <div class="flex items-center gap-3 text-sm font-semibold text-stone-800">
              <span aria-live="polite">{s.ui.answered(progress.done, progress.total)}</span>
              <svg class="block h-2 w-36" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect width="100" height="8" rx="4" fill="#d6e8f8" /><rect width={progressPct(progress.done, progress.total)} height="8" rx="4" fill="#fbbf24" /></svg>
            </div>
          </div>

          <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div class="flex min-w-0 flex-col gap-4">
              {/* 1 region */}
              <div class={`${cardCls} grid gap-5 ${hasMap ? 'md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]' : ''}`}>
                <div class="flex flex-col gap-2">
                  <QTitle n={1} done={!!region} title={s.regionLabel} />
                  <p id={`${px}-region-hint`} class="text-sm leading-relaxed text-stone-700">
                    {hint.before}
                    {hint.linkLabel !== '' && (helpUrl ? <a href={helpUrl} rel="noopener" class="text-sun-ink underline underline-offset-2">{hint.linkLabel}</a> : hint.linkLabel)}
                    {hint.after}
                  </p>
                  <select id={`${px}-region`} value={regionId} onChange={(e) => setRegionId(e.currentTarget.value)} aria-invalid={errors.region ? 'true' : 'false'} aria-describedby={errors.region ? `${px}-region-hint ${px}-region-error` : `${px}-region-hint`} class={inputCls}>
                    <option value="">{s.regionPlaceholder}</option>
                    {utilities.map((u) => <option key={u.id} value={u.id}>{s.regionName(u.name)}</option>)}
                  </select>
                  {hasMap && s.ui.mapHint && <span class="text-sm text-stone-700">{s.ui.mapHint}</span>}
                  {region?.rate_note && <p class="text-sm text-stone-700">{region.rate_note}</p>}
                  {err(`${px}-region-error`, errors.region)}
                </div>
                {hasMap && (
                  <div class="relative mx-auto w-full max-w-64 rounded-2xl bg-sky-pastel-50 p-3">
                    <svg viewBox="-4 -2 71 104" class="block h-auto w-full" role="group" aria-label={s.regionLabel}>
                      <path d={props.mapOutline} fill="#ffffff" stroke="#5f8fbd" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
                      {utilities.map((u) => {
                        const d = regionDot(s.regionName(u.name))!;
                        const on = u.id === regionId;
                        const pick = () => setRegionId(u.id);
                        return (
                          <g key={u.id} role="button" tabIndex={0} aria-label={s.regionName(u.name)} aria-pressed={on} onClick={pick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }} class="cursor-pointer outline-none [&:focus-visible>circle:last-child]:stroke-stone-900">
                            <circle cx={d[0]} cy={d[1]} r="5" fill="transparent" />
                            {on && <circle cx={d[0]} cy={d[1]} r="3.6" fill="#f59e0b" class="rv-ping" />}
                            <circle cx={d[0]} cy={d[1]} r={on ? 3.6 : 2.2} fill={on ? '#f59e0b' : '#9ec5e8'} stroke="#ffffff" stroke-width="0.8" />
                          </g>
                        );
                      })}
                    </svg>
                    {region && <span class="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-sun-400 px-2.5 py-0.5 text-xs font-bold text-stone-900">{s.regionName(region.name)}</span>}
                  </div>
                )}
              </div>

              {/* 2 usage */}
              <div class={cardCls}>
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <QTitle n={2} done={parsedUsage !== null} title={s.usageLegend} />
                  <div class="flex gap-1 rounded-full bg-sky-pastel-100 p-1" role="group" aria-label={s.usageLegend}>
                    {([['bill', s.modeBill], ['kwh', s.modeKwh]] as const).map(([v, label]) => (
                      <button key={v} type="button" aria-pressed={mode === v} onClick={() => { setMode(v); setUsageRaw(''); }} class="min-h-10 rounded-full px-4 text-sm font-semibold text-stone-900 aria-pressed:bg-sun-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900">{label}</button>
                    ))}
                  </div>
                </div>
                <div class="mt-4 grid items-center gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
                  <div class="flex flex-col gap-2">
                    <label for={`${px}-usage`} class="text-sm font-semibold text-stone-900">{mode === 'bill' ? s.usageLabelBill : s.usageLabelKwh}</label>
                    <p id={`${px}-usage-hint`} class="text-sm text-stone-700">{mode === 'bill' ? s.usageHintBill : s.usageHintKwh} {s.ui.usageHint}</p>
                    <input type="range" aria-label={mode === 'bill' ? s.usageLabelBill : s.usageLabelKwh} min={range.min} max={range.max} step={range.step} value={sliderPosition(mode, parsedUsage)} onInput={(e) => setUsageRaw(e.currentTarget.value)} class="rv-range h-8 w-full" />
                    <div class="flex justify-between text-xs text-stone-700" aria-hidden="true"><span>{mode === 'bill' ? fmt.money(range.min) : new Intl.NumberFormat(market.locale).format(range.min)}</span><span>{mode === 'bill' ? fmt.money(range.max) : new Intl.NumberFormat(market.locale).format(range.max)}</span></div>
                    <input id={`${px}-usage`} type="text" inputMode="decimal" value={usageRaw} placeholder={mode === 'bill' ? fmt.symbol : 'kWh'} onInput={(e) => setUsageRaw(e.currentTarget.value)} aria-invalid={errors.usage ? 'true' : 'false'} aria-describedby={errors.usage ? `${px}-usage-hint ${px}-usage-error` : `${px}-usage-hint`} class={`${inputCls} max-w-48`} />
                    {err(`${px}-usage-error`, errors.usage)}
                  </div>
                  <div class="rounded-2xl bg-sun-100 px-4 py-5 text-center" aria-hidden="true">
                    <div class="font-display-tight text-[2.25rem] leading-none text-stone-900">{bigValue}</div>
                    <div class="mt-1 text-sm font-semibold text-stone-800">{mode === 'bill' ? s.ui.perMonth : s.ui.perYear}</div>
                  </div>
                </div>
              </div>

              {/* 3 roof, 4 shade */}
              <div class="grid gap-4 md:grid-cols-2">
                <div class={cardCls}>
                  <QTitle n={3} done={!!orientation} title={s.orientationLegend} />
                  <fieldset id={`${px}-q-roof`} tabIndex={-1} class="mt-3 grid grid-cols-3 gap-2 outline-none" aria-describedby={errors.roof ? `${px}-roof-error` : undefined}>
                    <legend class="sr-only">{s.orientationLegend}</legend>
                    {s.orientations.map((o) => (
                      <label key={o.value} for={`${px}-orientation-${o.value}`} class={choiceCls}>
                        <input id={`${px}-orientation-${o.value}`} type="radio" name={`${px}-orientation`} value={o.value} checked={orientation === o.value} onChange={() => setOrientation(o.value)} class="sr-only" />
                        <svg viewBox="0 0 48 48" class="size-12" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="21" fill="#f3f9fe" stroke="#bfd9f1" stroke-width="1.5" /><g transform={`rotate(${COMPASS_DEG[o.value]} 24 24)`}><path d="M24 6l5 18h-10z" fill="#f59e0b" /><path d="M24 42l5-18h-10z" fill="#bfd9f1" /></g><circle cx="24" cy="24" r="2.5" fill="#1c1917" /></svg>
                        <strong class="text-[15px] leading-tight text-stone-900">{o.label}</strong><span class="text-xs leading-snug text-stone-700">{o.hint}</span>
                      </label>
                    ))}
                  </fieldset>
                  {err(`${px}-roof-error`, errors.roof)}
                </div>
                <div class={cardCls}>
                  <QTitle n={4} done={!!shading} title={s.shadingLegend} />
                  <fieldset id={`${px}-q-shade`} tabIndex={-1} class="mt-3 grid grid-cols-3 gap-2 outline-none" aria-describedby={errors.shade ? `${px}-shade-error` : undefined}>
                    <legend class="sr-only">{s.shadingLegend}</legend>
                    {s.shadings.map((o, i) => (
                      <label key={o.value} for={`${px}-shading-${o.value}`} class={choiceCls}>
                        <input id={`${px}-shading-${o.value}`} type="radio" name={`${px}-shading`} value={o.value} checked={shading === o.value} onChange={() => setShading(o.value)} class="sr-only" />
                        <svg viewBox="0 0 48 48" class="size-12" aria-hidden="true" focusable="false"><circle cx="34" cy="13" r="7" fill="#fbbf24" /><path d="M6 40l12-12 12 12z" fill="#d6e8f8" stroke="#5f8fbd" stroke-width="1.2" /><rect x="10" y="33" width="16" height="2.5" fill="#5f8fbd" /><g opacity={i === 0 ? 0 : 1}><circle cx="38" cy="27" r={i === 1 ? 5 : 8} fill="#9ec5e8" /><rect x="37" y="31" width="2" height="10" fill="#5f8fbd" /></g></svg>
                        <strong class="text-[15px] leading-tight text-stone-900">{o.label}</strong><span class="text-xs leading-snug text-stone-700">{o.hint}</span>
                      </label>
                    ))}
                  </fieldset>
                  {err(`${px}-shade-error`, errors.shade)}
                </div>
              </div>

              {/* 5 install date */}
              {periods.length > 0 && (
                <div class={cardCls}>
                  <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1"><QTitle n={5} done={!!install} title={s.installLegend} /></div>
                  <p class="mt-1 text-sm text-stone-700">{s.installHint}</p>
                  <fieldset id={`${px}-q-install`} tabIndex={-1} class="mt-3 grid gap-2 outline-none sm:grid-cols-2" aria-describedby={errors.install ? `${px}-install-error` : undefined}>
                    <legend class="sr-only">{s.installLegend}</legend>
                    {periods.map((p, i) => {
                      const chip = p.solarVat !== null ? pct.format(p.solarVat) : p.batteryRebatePerKwh !== null ? fmt.money(p.batteryRebatePerKwh) : String(i + 1);
                      return (
                        <label key={p.id} for={`${px}-install-${p.id}`} class={`${choiceCls} flex-row items-start gap-3`}>
                          <input id={`${px}-install-${p.id}`} type="radio" name={`${px}-install`} value={p.id} checked={installId === p.id} onChange={() => setInstallId(p.id)} class="sr-only" />
                          <span class={`flex min-h-12 min-w-14 items-center justify-center rounded-xl px-2 font-display-tight text-xl text-stone-900 ${i === 0 ? 'bg-sun-400' : 'bg-sky-pastel-100'}`}>{chip}</span>
                          <span class="flex flex-col gap-0.5">
                            <strong class="text-[15px] leading-tight text-stone-900">{periodLabel(p, i, s, market.locale)}</strong>
                            {p.solarVat !== null && <span class="text-sm text-stone-700">{s.vatLine(pct.format(p.solarVat))}</span>}
                            {p.batteryRebatePerKwh !== null && <span class="text-sm text-stone-700">{s.rebateLine(fmt.money(p.batteryRebatePerKwh))}</span>}
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                  {horizonText && <p class="mt-2 text-sm text-stone-700">{horizonText}</p>}
                  {err(`${px}-install-error`, errors.install)}
                </div>
              )}

              {/* 6 export offer */}
              <div class={cardCls}>
                <QTitle n={periods.length > 0 ? 6 : 5} done={!!offer && offer.pence !== null} title={s.offerLabel} />
                <p id={`${px}-offer-hint`} class="mt-2 text-sm leading-relaxed text-stone-700">{s.offerHint}</p>
                <fieldset id={`${px}-offer`} tabIndex={-1} class="mt-3 grid gap-2 outline-none sm:grid-cols-2" aria-describedby={errors.offer ? `${px}-offer-hint ${px}-offer-error` : `${px}-offer-hint`}>
                  <legend class="sr-only">{s.offerLabel}</legend>
                  {offers.map((o) => (
                    <label key={o.id} for={`${px}-offer-${o.id}`} class={choiceCls}>
                      <input id={`${px}-offer-${o.id}`} type="radio" name={`${px}-offer`} value={o.id} checked={offerId === o.id} disabled={o.pence === null} onChange={() => setOfferId(o.id)} class="sr-only" />
                      <span class="text-sm font-semibold leading-snug text-stone-900">{o.name}</span>
                      <span class="font-display-tight text-2xl leading-none text-stone-900">{o.pence !== null ? s.offerRate(o.pence) : none}</span>
                      <svg class="block h-1.5 w-full" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect width="100" height="6" rx="3" fill="#e6f1fb" /><rect width={rateBarPct(o.pence, maxPence)} height="6" rx="3" fill={offerId === o.id ? '#f59e0b' : '#9ec5e8'} /></svg>
                    </label>
                  ))}
                </fieldset>
                {offer?.note && <p class="mt-2 text-sm text-stone-700">{offer.note}</p>}
                {err(`${px}-offer-error`, errors.offer)}
              </div>

              {/* battery */}
              <div class={cardCls}>
                <strong class="text-lg text-stone-900">{s.ui.battery}</strong>
                <fieldset class="mt-3 grid gap-2 sm:grid-cols-2">
                  <legend class="sr-only">{s.batteryLegend}</legend>
                  {([[0, s.noBattery.label, s.noBattery.hint, true], [1, s.oneBattery.label, batteryOk ? s.oneBattery.hintOk : s.oneBattery.hintNo, batteryOk]] as const).map(([v, label, sub, enabled]) => (
                    <label key={v} for={`${px}-battery-${v}`} class={`${choiceCls} flex-row items-center gap-3`}>
                      <input id={`${px}-battery-${v}`} type="radio" name={`${px}-battery`} checked={battery === v} disabled={!enabled} onChange={() => setBattery(v)} class="sr-only" />
                      <svg viewBox="0 0 48 48" class="size-12 flex-none" aria-hidden="true" focusable="false"><rect x="8" y="10" width="28" height="30" rx="5" fill="#f3f9fe" stroke="#5f8fbd" stroke-width="1.6" /><rect x="18" y="6" width="8" height="5" rx="1.5" fill="#5f8fbd" /><rect x="12" y={v === 1 ? 16 : 28} width="20" height={v === 1 ? 20 : 8} rx="2.5" fill="#fbbf24" /></svg>
                      <span class="flex flex-col gap-0.5"><strong class="text-[15px] text-stone-900">{label}</strong><span class="text-sm text-stone-700">{sub}</span></span>
                    </label>
                  ))}
                </fieldset>
              </div>
            </div>

            <aside class="flex flex-col gap-3 lg:sticky lg:top-24" aria-label={s.ui.yourEstimate}>
              <div class="flex flex-col gap-3.5 rounded-[20px] border border-sky-pastel-300 bg-white p-5 shadow-[0_18px_40px_-26px_rgba(95,143,189,0.7)]">
                <div class="flex items-center gap-3">
                  <svg width="38" height="38" viewBox="0 0 32 32" aria-hidden="true" focusable="false" class="motion-safe:animate-sun-slow"><g stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round"><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8" /></g><circle cx="16" cy="16" r="7" fill="#fbbf24" /></svg>
                  <div class="flex flex-col"><strong class="font-display-tight text-xl text-stone-900">{s.ui.yourEstimate}</strong><span class="text-sm text-stone-700">{ready ? s.ui.ready : s.ui.toGo(progress.total - progress.done)}</span></div>
                </div>
                <ul class="flex flex-col divide-y divide-stone-200 text-sm">
                  {summaryRows.map(([label, value]) => (
                    <li key={label} class="flex justify-between gap-3 py-2"><span class="text-stone-700">{label}</span><strong class={value ? 'text-right text-stone-900' : 'text-stone-600'}>{value ?? none}</strong></li>
                  ))}
                </ul>
                <div class="flex flex-col gap-2">
                  <button type="submit" disabled={busy} class={`inline-flex min-h-12 items-center justify-center rounded-lg bg-sun-400 px-5 font-bold text-stone-900 hover:bg-sun-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:cursor-not-allowed ${ready ? '' : 'opacity-70'}`}>
                    {busy ? s.buttonBusy : outcome ? s.buttonUpdate : s.buttonSee} <span aria-hidden="true">&rarr;</span>
                  </button>
                  <span class="text-sm text-stone-700">{ready ? s.ui.hintFree : s.ui.hintRemaining}</span>
                </div>
              </div>
              {market.code === 'GB' && <VatCard props={props} />}
            </aside>
          </div>
        </fieldset>
      </form>

      <div aria-live="polite" class="sr-only">{busy ? s.liveBusy : ''}</div>

      {outcome && (
        <section aria-labelledby={`${px}-results-heading`} class="mt-10 rounded-[24px] border border-sky-pastel-300 bg-sky-pastel-50 p-5 motion-safe:animate-fade-in sm:p-8">
          <h2 ref={resultsRef} id={`${px}-results-heading`} tabIndex={-1} class="scroll-mt-28 font-display-tight text-[clamp(1.75rem,3.2vw,2.5rem)] leading-tight text-stone-900 focus:outline-none">{s.resultsHeading}</h2>
          {outcome.kind === 'no_production' && <p class="mt-4 text-stone-700">{s.noProduction}</p>}
          {outcome.kind === 'error' && <p class="mt-4 text-stone-700">{s.error}</p>}
          {outcome.kind === 'result' && !outcome.shown.result.ok && <p class="mt-4 text-stone-700">{outcome.shown.result.reason === 'missing_data' ? s.missingData : s.checkAnswers}</p>}
          {ok && ok.result.ok && <Results shown={ok} r={ok.result} fmt={fmt} s={s} locale={market.locale} country={market.code as SignupCountry} px={px} />}
        </section>
      )}
    </div>
  );
}

function QTitle(p: { n: number; done: boolean; title: string }) {
  return (
    <div class="flex items-center gap-3">
      <span class={`flex size-8 flex-none items-center justify-center rounded-full font-display-tight text-base text-stone-900 ${p.done ? 'bg-sun-400' : 'bg-sky-pastel-100'}`} aria-hidden="true">{p.n}</span>
      <strong class="text-lg leading-snug text-stone-900">{p.title}</strong>
    </div>
  );
}

/** UK only: the live "days of 0% VAT left" card, from the vat_rates rows. */
function VatCard({ props }: { props: CalculatorIslandProps }) {
  const days = zeroVatDaysLeft(props.vatRates, props.today);
  const end = zeroVatEnd(props.vatRates, props.today);
  if (days === null || end === null) return null;
  return (
    <a href="/uk/guides/solar-panels-vat-deadline-2027" class="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 rounded-[18px] border border-sun-200 bg-sun-100 p-3.5 text-stone-900 no-underline hover:shadow-[0_10px_24px_-14px_rgba(146,64,14,0.5)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900" data-track="nav_click" data-track-placement="uk_calc_vat" data-track-target="/uk/guides/solar-panels-vat-deadline-2027">
      <span class="font-display-tight text-center text-[2.25rem] leading-none">{days}</span>
      <span class="text-sm"><strong class="block text-base">days of 0% VAT left</strong>0% VAT on solar installs until {longDate(end, props.market.locale)}</span>
    </a>
  );
}

function Metric(p: { label: string; d: RangeDisplay; s: CalcStrings; note?: string; tone?: 'sun' | 'plain'; extra?: string }) {
  const value = 'font-display-tight text-[clamp(1.75rem,3.4vw,2.5rem)] leading-tight text-stone-900';
  const box = p.tone === 'sun' ? 'rounded-[18px] border border-sun-200 bg-sun-100 p-5' : 'rounded-[18px] border border-sky-pastel-300 bg-white p-5';
  return (
    <div class={box}>
      <dt class="text-sm font-semibold text-stone-800">{p.label}</dt>
      <dd class="mt-1">
        {p.d.kind === 'single' ? (
          <span class={value}>{p.d.value}</span>
        ) : (
          <>
            <span class={`block ${value}`}>
              <span class="sr-only">{p.s.likelySr}</span>
              {p.d.likely}
              <span class="ml-2 align-middle font-sans text-xs font-bold uppercase tracking-wide text-sun-ink" aria-hidden="true">{p.s.likelyBadge}</span>
            </span>
            <span class="mt-1 block text-sm text-stone-800">{p.s.rangeWord(p.d.low, p.d.high)}</span>
          </>
        )}
        {p.note && <span class="mt-1 block text-xs text-stone-700">{p.note}</span>}
        {p.extra && <span class="mt-2 block border-t border-stone-200 pt-2 text-sm text-stone-800">{p.extra}</span>}
      </dd>
    </div>
  );
}

function Results(p: { shown: Shown; r: GlobalCalcSuccess; fmt: ReturnType<typeof moneyFormats>; s: CalcStrings; locale: string; country: SignupCountry; px: string }) {
  const { shown, r, fmt, s, locale } = p;
  const noUsage = r.annualUsageKwh === 0;
  const hasIncentive = r.incentivesApplied.length > 0;
  const size = displayRange(r.size, (kw) => formatKwLocale(kw, locale));
  const sizeText = size.kind === 'single' ? size.value : s.systemSizeText(size.likely, size.low, size.high);
  return (
    <div>
      <p class="mt-2 text-stone-800">{s.summary({ region: shown.regionName, offer: shown.offerName, install: shown.installLabel, battery: shown.battery > 0 })}</p>
      {!noUsage && (
        <dl class="mt-5 grid gap-3 sm:grid-cols-3">
          <Metric tone="sun" s={s} label={s.metrics.payback} d={paybackText(r.paybackYears, r.analysisYears, s.years, locale)} note={s.metrics.paybackNote} />
          <Metric s={s} label={s.metrics.netSavings(r.analysisYears)} d={displayRange(r.netSavings25, fmt.signed)} note={s.metrics.netSavingsNote} />
          <Metric s={s} label={s.metrics.systemSize} d={size} note={size.kind === 'single' ? undefined : sizeText} />
          <Metric s={s} label={s.metrics.upfront} d={displayRange(r.cost, fmt.money)} note={s.metrics.upfrontNote(hasIncentive)} />
          <Metric s={s} label={s.metrics.year1} d={displayRange(r.year1Savings, fmt.money)} note={s.metrics.year1Note} />
          {hasIncentive && <Metric s={s} label={s.metrics.rebate} d={displayRange(r.upfrontIncentive, fmt.money)} note={s.metrics.rebateNote} />}
        </dl>
      )}
      <p class="mt-4 text-sm text-stone-800">{s.grantNote(r.incentivesApplied.map((i) => i.name))}</p>
      <p class="mt-1 text-sm text-stone-800">{s.yieldNote(shown.locationName)}</p>
      {s.secondaryCostNote && <p class="mt-1 text-sm text-stone-800">{s.secondaryCostNote}</p>}

      {r.warnings.length > 0 && (
        <div class="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <h3 class="font-semibold text-stone-900">{s.warningsHeading}</h3>
          <ul class="mt-1 list-disc space-y-1 pl-5 text-stone-800">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {shown.chart && <div class="mt-5 rounded-[18px] border border-sky-pastel-300 bg-white p-4"><SavingsChart chart={shown.chart} years={r.analysisYears} money={fmt.money} text={s.chartText} /></div>}

      <div class="mt-5 grid items-center gap-4 rounded-[18px] bg-sun-100 p-5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <strong class="font-display-tight text-xl text-stone-900">{s.ui.nextTitle}</strong>
        <a href={s.ui.guidesHref} class="inline-flex min-h-11 items-center justify-center rounded-lg bg-stone-900 px-5 font-bold text-sun-100 no-underline hover:bg-stone-800 hover:text-sun-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900" data-track="nav_click" data-track-placement="calc_next" data-track-target={s.ui.guidesHref}>{s.ui.nextCta} &rarr;</a>
      </div>

      <section aria-labelledby={`${p.px}-email-heading`} class="mt-5 rounded-[18px] border border-sky-pastel-300 bg-white p-5">
        <h3 id={`${p.px}-email-heading`} class="font-display-tight text-xl text-stone-900">{signupText(locale).estimateBox.heading}</h3>
        <p class="mb-4 mt-1 max-w-[60ch] text-sm leading-6 text-stone-700">{signupText(locale).estimateBox.sub}</p>
        <EmailSignup id={`${p.px}-email`} lang={locale} mode="estimate" country={p.country} source={`${p.px}-calculator`} region={shown.params.region} params={shown.params} />
      </section>

      <details class="mt-6 rounded-lg border border-sky-pastel-300 bg-white">
        <summary class="min-h-11 cursor-pointer px-4 py-3 font-semibold text-stone-900">{s.assumptionsSummary(r.assumptions.length)}</summary>
        <ul class="list-disc space-y-2 px-4 pb-4 pl-9 text-sm leading-6 text-stone-700">
          {r.assumptions.map((a) => <li key={a} class="break-words" lang={locale.startsWith('en') ? undefined : 'en'}>{a}</li>)}
        </ul>
      </details>

      <details class="mt-4 rounded-lg border border-sky-pastel-300 bg-white">
        <summary class="min-h-11 cursor-pointer px-4 py-3 font-semibold text-stone-900">{s.sourcesSummary(shown.sources.length)}</summary>
        <ul class="list-disc space-y-2 px-4 pb-4 pl-9 text-sm leading-6 text-stone-700">
          {shown.sources.map((src) => (
            <li key={src.url + src.label} class="break-words">
              <a href={src.url} rel="noopener" class="text-sun-ink underline underline-offset-2">{src.label}</a>
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
        <button type="button" class={btnSecondary} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>{s.changeAnswers}</button>
        <button type="button" class={btnText} onClick={() => window.location.reload()}>{s.startOver}</button>
      </p>
    </div>
  );
}
