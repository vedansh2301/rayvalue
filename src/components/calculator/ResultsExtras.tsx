/**
 * Extra explanatory panels under the calculator results: lease/PPA comparison (both states) and Florida battery
 * notes. No math here: figures come from financingForResult() (src/lib/calc/lease-ppa.ts) and are only formatted.
 * Wording lives in src/lib/content/*.
 */
import type { Assumptions } from '../../data/schemas';
import { financingForResult, type FinancingOption } from '../../lib/calc/lease-ppa';
import type { CalcSuccess } from '../../lib/calc/types';
import { displayRange, formatSignedUsd } from '../../lib/calculator/display';
import { FINANCING_NOTES, FINANCING_NO_NUMBERS, FINANCING_TITLE, FINANCING_WITH_NUMBERS_BASIS } from '../../lib/content/financing';
import { FL_BATTERY_CLOSING, FL_BATTERY_INTRO, FL_BATTERY_NOTES, FL_BATTERY_TITLE } from '../../lib/content/fl-battery';
import { formatUsd } from '../../lib/format';

function rangeLine(r: { low: number; likely: number; high: number }, fmt: (n: number) => string): string {
  const d = displayRange(r, fmt);
  return d.kind === 'single' ? d.value : `${d.likely} likely (range ${d.low} to ${d.high})`;
}

function OptionRow(p: { label: string; unit: string; o: FinancingOption }) {
  if (!p.o.available) return null;
  return (
    <div class="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <dt class="font-semibold text-stone-900">{p.label}</dt>
      <dd class="mt-1 text-stone-700">
        <span class="block">Year-1 payments: {rangeLine(p.o.year1Payment, formatUsd)}</span>
        <span class="block">Net savings over the period: {rangeLine(p.o.netSavings, formatSignedUsd)}</span>
        <span class="mt-1 block text-sm text-stone-600">{p.unit}</span>
      </dd>
    </div>
  );
}

export function FinancingPanel(p: { r: CalcSuccess; assumptions: Assumptions }) {
  const { r, assumptions: a } = p;
  const c = financingForResult(r, a.panel_degradation_per_year.value, a);
  const hasNumbers = c.lease.available || c.ppa.available;
  return (
    <section aria-labelledby="calc-financing-heading" class="mt-6 rounded-lg border border-stone-200 bg-white p-4 sm:p-5">
      <h3 id="calc-financing-heading" class="font-semibold text-stone-900">{FINANCING_TITLE}</h3>
      <p class="mt-2 text-sm leading-6 text-stone-700">The estimate above assumes you buy the system. Another route is to let a company own it.</p>
      <dl class="mt-3 space-y-3">
        {FINANCING_NOTES.map((n) => (
          <div key={n.heading}>
            <dt class="text-sm font-semibold text-stone-900">{n.heading}</dt>
            <dd class="mt-0.5 text-sm leading-6 text-stone-700">{n.body}</dd>
          </div>
        ))}
      </dl>
      {hasNumbers ? (
        <>
          <dl class="mt-4 grid gap-3 sm:grid-cols-2">
            <OptionRow label="Lease" unit="No upfront cost" o={c.lease} />
            <OptionRow label="PPA" unit="No upfront cost" o={c.ppa} />
          </dl>
          <p class="mt-3 text-sm text-stone-600">{FINANCING_WITH_NUMBERS_BASIS}</p>
        </>
      ) : (
        <p class="mt-4 text-sm leading-6 text-stone-700">{FINANCING_NO_NUMBERS}</p>
      )}
    </section>
  );
}

export function FlBatteryPanel(p: { batteries: 0 | 1 | 2 }) {
  return (
    <details open={p.batteries > 0} class="mt-6 rounded-lg border border-stone-200 bg-white">
      <summary class="min-h-11 cursor-pointer px-4 py-3 font-semibold text-stone-900">{FL_BATTERY_TITLE}</summary>
      <div class="px-4 pb-4">
        <p class="text-sm leading-6 text-stone-700">{FL_BATTERY_INTRO}</p>
        <dl class="mt-3 space-y-3">
          {FL_BATTERY_NOTES.map((n) => (
            <div key={n.heading}>
              <dt class="text-sm font-semibold text-stone-900">{n.heading}</dt>
              <dd class="mt-0.5 text-sm leading-6 text-stone-700">{n.body}</dd>
            </div>
          ))}
        </dl>
        <p class="mt-3 text-sm leading-6 text-stone-700">{FL_BATTERY_CLOSING}</p>
      </div>
    </details>
  );
}
