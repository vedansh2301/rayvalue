/**
 * The estimate a lead "takes with them": the displayed likely/low/high text of the results card,
 * copied from the same display helpers the card uses (no new math).
 */
import type { CalcSuccess } from '../calc/types';
import { displayPayback, displayRange, formatKw, formatSignedUsd, type RangeDisplay } from '../calculator/display';
import { formatUsd } from '../format';
import type { EstimateSnapshot, SnapshotValue } from './validate';

const toValue = (d: RangeDisplay): SnapshotValue => (d.kind === 'single' ? { value: d.value } : { likely: d.likely, low: d.low, high: d.high });

export function estimateSnapshot(r: CalcSuccess): EstimateSnapshot {
  return {
    system_size: toValue(displayRange(r.size, formatKw)),
    upfront_cost: toValue(displayRange(r.cost, formatUsd)),
    payback: toValue(displayPayback(r.paybackYears, r.analysisYears)),
    net_savings: toValue(displayRange(r.netSavings25, formatSignedUsd)),
  };
}

const likelyOf = (v: SnapshotValue | undefined): string | null => (v ? ('value' in v ? v.value : v.likely) : null);

/** One-line "likely" summary of the estimate for the quote bridge chip, built from the displayed snapshot text. Null when there is none. */
export function estimateChip(s: EstimateSnapshot | null): string | null {
  const payback = likelyOf(s?.payback);
  const net = likelyOf(s?.net_savings);
  if (!payback || !net) return null;
  return `Likely: ${payback} payback · ${net} net savings`;
}
