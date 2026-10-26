/**
 * Facts for a utility post (pure). Every figure comes from the SAME view model the rayvalue.com utility page renders
 * (loadUtilityPageData -> buildUtilityPage -> calculate()), formatted with the same helpers, so a Reel shows exactly
 * the ranges the page shows for that utility. Each figure is returned as a `Fig` (text + data_ref).
 *
 * data_refs tables: `calc_example` is derived output of calculate() for the page's worked example (inputs: utilities,
 * cost_ranges, model_assumptions, pvwatts_city_production); `model_assumptions` and `utilities` are stored values.
 */
import { formatYears } from '../../city/view';
import { formatUsd } from '../../format';
import { STATE_SLUG, utilityPagePath } from '../../utility/pages';
import { typicalExample, type ExampleResult, type UtilityPageVm } from '../../utility/view';
import { fig, type Fig } from './refs';

export interface RangeFigs {
  low: Fig;
  likely: Fig;
  high: Fig;
}

export interface ExampleFacts {
  label: string;
  /** System size (kW, likely). */
  size: Fig;
  cost: RangeFigs;
  savings: RangeFigs;
  /** Texts end in " yrs"; `low` is the best case and `high` the worst (see calc/types.ts). A null end reads "more than N yrs". */
  payback: RangeFigs;
  /** Likely payback in years; null = beyond the analysis period. For comparisons only, never displayed. */
  paybackLikelyYears: number | null;
}

export interface UtilityFacts {
  slug: string;
  utilityId: string;
  short: string;
  name: string;
  state: 'FL' | 'CA';
  stateName: string;
  /** Page path on rayvalue.com, e.g. /solar/florida/fpl */
  pagePath: string;
  cityName: string | null;
  bill: Fig;
  /** "Oct 22, 2026": when this utility's rates were read. */
  dataDate: Fig | null;
  /** ISO date behind dataDate, for picking the oldest across utilities. */
  verifiedOn: string | null;
  solar: ExampleFacts;
  /** The same bill with one battery, when that example has a result. */
  battery: ExampleFacts | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-22" -> "Oct 22, 2026"; null for anything else. */
export function formatDataDate(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : null;
}

export const STATE_NAME = { FL: 'Florida', CA: 'California' } as const;

/** "$12,300–$16,100", or one value when both ends are equal. */
export const joinRange = (a: string, b: string) => (a === b ? a : `${a}–${b}`);

/** Payback figure text without its unit: "13", "more than 25". */
export const bare = (f: Fig) => f.text.replace(/ yrs$/, '');

/** "13 to 19 years" / "18 to more than 25 years" / "more than 25 years" / "9 years". Caption wording. */
export function paybackPhrase(p: RangeFigs): string {
  const lo = bare(p.low);
  const hi = bare(p.high);
  return lo === hi ? `${lo} years` : `${lo} to ${hi} years`;
}

/** Slide headline for a payback range: "13–19 years". */
export function paybackBig(p: RangeFigs): string {
  const lo = bare(p.low);
  const hi = bare(p.high);
  if (lo === hi) return `${lo} years`;
  return hi.startsWith('more than') ? `${lo} to ${hi} years` : `${lo}–${hi} years`;
}

function exampleFacts(id: string, bill: number, battery: 0 | 1, r: ExampleResult, years: number | null): ExampleFacts {
  const calcId = `${id}/bill-${bill}/${battery ? 'solar-battery' : 'solar-only'}`;
  const f = (field: string, text: string) => fig('calc_example', calcId, field, text);
  const usd = (field: string, v: { low: number; likely: number; high: number }): RangeFigs => ({
    low: f(`${field}.low`, formatUsd(v.low)),
    likely: f(`${field}.likely`, formatUsd(v.likely)),
    high: f(`${field}.high`, formatUsd(v.high)),
  });
  // A payback beyond the analysis period reads "more than N yrs"; its figure is traced to analysis_years.
  const yr = (field: string, n: number | null): Fig => {
    if (n !== null) return f(field, `${formatYears(n, 0)} yrs`);
    if (years === null) throw new Error(`${id}: payback is beyond the analysis period but analysis_years is not set`);
    return { text: `${formatYears(null, years)} yrs`, ref: { table: 'model_assumptions', id: 'analysis_years', field: 'value', value: String(years) } };
  };
  return {
    label: battery ? 'Solar + 1 battery' : 'Solar only',
    size: f('size.likely', `${r.size.likely} kW`),
    cost: usd('cost', r.cost),
    savings: usd('year1Savings', r.year1Savings),
    paybackLikelyYears: r.paybackYears.likely,
    payback: { low: yr('paybackYears.low', r.paybackYears.low), likely: yr('paybackYears.likely', r.paybackYears.likely), high: yr('paybackYears.high', r.paybackYears.high) },
  };
}

/** Facts for one utility page, or null when the page has no real worked example (the page itself is then noindex). */
export function buildUtilityFacts(vm: UtilityPageVm): UtilityFacts | null {
  const typical = typicalExample(vm.examples, vm.indexable);
  if (!typical) return null;
  const id = vm.utility.id;
  const years = vm.analysisYears;
  const batteryRow = vm.examples.find((e) => e.bill === typical.bill && e.battery === 1 && e.result !== null);
  const date = formatDataDate(vm.utility.verified_on);
  return {
    slug: vm.meta.slug,
    utilityId: id,
    short: vm.meta.short,
    name: vm.utility.name,
    state: vm.meta.state,
    stateName: STATE_NAME[vm.meta.state],
    pagePath: utilityPagePath(vm.meta),
    cityName: vm.repCity?.name ?? null,
    bill: fig('model_assumptions', 'utility_example_bills', 'value', formatUsd(typical.bill)),
    dataDate: date ? fig('utilities', id, 'verified_on', date) : null,
    verifiedOn: date ? vm.utility.verified_on : null,
    solar: exampleFacts(id, typical.bill, 0, typical.result, years),
    battery: batteryRow?.result ? exampleFacts(id, typical.bill, 1, batteryRow.result, years) : null,
  };
}

/** "rayvalue.com/solar/florida/fpl" (the address shown on the call-to-action slide). */
export const utilityUrlText = (f: Pick<UtilityFacts, 'pagePath'>) => `rayvalue.com${f.pagePath}`;
export const calculatorUrlText = (state: 'FL' | 'CA') => `rayvalue.com/calculator/${STATE_SLUG[state]}`;
