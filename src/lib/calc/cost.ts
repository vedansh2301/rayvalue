import type { SourcedRange } from '../../data/schemas';
import type { Resolved } from './rates';
import type { Range } from './types';

export interface FilledRange {
  range: Range;
  /** Which ends were filled with assumptions.missing_range_spread (not sourced). */
  estimatedLow: boolean;
  estimatedHigh: boolean;
}

/**
 * A sourced cost line as a full range. A null low/high is filled as
 * likely × (1 − spread) / likely × (1 + spread) (controller ruling: placeholder
 * spread until the owner verifies bounds). A null likely is missing data: there is
 * nothing to spread around, and no default is substituted.
 */
export function fillSourcedRange(line: SourcedRange, path: string, spread: number): Resolved<FilledRange> {
  if (line.likely === null) return { ok: false, missing: [`${path}.likely`] };
  const likely = line.likely;
  return {
    ok: true,
    value: {
      range: {
        low: line.low ?? likely * (1 - spread),
        likely,
        high: line.high ?? likely * (1 + spread),
      },
      estimatedLow: line.low === null,
      estimatedHigh: line.high === null,
    },
  };
}

/**
 * Installed cost ($): kW × 1000 W/kW × $/W, end by end (low size × low $/W … high × high),
 * plus battery count × battery cost range. No incentive of any kind is subtracted.
 */
export function costRange(sizeKw: Range, perWatt: Range, batteries: number, batteryCost: Range): Range {
  const end = (k: keyof Range) => sizeKw[k] * 1000 * perWatt[k] + batteries * batteryCost[k];
  return { low: end('low'), likely: end('likely'), high: end('high') };
}
