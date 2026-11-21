import { inWindow, type End, type ExportKind } from './export-policy';
import type { Range } from './types';

/**
 * Date-effective incentives (table incentives, migration 0028). Pure functions.
 *
 * CLAUDE.md rule 2 generalised: an incentive is applied ONLY if it has a sourced row that is date-valid for the
 * install date. There is no row for the US federal 25D credit, so nothing is ever deducted for it. Rows that are
 * closed, of unknown status, out of their window, excluded by the export policy, or missing an amount are SKIPPED
 * with a reason (never guessed) so the UI can say why.
 */
export type IncentiveAmountType = 'per_kw' | 'per_kwh_storage' | 'flat' | 'percent' | 'annual_payment';

export interface Incentive {
  id: string;
  name: string;
  appliesTo: 'solar' | 'battery' | 'both';
  amountType: IncentiveAmountType;
  /** low / likely / high; a null bound falls back to likely (no spread is invented for administrative amounts). */
  amountLow: number | null;
  amountLikely: number | null;
  amountHigh: number | null;
  capAmount: number | null;
  /** 0-1 share of the gross installed cost. */
  capPercentOfCost: number | null;
  maxKw: number | null;
  maxKwh: number | null;
  taxable: boolean | null;
  excludesExportKind: ExportKind | null;
  status: 'open' | 'waitlist' | 'closed' | 'unknown';
  /** ISO dates; null = open. */
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface IncentiveSystem {
  /** Installed solar size in kW DC. */
  sizeKw: number;
  batteries: number;
  /** Usable kWh of ONE battery; null = unknown (a per-kWh incentive is then skipped, not guessed). */
  batteryUsableKwh: number | null;
}

export type SkipReason =
  | 'closed'
  | 'status_unknown'
  | 'not_in_effect'
  | 'not_applicable'
  | 'excluded_by_export_policy'
  | 'amount_unknown'
  | 'battery_size_unknown';

export interface SkippedIncentive {
  id: string;
  name: string;
  reason: SkipReason;
}

export interface AppliedIncentive {
  id: string;
  name: string;
  amountType: IncentiveAmountType;
  taxable: boolean | null;
  waitlist: boolean;
}

export interface PreparedIncentives {
  applied: AppliedIncentive[];
  skipped: SkippedIncentive[];
  /** Upfront deduction for a system with the given gross cost, at one end of the outcome range. Never exceeds grossCost, never negative. */
  upfront: (end: End, grossCost: number) => number;
  /** Sum of annual_payment incentives (currency per year) per end; added to every year's savings. */
  annual: Range;
}

const pickEnd = (i: Incentive, end: End): number | null => {
  const v = end === 'low' ? i.amountLow : end === 'high' ? i.amountHigh : i.amountLikely;
  return v ?? i.amountLikely;
};

/** Amount of one upfront incentive for a system and gross cost at one end (before the global clamp). */
function amountFor(i: Incentive, sys: IncentiveSystem, end: End, grossCost: number): number {
  const a = pickEnd(i, end) ?? 0;
  let raw: number;
  switch (i.amountType) {
    case 'per_kw':
      raw = a * Math.min(sys.sizeKw, i.maxKw ?? Infinity);
      break;
    case 'per_kwh_storage':
      raw = a * Math.min(sys.batteries * (sys.batteryUsableKwh ?? 0), i.maxKwh ?? Infinity);
      break;
    case 'flat':
      raw = a;
      break;
    case 'percent':
      raw = a * grossCost;
      break;
    case 'annual_payment':
      raw = 0;
      break;
  }
  if (i.capAmount !== null) raw = Math.min(raw, i.capAmount);
  if (i.capPercentOfCost !== null) raw = Math.min(raw, i.capPercentOfCost * grossCost);
  return Math.max(0, raw);
}

/**
 * Decide which incentives apply to this system, install date and export policy, and return a function that prices
 * them per scenario. `installDate` is ISO (YYYY-MM-DD).
 */
export function prepareIncentives(
  incentives: readonly Incentive[],
  system: IncentiveSystem,
  installDate: string,
  exportKind: ExportKind,
): PreparedIncentives {
  const applied: AppliedIncentive[] = [];
  const skipped: SkippedIncentive[] = [];
  const upfrontList: Incentive[] = [];
  const annualList: Incentive[] = [];

  for (const i of incentives) {
    const skip = (reason: SkipReason) => skipped.push({ id: i.id, name: i.name, reason });
    const batteryOnly = i.appliesTo === 'battery' || i.amountType === 'per_kwh_storage';
    if (i.status === 'closed') skip('closed');
    else if (i.status === 'unknown') skip('status_unknown');
    else if (!inWindow(installDate, i.effectiveFrom, i.effectiveTo)) skip('not_in_effect');
    else if (batteryOnly && system.batteries === 0) skip('not_applicable');
    else if (i.excludesExportKind === exportKind) skip('excluded_by_export_policy');
    else if (i.amountLikely === null) skip('amount_unknown');
    else if (i.amountType === 'per_kwh_storage' && system.batteryUsableKwh === null) skip('battery_size_unknown');
    else {
      applied.push({ id: i.id, name: i.name, amountType: i.amountType, taxable: i.taxable, waitlist: i.status === 'waitlist' });
      (i.amountType === 'annual_payment' ? annualList : upfrontList).push(i);
    }
  }

  const annualAt = (end: End) => annualList.reduce((s, i) => s + Math.max(0, pickEnd(i, end) ?? 0), 0);
  return {
    applied,
    skipped,
    upfront: (end, grossCost) => Math.min(grossCost, upfrontList.reduce((s, i) => s + amountFor(i, system, end, grossCost), 0)),
    annual: { low: annualAt('low'), likely: annualAt('likely'), high: annualAt('high') },
  };
}
