/**
 * Calculator engine: pure functions, no DOM / fetch / Astro. UI calls calculate()
 * and formats its (already rounded) output. See types.ts for the result shape.
 */
export { calculate } from './calculate';
export { calculateBothPaths, calculateGlobal } from './calculate-global';
export { legacyExport, policySavingsYear, resolveExport } from './export-policy';
export type { ExportKind, ExportPolicy, RateWindow, ResolvedExport, TrueUp, YearTerms } from './export-policy';
export { prepareIncentives } from './incentives';
export type { Incentive, IncentiveAmountType, IncentiveSystem, PreparedIncentives, SkippedIncentive, AppliedIncentive } from './incentives';
export { toConsumerPrice } from './tax';
export type { TaxInfo } from './tax';
export type { GlobalAssumptions, GlobalCalcContext, GlobalCalcInput, GlobalCalcResult, GlobalCalcSuccess, GlobalCostLine, MarketInfo } from './global-types';
export { lossesForShading } from './production';
export type {
  BatteryCount,
  CalcContext,
  CalcFailure,
  CalcFailureReason,
  CalcInput,
  CalcResult,
  CalcSuccess,
  PaybackRange,
  ProductionInput,
  Range,
  Shading,
} from './types';
