import type { SourcedRange } from '../../data/schemas';
import type { ExportPolicy } from './export-policy';
import type { AppliedIncentive, Incentive, SkippedIncentive } from './incentives';
import type { RateSource } from './rates';
import type { BatteryCount, CalcFailure, PaybackRange, ProductionInput, Range, Shading } from './types';

/** Market facts the engine needs (markets table). All maths runs in `currency`; there is no FX inside calc. */
export interface MarketInfo {
  code: string;
  currency: string;
  locale: string;
  /** Do consumer prices in this market include VAT/GST? Display only (the maths follows each cost line's own flag). */
  pricesIncludeTax: boolean | null;
  vatRate: number | null;
  /** Rounding unit for money (markets.display_round); null = 100. */
  displayRound: number | null;
}

export interface GlobalCostLine {
  line: SourcedRange;
  /** cost_ranges.includes_tax. */
  includesTax: boolean | null;
}

/** Product choices for a market (model_assumptions), as plain numbers. Same field names as the US Assumptions where they overlap. */
export interface GlobalAssumptions {
  target_offset: { low: number; high: number };
  system_size_cap_kw: { value: number };
  min_system_size_kw: { value: number };
  max_monthly_bill: { value: number };
  panel_degradation_per_year: { value: number };
  analysis_years: { value: number };
  missing_range_spread: { value: number };
  /** Annual retail rate escalation for this market/region. */
  annual_rate_escalation: Range;
  /** Share of solar output used at home, by battery count. */
  self_consumption_share: { solar_only: Range; solar_plus_1_battery: Range; solar_plus_2_batteries: Range };
  /** Loss percent per shading level (text only; production is supplied already computed at the right loss). */
  system_loss_pct: { none: number; some: number; heavy: number };
}

export interface GlobalCalcInput {
  utilityId: string;
  /** Average monthly bill in the market currency. */
  avgMonthlyBill: number;
  battery: BatteryCount;
  shading: Shading;
  /** ISO date (YYYY-MM-DD) the system would be installed; selects date-effective incentives and export rates. */
  installDate: string;
}

export interface GlobalCalcContext {
  market: MarketInfo;
  regionCode: string;
  utility: RateSource & { name: string; rate_schedule: string; source_url: string | null; verified_on: string | null };
  exportPolicy: ExportPolicy;
  /** All incentive rows for the market/region (the engine applies the date, status and policy rules). */
  incentives: readonly Incentive[];
  installedCostPerWatt: GlobalCostLine;
  batteryInstalledCost: GlobalCostLine;
  /** Usable kWh of one battery; null = unknown (per-kWh incentives are then skipped). */
  batteryUsableKwh: number | null;
  assumptions: GlobalAssumptions;
  /** 1 kW DC production for this location from the market's one yield provider. */
  production: ProductionInput;
}

export interface GlobalCalcSuccess {
  ok: true;
  country: string;
  regionCode: string;
  utilityId: string;
  currency: string;
  annualUsageKwh: number;
  size: Range;
  /** Installed cost in consumer prices (VAT/GST included), BEFORE incentives. */
  cost: Range;
  /** Upfront incentive deducted in the payback and net-savings figures (0 when none apply). Low = worst outcome. */
  upfrontIncentive: Range;
  year1Savings: Range;
  paybackYears: PaybackRange;
  netSavings25: Range;
  year1ProductionKwh: number;
  yearlySavings: number[];
  yearlySavingsLow: number[];
  yearlySavingsHigh: number[];
  analysisYears: number;
  incentivesApplied: AppliedIncentive[];
  incentivesSkipped: SkippedIncentive[];
  assumptions: string[];
  warnings: string[];
}

export type GlobalCalcResult = GlobalCalcSuccess | CalcFailure;
