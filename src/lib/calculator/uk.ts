/**
 * Calculator glue (pure), shared by the UK, German and Australian calculators (the file keeps its original name; every
 * function takes the market's rows). The island and the page use these to turn validated database rows into the
 * calculateGlobal() context and to format choices. Nothing here invents a number: every value comes from a row, and
 * the only arithmetic is unit conversion (pence to pounds, kWh to a bill, a yield share) that the unit tests check.
 */
import type { CalcLocation, ExportPolicyRecord, GlobalAssumptionsRecord, GlobalCosts, GlobalUtility, IncentiveRecord, Market, VatRate } from '../../data/schemas-global';
import type { GlobalCalcContext } from '../calc/global-types';
import { resolveRates } from '../calc/rates';
import type { ProductionInput, Shading } from '../calc/types';
import type { VatWindow } from '../calc/vat';
import { batteryUsableKwh, calcAssumptions, calcCostLine, calcExportPolicy, calcIncentive, calcVatWindow, marketInfo } from '../db/map-global';
import { installPeriods, periodLabel, type InstallPeriod } from './intl';
import { GB_STRINGS, type Orientation, type SourceLabels } from './intl-strings';

/** Everything the island needs (validated rows, passed as props by the page). */
export interface UkCalculatorProps {
  market: Market;
  /** One per Ofgem price cap region, in display order. */
  utilities: GlobalUtility[];
  locations: CalcLocation[];
  exportPolicies: ExportPolicyRecord[];
  costs: GlobalCosts;
  assumptions: GlobalAssumptionsRecord;
  vatRates: VatRate[];
  /** Incentive rows of the market (AU: the federal battery rebate by date). Absent or empty = none (GB, DE). */
  incentives?: IncentiveRecord[];
  /** ISO date the page was rendered (server clock), the earliest install date offered. */
  today: string;
}

export type { Orientation };
export type UkBattery = 0 | 1;

// ------------------------------------------------------------------ install timing

/** Last install date offered (model_assumptions install_horizon), or null for no limit. */
export const installHorizon = (a: GlobalAssumptionsRecord): string | null => a.install_horizon?.until ?? null;

/**
 * The install-timing periods of a market from its sourced windows (VAT, battery incentives, export-rate windows), from `props.today`
 * to the market's install horizon.
 */
export function installPeriodsFor(props: UkCalculatorProps): InstallPeriod[] {
  return installPeriods({
    vat: props.vatRates.map(calcVatWindow),
    incentives: (props.incentives ?? [])
      .filter((i) => i.status === 'open' || i.status === 'waitlist')
      .map((i) => ({ validFrom: i.effective_from, validTo: i.effective_to, amountLikely: i.amount_likely, perKwhStorage: i.amount_type === 'per_kwh_storage' })),
    exportRates: props.exportPolicies.flatMap((p) => p.rates.map((r) => ({ validFrom: r.valid_from, validTo: r.valid_to }))),
    horizon: installHorizon(props.assumptions),
    today: props.today,
  });
}

export interface InstallOption {
  id: string;
  /** "Installed by 31 March 2027". */
  label: string;
  /** ISO install date the engine runs with. */
  installDate: string;
  /** VAT rate on solar installs on that date (fraction); shown next to the option. */
  solarVat: number;
}

/**
 * Install-timing choices from the solar VAT windows alone (the original GB behaviour, kept for its tests): one choice per
 * period between VAT changes that has not ended before `today`. Empty when there are no solar VAT windows.
 */
export function installOptions(vat: readonly Pick<VatWindow, 'appliesTo' | 'rate' | 'validFrom' | 'validTo'>[], today: string, locale = 'en-GB'): InstallOption[] {
  if (!vat.some((w) => w.appliesTo === 'solar')) return [];
  return installPeriods({ vat, today }).map((p, i) => ({ id: p.id, label: periodLabel(p, i, GB_STRINGS, locale), installDate: p.installDate, solarVat: p.solarVat ?? 0 }));
}

// ------------------------------------------------------------------ export offers

export interface ExportOffer {
  id: string;
  name: string;
  note: string | null;
  /** Minor currency units per kWh (pence, cents: the headline rate published) on the install date; null if no rate row applies. */
  pence: number | null;
  /** Date the rate took effect, when the row states one. */
  since: string | null;
  sourceUrl: string | null;
}

/** currency units to minor units at 2 decimals (0.041 -> 4.1 pence; 0.077 -> 7.7 cents). */
export const poundsToPence = (pounds: number): number => Math.round(pounds * 10000) / 100;

