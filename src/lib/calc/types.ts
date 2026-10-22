import type { Assumptions, Costs, State, Utility } from '../../data/schemas';

/** A low / likely / high triple. Always low <= likely <= high. */
export interface Range {
  low: number;
  likely: number;
  high: number;
}

/**
 * Payback years. `null` means "not paid back within the analysis period" (shown as
 * "more than N years"). ORDERING: `low` is the BEST case (shortest payback, from the
 * high-outcome scenario), `high` is the WORST case (longest payback, low-outcome
 * scenario). A null end is longer than any number, so if `likely` is null, `high` is too.
 */
export interface PaybackRange {
  low: number | null;
  likely: number | null;
  high: number | null;
}

export type BatteryCount = 0 | 1 | 2;
export type Shading = 'none' | 'some' | 'heavy';

export interface CalcInput {
  /** 5-digit ZIP; must be in the utility's state. */
  zip: string;
  utilityId: string;
  /** Average monthly electric bill in dollars (> 0 and <= assumptions.max_monthly_bill, else invalid_bill). */
  avgMonthlyBill: number;
  battery: BatteryCount;
  /** Only used for the assumptions text; the caller already picked production at lossesForShading(shading). */
  shading: Shading;
}

/**
 * Solar production for 1 kW DC at this location, as returned by PVWatts at
 * lossesForShading(shading) percent system losses (Task 4 supplies it).
 * `annualKwhPerKw` drives sizing and annual totals. `monthlyKwhPerKw`, if given,
 * only sets the month-by-month SHAPE (it is normalized so its months sum to the
 * annual figure); if absent the annual figure is split evenly across 12 months.
 */
export interface ProductionInput {
  annualKwhPerKw: number;
  monthlyKwhPerKw?: readonly number[];
}

export interface CalcContext {
  /**
   * Resolves input.zip to its state (null = unknown ZIP). Injected so calculate() stays pure and the
   * engine does not bundle ZIP tables: servers/tests pass geo.lookupZip (both states); the island
   * passes a lookup over the page state's lazily loaded table.
   */
  lookupZip: (zip: string) => { state: State } | null;
  /** Utility records to look `input.utilityId` up in (normally loaded from the database by src/lib/db/repo.ts). */
  utilities: readonly Utility[];
  costs: Costs;
  assumptions: Assumptions;
  production: ProductionInput;
}

export type CalcFailureReason = 'invalid_zip' | 'unknown_utility' | 'state_mismatch' | 'missing_data' | 'invalid_bill';

export interface CalcFailure {
  ok: false;
  reason: CalcFailureReason;
  /** For missing_data: the null data paths (same spelling as docs/TODO-VERIFY.md). */
  missing?: string[];
}

/**
 * All money in USD. Values are rounded for display (kW to 0.1, dollars to the
 * nearest $100, years to 0.5, annual kWh to the nearest 100).
 *
 * Range composition (see calculate.ts):
 *  - size, cost, year1Savings are display ranges over the size range (offset low…high;
 *    cost low = size.low × $/W.low, high = size.high × $/W.high).
 *  - paybackYears and netSavings25 are outcome scenarios for ONE system, size.likely:
 *      worst ("low outcome")  = $/W.high (+ battery high) + lowest savings assumptions + lowest escalation
 *      likely                 = likely everything
 *      best ("high outcome")  = $/W.low (+ battery low) + highest savings assumptions + highest escalation
 * `netSavings25.low` is the worst outcome and `.high` the best. `paybackYears.low` is the
 * best case (shortest) and `.high` the worst (longest).
 */
export interface CalcSuccess {
  ok: true;
  state: State;
  utilityId: Utility['id'];
  annualUsageKwh: number;
  /** System size in kW DC (low = 90% offset … high = 100% offset with the default assumptions). */
  size: Range;
  /** Installed cost in USD, before any incentive (no federal credit applies). */
  cost: Range;
  /** First-year bill savings in USD (low = size.low system, high = size.high system). */
  year1Savings: Range;
  paybackYears: PaybackRange;
  /** Cumulative bill savings over the analysis period minus installed cost (undiscounted). */
  netSavings25: Range;
  /** Length of the projection in years (assumptions.analysis_years). */
  analysisYears: number;
  /** Human-readable statements of every value the result rests on. */
  assumptions: string[];
  /** Things the user should know about this particular result (tiny bill, size cap, …). */
  warnings: string[];
}

export type CalcResult = CalcSuccess | CalcFailure;
