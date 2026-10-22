import type { Assumptions } from '../../data/schemas';
import type { Range } from './types';

export interface Sizing {
  /** Target offset shares: low/high from assumptions.target_offset, likely = their midpoint. */
  offset: Range;
  /** kW DC, each end capped at system_size_cap_kw. */
  size: Range;
  /** True if any end hit the cap. */
  capped: boolean;
  /** True if the likely size is below min_system_size_kw (warning only; size is not raised). */
  belowMinimum: boolean;
}

/** kW = annual kWh × offset ÷ kWh per kW-year, per offset end, then capped. */
export function sizeSystem(annualKwh: number, kwhPerKwYear: number, a: Assumptions): Sizing {
  const { low, high } = a.target_offset;
  const offset: Range = { low, likely: (low + high) / 2, high };
  const cap = a.system_size_cap_kw.value;
  const raw = (o: number) => (annualKwh * o) / kwhPerKwYear;
  const uncapped: Range = { low: raw(offset.low), likely: raw(offset.likely), high: raw(offset.high) };
  const size: Range = {
    low: Math.min(uncapped.low, cap),
    likely: Math.min(uncapped.likely, cap),
    high: Math.min(uncapped.high, cap),
  };
  return {
    offset,
    size,
    capped: uncapped.high > cap,
    belowMinimum: size.likely < a.min_system_size_kw.value,
  };
}