/** The export offers (feed_in and gross-metering policies of the market) with the likely rate that applies on `installDate`, sorted by name. */
export function exportOffers(policies: readonly ExportPolicyRecord[], installDate: string): ExportOffer[] {
  return policies
    .filter((p) => p.kind === 'feed_in' || p.kind === 'gross_metering')
    .map((p) => {
      const w = p.rates
        .filter((r) => (r.valid_from === null || r.valid_from <= installDate) && (r.valid_to === null || r.valid_to >= installDate))
        .sort((a, b) => (b.valid_from ?? '').localeCompare(a.valid_from ?? ''))[0];
      return { id: p.id, name: p.name, note: p.note, pence: w && w.rate_likely !== null ? poundsToPence(w.rate_likely) : null, since: w?.valid_from ?? null, sourceUrl: p.source_url };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
}

// ------------------------------------------------------------------ usage and yield

/**
 * The average monthly bill (GBP) that corresponds to `annualKwh` at a region's unit rate and standing charge: the inverse
 * of how the engine estimates usage from a bill. Null when the region's rate data is incomplete.
 */
export function billFromAnnualKwh(utility: GlobalUtility, annualKwh: number): number | null {
  const r = resolveRates(utility, { needExportCredit: false });
  if (!r.ok || r.value.kind !== 'avg') return null;
  return Math.round((r.value.fixedMonthly + (annualKwh / 12) * r.value.retailRate) * 100) / 100;
}

/** Share of south-facing yield for a roof direction (likely factor); south = 1. Null when the factor is not in the data. */
export function orientationFactor(a: GlobalAssumptionsRecord, o: Orientation): number | null {
  if (o === 'south') return 1;
  return a.orientation_yield_factor?.[o]?.likely ?? null;
}

/** Scale a production record by a yield share (annual and monthly values together). */
export function scaleProduction(p: ProductionInput, factor: number): ProductionInput {
  const out: ProductionInput = { annualKwhPerKw: Math.round(p.annualKwhPerKw * factor * 10) / 10 };
  if (p.monthlyKwhPerKw) out.monthlyKwhPerKw = p.monthlyKwhPerKw.map((m) => Math.round(m * factor * 10) / 10);
  return out;
}

/** The PVGIS system-loss percent for a shade level (model_assumptions.pvwatts_system_loss_pct). */
export const lossesFor = (a: GlobalAssumptionsRecord, shading: Shading): number => a.pvwatts_system_loss_pct[shading];

/** /api/pvgis URL in the endpoint's canonical parameter order (country, lat, lon, losses; 2-decimal coordinates). */
export function pvgisUrl(country: string, lat: number, lon: number, losses: number): string {
  const c = (n: number) => {
    const s = (Math.round(n * 100) / 100).toFixed(2);
    return s === '-0.00' ? '0.00' : s;
  };
  return `/api/pvgis?country=${country}&lat=${c(lat)}&lon=${c(lon)}&losses=${String(losses)}`;
}

// ------------------------------------------------------------------ engine context

export interface UkRun {
  utilityId: string;
  exportPolicyId: string;
}

/**
 * The calculateGlobal() context for one region and one export offer. The export offer is the user's choice, so it
 * is passed explicitly (the utility rows hold no export policy). Null when the region or the offer does not exist.
 */
export function buildUkContext(props: UkCalculatorProps, run: UkRun, production: ProductionInput): GlobalCalcContext | null {
  const utility = props.utilities.find((u) => u.id === run.utilityId);
  const policy = props.exportPolicies.find((p) => p.id === run.exportPolicyId);
  if (!utility || !policy) return null;
  return {
    market: marketInfo(props.market),
    regionCode: utility.region_code,
    utility,
    exportPolicy: calcExportPolicy(policy),
    incentives: (props.incentives ?? []).map(calcIncentive),
    installedCostPerWatt: calcCostLine(props.costs.installed_cost_per_watt),
    batteryInstalledCost: calcCostLine(props.costs.battery_installed_cost),
    batteryUsableKwh: batteryUsableKwh(props.assumptions),
    assumptions: calcAssumptions(props.assumptions),
    production,
    vatSchedule: props.vatRates.map(calcVatWindow),
  };
}

/** Is a battery option usable? Only when the battery cost has a sourced likely value (otherwise it stays disabled). */
export const batteryAvailable = (costs: GlobalCosts): boolean => costs.battery_installed_cost.line.likely !== null;

// ------------------------------------------------------------------ sources list

export interface SourceRef {
  label: string;
  url: string;
  verifiedOn: string;
}

/** The sources behind a run, for the "where the numbers come from" list: region rate, export offer, cost, battery cost, VAT, incentives, yield point. */
export function runSources(props: UkCalculatorProps, run: UkRun, installDate: string, battery: UkBattery, labels: SourceLabels = GB_STRINGS.sources): SourceRef[] {
  const out: SourceRef[] = [];
  const u = props.utilities.find((x) => x.id === run.utilityId);
  if (u?.avg_rate_per_kwh?.source_url && u.avg_rate_per_kwh.verified_on) out.push({ label: labels.price(u.name), url: u.avg_rate_per_kwh.source_url, verifiedOn: u.avg_rate_per_kwh.verified_on });
  const p = props.exportPolicies.find((x) => x.id === run.exportPolicyId);
  if (p?.source_url && p.verified_on) out.push({ label: labels.offer(p.name), url: p.source_url, verifiedOn: p.verified_on });
  const c = props.costs.installed_cost_per_watt.line;
  if (c.source_url && c.verified_on) out.push({ label: labels.solarCost, url: c.source_url, verifiedOn: c.verified_on });
  const b = props.costs.battery_installed_cost.line;
  if (battery > 0 && b.source_url && b.verified_on) out.push({ label: labels.batteryCost, url: b.source_url, verifiedOn: b.verified_on });
  const vat = props.vatRates.find((v) => v.applies_to === 'solar' && (v.valid_from === null || v.valid_from <= installDate) && (v.valid_to === null || v.valid_to >= installDate));
  if (vat) out.push({ label: labels.vat, url: vat.source_url, verifiedOn: vat.verified_on });
  for (const i of props.incentives ?? []) {
    const applies = (i.status === 'open' || i.status === 'waitlist') && (i.effective_from === null || i.effective_from <= installDate) && (i.effective_to === null || i.effective_to >= installDate) && (i.applies_to !== 'battery' || battery > 0);
    if (applies && i.source_url && i.verified_on) out.push({ label: labels.incentive(i.name), url: i.source_url, verifiedOn: i.verified_on });
  }
  const l = props.locations.find((x) => x.utility_id === run.utilityId);
  if (l) out.push({ label: labels.location(l.name), url: l.coord_source_url, verifiedOn: l.verified_on });
  return out;
}

/** The yield point of a region (the island looks production up here). */
export const locationFor = (props: UkCalculatorProps, utilityId: string): CalcLocation | null => props.locations.find((l) => l.utility_id === utilityId) ?? null;
