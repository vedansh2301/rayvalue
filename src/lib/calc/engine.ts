import { policySavingsYear, type End, type ResolvedExport } from './export-policy';
import type { PreparedIncentives } from './incentives';
import { netSavings, paybackYears, projectSavings } from './payback';
import type { RateModel } from './rates';
import { roundKw, roundKwh, roundPayback, roundRange } from './round';
import { costRange } from './cost';
import type { Sizing } from './sizing';
import type { PaybackRange, Range } from './types';

/** Everything the scenario engine needs, already resolved (no data access, no validation). */
export interface EngineParams {
  model: RateModel;
  export: ResolvedExport;
  annualKwh: number;
  kwhPerKw: number;
  /** Monthly production shares (12, sum 1). */
  shares: readonly number[];
  sizing: Sizing;
  perWattRange: Range;
  batteries: number;
  batteryRange: Range;
  /** Self-consumption share per end (low/likely/high). */
  share: Range;
  escalation: Range;
  degradation: number;
  years: number;
  /** null = no incentives (the US today). */
  incentives: PreparedIncentives | null;
  /** Money rounding for this market (default nearest 100). */
  roundMoney: (n: number) => number;
}

export interface EngineResult {
  annualUsageKwh: number;
  size: Range;
  cost: Range;
  /** Upfront incentive for the likely system at each end (0 when none). Cost above is gross. */
  upfrontIncentive: Range;
  year1Savings: Range;
  paybackYears: PaybackRange;
  netSavings25: Range;
  year1ProductionKwh: number;
  yearlySavings: number[];
  yearlySavingsLow: number[];
  yearlySavingsHigh: number[];
  analysisYears: number;
}

interface Scenario {
  sizeKw: number;
  share: number;
  escalation: number;
  end: End;
  /** Net upfront cost (gross minus incentive). */
  cost: number;
}

/**
 * The scenario engine shared by calculate() (US) and calculateGlobal(). Range composition is documented on
 * calculate() in calculate.ts: display ranges follow the size range; payback and net savings are outcome
 * scenarios for ONE system (size.likely). With no incentives and the legacy export policy the arithmetic is
 * exactly the pre-global engine's (guarded by golden regression tests).
 */
export function runEngine(p: EngineParams): EngineResult {
  const { model, annualKwh, kwhPerKw, sizing, perWattRange, batteryRange, years } = p;
  const size = sizing.size;
  const cost = costRange(size, perWattRange, p.batteries, batteryRange);

  const savingsInYear = (s: Scenario, n: number): number => {
    const annualProduction = s.sizeKw * kwhPerKw * (1 - p.degradation) ** (n - 1);
    return (
      policySavingsYear({
        model,
        terms: p.export.terms[n - 1]!,
        resolved: p.export,
        end: s.end,
        annualUsageKwh: annualKwh,
        annualProductionKwh: annualProduction,
        monthlyProductionKwh: p.shares.map((sh) => sh * annualProduction),
        selfConsumptionShare: s.share,
        rateGrowth: (1 + s.escalation) ** (n - 1),
      }) + (p.incentives ? p.incentives.annual[s.end] : 0)
    );
  };

  const kw = size.likely;
  const gross = (end: keyof Range) => kw * 1000 * perWattRange[end] + p.batteries * batteryRange[end];
  // Cost end vs outcome end: the worst outcome pairs the HIGH cost with the LOW incentive and low savings.
  const net = (costEnd: keyof Range, incEnd: End) => {
    const g = gross(costEnd);
    return p.incentives ? g - p.incentives.upfront(incEnd, g) : g;
  };
  const worst: Scenario = { sizeKw: kw, share: p.share.low, escalation: p.escalation.low, end: 'low', cost: net('high', 'low') };
  const likely: Scenario = { sizeKw: kw, share: p.share.likely, escalation: p.escalation.likely, end: 'likely', cost: p.incentives ? cost.likely - p.incentives.upfront('likely', cost.likely) : cost.likely };
  const best: Scenario = { sizeKw: kw, share: p.share.high, escalation: p.escalation.high, end: 'high', cost: net('low', 'high') };
  const flows = (s: Scenario) => projectSavings(years, (n) => savingsInYear(s, n));
  const fw = flows(worst);
  const fl = flows(likely);
  const fb = flows(best);

  const year1Savings: Range = {
    low: savingsInYear({ sizeKw: size.low, share: p.share.low, escalation: 0, end: 'low', cost: 0 }, 1),
    likely: fl[0] ?? 0,
    high: savingsInYear({ sizeKw: size.high, share: p.share.high, escalation: 0, end: 'high', cost: 0 }, 1),
  };
  const payback = { low: paybackYears(best.cost, fb), likely: paybackYears(likely.cost, fl), high: paybackYears(worst.cost, fw) };
  const netS: Range = { low: netSavings(worst.cost, fw), likely: netSavings(likely.cost, fl), high: netSavings(best.cost, fb) };
  const inc = (costEnd: keyof Range, incEnd: End) => (p.incentives ? p.incentives.upfront(incEnd, gross(costEnd)) : 0);

  return {
    annualUsageKwh: roundKwh(annualKwh),
    size: roundRange(size, roundKw),
    cost: roundRange(cost, p.roundMoney),
    upfrontIncentive: roundRange({ low: inc('high', 'low'), likely: inc('likely', 'likely'), high: inc('low', 'high') }, p.roundMoney),
    year1Savings: roundRange(year1Savings, p.roundMoney),
    paybackYears: roundPayback(payback),
    netSavings25: roundRange(netS, p.roundMoney),
    year1ProductionKwh: roundKwh(kw * kwhPerKw),
    yearlySavings: fl.map((v) => Math.round(v)),
    yearlySavingsLow: fw.map((v) => Math.round(v)),
    yearlySavingsHigh: fb.map((v) => Math.round(v)),
    analysisYears: years,
  };
}
