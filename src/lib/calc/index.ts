/**
 * Calculator engine: pure functions, no DOM / fetch / Astro. UI calls calculate()
 * and formats its (already rounded) output. See types.ts for the result shape.
 */
export { calculate } from './calculate';
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
