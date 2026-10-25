/**
 * Lease / PPA comparison (pure). A lease or power purchase agreement (PPA) means a company owns the system and the
 * homeowner pays monthly (lease) or per kWh produced (PPA). The prices are model assumptions that are null until the
 * owner enters verified figures (model_assumptions: lease_monthly_per_kw, lease_annual_escalator, ppa_rate_per_kwh,
 * ppa_annual_escalator). With any needed figure null the option is `available: false` and callers show explanatory
 * text only; nothing is estimated or defaulted here.
 *
 * Basis: the same system as the "buy" estimate, so bill savings are the likely-scenario savings series of that
 * estimate; the contract is assumed to run for the whole analysis period. Net savings = bill savings − payments,
 * undiscounted, with no upfront cost. Low pairs with the highest payments, high with the lowest.
 */
import { roundRange, roundUsd } from './round';
import type { CalcSuccess, Range } from './types';

/** low / likely / high where every bound may still be null (not yet verified). */
export interface NullableRange {
  low: number | null;
  likely: number | null;
  high: number | null;
}

/** The assumption rows this comparison reads (any may be absent from the database). */
export interface FinancingTerms {
  lease_monthly_per_kw?: NullableRange | undefined;
  lease_annual_escalator?: NullableRange | undefined;
  ppa_rate_per_kwh?: NullableRange | undefined;
  ppa_annual_escalator?: NullableRange | undefined;
}

export type FinancingOption =
  | { available: false; missing: string[] }
  | {
      available: true;
      /** Payments in year 1, USD. */
      year1Payment: Range;
      /** Bill savings minus payments over the analysis period, USD (rounded to $100). */
      netSavings: Range;
    };

export interface FinancingComparison {
  lease: FinancingOption;
  ppa: FinancingOption;
}

export interface FinancingInput {
  /** System size in kW DC. */
  sizeKw: number;
  /** Year-1 production in kWh. */
  year1ProductionKwh: number;
  /** Fraction of output lost per year (0.005 = 0.5%). */
  degradationPerYear: number;
  /** Bill savings per year from the "buy" estimate (likely scenario), years 1…N. */
  yearlySavings: readonly number[];
}

const isComplete = (r: NullableRange | undefined): r is Range => !!r && r.low !== null && r.likely !== null && r.high !== null;

function missingNames(prefix: string, ...pairs: [string, NullableRange | undefined][]): string[] {
  return pairs.filter(([, r]) => !isComplete(r)).map(([k]) => `${prefix}${k}`);
}

/** Payments by year for one scenario: first-year amount grown by the escalator; `volume(n)` scales it (1 for a flat lease). */
function paymentsFor(years: number, firstYear: number, escalator: number, volume: (n: number) => number): number[] {
  return Array.from({ length: years }, (_, i) => firstYear * (1 + escalator) ** i * volume(i + 1));
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function option(input: FinancingInput, first: Range, esc: Range, volume: (n: number) => number, firstYearBase: number): FinancingOption {
  const years = input.yearlySavings.length;
  const savings = sum(input.yearlySavings);
  const total = (end: keyof Range) => sum(paymentsFor(years, first[end] * firstYearBase, esc[end], volume));
  const year1 = (end: keyof Range) => first[end] * firstYearBase * volume(1);
  // Lowest payments give the best net result, so low net = high payments.
  const net: Range = { low: savings - total('high'), likely: savings - total('likely'), high: savings - total('low') };
  return {
    available: true,
    year1Payment: roundRange({ low: year1('low'), likely: year1('likely'), high: year1('high') }, roundUsd),
    netSavings: roundRange(net, roundUsd),
  };
}

export function compareFinancing(input: FinancingInput, terms: FinancingTerms | undefined): FinancingComparison {
  const t = terms ?? {};
  const leaseMissing = missingNames('', ['lease_monthly_per_kw', t.lease_monthly_per_kw], ['lease_annual_escalator', t.lease_annual_escalator]);
  const ppaMissing = missingNames('', ['ppa_rate_per_kwh', t.ppa_rate_per_kwh], ['ppa_annual_escalator', t.ppa_annual_escalator]);
  const noSavings = input.yearlySavings.length === 0 || input.sizeKw <= 0;

  const lease: FinancingOption =
    leaseMissing.length > 0 || noSavings
      ? { available: false, missing: leaseMissing }
      : // monthly price per kW × kW × 12 months, flat volume
        option(input, t.lease_monthly_per_kw as Range, t.lease_annual_escalator as Range, () => 1, input.sizeKw * 12);

  const ppa: FinancingOption =
    ppaMissing.length > 0 || noSavings
      ? { available: false, missing: ppaMissing }
      : // price per kWh × year-1 kWh, volume falls with degradation
        option(input, t.ppa_rate_per_kwh as Range, t.ppa_annual_escalator as Range, (n) => (1 - input.degradationPerYear) ** (n - 1), input.year1ProductionKwh);

  return { lease, ppa };
}

/** Assemble the comparison for a finished estimate and the loaded assumptions. */
export function financingForResult(r: CalcSuccess, degradationPerYear: number, terms: FinancingTerms | undefined): FinancingComparison {
  return compareFinancing(
    { sizeKw: r.size.likely, year1ProductionKwh: r.year1ProductionKwh, degradationPerYear, yearlySavings: r.yearlySavings },
    terms,
  );
}
