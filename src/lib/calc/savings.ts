import type { AvgRates, TieredRates } from './rates';
import { tierEnergyCost } from './usage';

/**
 * FL retail net metering, one year, month by month (January first).
 *
 * Each month m:  available = production_m + bank
 *   if available >= usage: billed kWh = 0, bank = available − usage
 *   else:                  billed kWh = usage − available, bank = 0
 *   saving_m = energyCost_m(usage) − energyCost_m(billed kWh)
 * Banked kWh offset later months kWh-for-kWh at retail (re-priced through that month's
 * tiers). Whatever is still banked after December is valued at $0 (conservative).
 * The fixed charge is paid either way, so it never appears in the saving.
 *
 * @param monthlyUsageKwh usage assumed equal every month (annual ÷ 12)
 * @param monthlyProductionKwh 12 values, index 0 = January
 */
export function flSavingsYear(rates: TieredRates, monthlyUsageKwh: number, monthlyProductionKwh: readonly number[]): number {
  let bank = 0;
  let savings = 0;
  for (let m = 0; m < 12; m++) {
    const tiers = rates.monthTiers[m]!;
    const available = (monthlyProductionKwh[m] ?? 0) + bank;
    const billed = Math.max(0, monthlyUsageKwh - available);
    bank = Math.max(0, available - monthlyUsageKwh);
    savings += tierEnergyCost(tiers, monthlyUsageKwh) - tierEnergyCost(tiers, billed);
  }
  return savings;
}

export interface CaSavings {
  selfConsumedKwh: number;
  exportedKwh: number;
  /** selfConsumedKwh × retail rate (escalates with retail rates over time). */
  retailValue: number;
  /** exportedKwh × export credit (held flat over time). */
  exportValue: number;
  total: number;
}

/**
 * CA net billing (NEM 3.0), one year:
 *   self-consumed = min(usage, production × selfConsumptionShare)
 *   savings = self-consumed × avg retail rate + (production − self-consumed) × avg export credit
 */
export function caSavingsYear(rates: AvgRates, annualUsageKwh: number, annualProductionKwh: number, selfConsumptionShare: number): CaSavings {
  const selfConsumedKwh = Math.min(annualUsageKwh, annualProductionKwh * selfConsumptionShare);
  const exportedKwh = annualProductionKwh - selfConsumedKwh;
  const retailValue = selfConsumedKwh * rates.retailRate;
  const exportValue = exportedKwh * rates.exportCredit;
  return { selfConsumedKwh, exportedKwh, retailValue, exportValue, total: retailValue + exportValue };
}
