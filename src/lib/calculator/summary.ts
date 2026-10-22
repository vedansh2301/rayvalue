/**
 * Text for the collapsed "Your answers" summary shown above results (pure; no calculation).
 * Only formats the answers the shown estimate was run with.
 */
import type { BatteryCount, Shading } from '../calc/types';

export interface SummaryInputs {
  zip: string;
  /** The utility's display name; null when it is not listed (or unknown). */
  utilityName: string | null;
  /** Average monthly bill as parsed from the form (dollars). */
  bill: number;
  battery: BatteryCount;
  shading: Shading;
}

const BATTERY_TEXT: Record<BatteryCount, string> = { 0: 'No battery', 1: '1 battery', 2: '2 batteries' };
const SHADING_TEXT: Record<Shading, string> = { none: 'Little or no shade', some: 'Some shade', heavy: 'Heavy shade' };

const whole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The bill as the user entered it: whole dollars stay whole ("$200/mo"), cents are kept ("$180.50/mo"). */
export function formatBillPerMonth(bill: number): string {
  return `${(Number.isInteger(bill) ? whole : cents).format(bill)}/mo`;
}

export const UTILITY_NOT_LISTED = 'Utility not listed';

/** The summary parts, in display order: ZIP · utility · bill · battery · shade. */
export function answerSummaryParts(i: SummaryInputs): string[] {
  return [i.zip, i.utilityName || UTILITY_NOT_LISTED, formatBillPerMonth(i.bill), BATTERY_TEXT[i.battery], SHADING_TEXT[i.shading]];
}

/** One-line summary, e.g. "33101 · Florida Power & Light (FPL) · $200/mo · No battery · Little or no shade". */
export function answerSummaryText(i: SummaryInputs): string {
  return answerSummaryParts(i).join(' · ');
}
