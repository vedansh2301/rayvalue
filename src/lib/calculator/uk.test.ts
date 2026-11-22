/**
 * UK calculator against a SNAPSHOT of migration 0035 (rows dumped from a database the migration was applied to:
 * src/lib/calculator/__fixtures__/gb-0035.json). Production inputs are real PVGIS 5.3 runs (1 kWp, 14% losses,
 * optimal tilt, south-facing) saved in the research pack on 2026-11-22. Expected values below are what the engine
 * produces from those rows; if a sourced value changes, regenerate the snapshot and review the new outputs.
 */
import { describe, expect, it, vi } from 'vitest';
import snapshot from './__fixtures__/gb-0035.json';
import { calculateGlobal } from '../calc/calculate-global';
import type { GlobalCalcSuccess } from '../calc/global-types';
import { resolveVatRate } from '../calc/vat';
import { createGlobalRepo } from '../db/repo-global';
import { calcVatWindow } from '../db/map-global';
import { loadUkPageData } from './uk-page-data';
import { batteryAvailable, billFromAnnualKwh, buildUkContext, exportOffers, installOptions, locationFor, lossesFor, orientationFactor, poundsToPence, pvgisUrl, runSources, scaleProduction, type UkCalculatorProps } from './uk';

const ENV = { url: 'https://fixture.supabase.co/', key: 'sb_publishable_FIXTUREKEY' };
type Tables = Record<string, Record<string, unknown>[]>;
const tables = snapshot as unknown as Tables;

function fakeRest(t: Tables = tables) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    const table = u.pathname.replace('/rest/v1/', '');
    let rows = t[table] ?? [];
    for (const [k, v] of u.searchParams) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      if (!v.startsWith('eq.')) throw new Error(`unsupported filter ${k}=${v}`);
      rows = rows.filter((r) => String(r[k]) === v.slice(3));
    }
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}
const repo = (t?: Tables) => createGlobalRepo({ env: ENV, fetch: fakeRest(t) as unknown as typeof fetch });

// PVGIS 5.3 PVcalc, 1 kWp, loss 14, optimal tilt, south (research pack raw/pvgis/*.json)
const LONDON = { annualKwhPerKw: 1022.9, monthlyKwhPerKw: [42.7, 55.0, 87.6, 114.5, 117.7, 120.1, 121.1, 109.5, 95.8, 70.2, 50.4, 38.3] };
const MANCHESTER = { annualKwhPerKw: 888.1, monthlyKwhPerKw: [28.1, 46.0, 79.0, 104.6, 111.6, 108.7, 106.3, 96.1, 81.4, 57.7, 39.0, 29.7] };
const ABERDEEN = { annualKwhPerKw: 922.1, monthlyKwhPerKw: [31.2, 49.1, 83.3, 108.1, 122.6, 115.3, 111.8, 102.6, 83.2, 55.9, 35.7, 23.3] };

async function props(today = '2026-11-22'): Promise<UkCalculatorProps> {
  const r = await loadUkPageData(today, repo());
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.props;
}

describe('snapshot of migration 0035 loads through the real loaders and schemas', () => {
  it('validates every table', async () => {
    const p = await props();
    expect(p.utilities).toHaveLength(14);
    expect(p.utilities.every((u) => u.rate_type === 'flat' && u.avg_rate_per_kwh?.likely !== null)).toBe(true);
    expect(p.exportPolicies).toHaveLength(8);
    expect(p.vatRates).toHaveLength(4);
    expect(p.locations).toHaveLength(14);
    expect(p.market.currency).toBe('GBP');
    expect(p.market.vat_rate).toBeNull();
    expect(p.assumptions.orientation_yield_factor?.east_west.likely).toBe(0.789);
  });
  it('reports a load failure instead of guessing (table missing)', async () => {
    const r = await loadUkPageData('2026-11-22', repo({ ...tables, vat_rates: [{ id: 'bad', country: 'GB' }] }));
    expect(r.ok).toBe(false);
  });
  it('has a sourced battery cost (the option is enabled) and no incentive rows are needed', async () => {
    const p = await props();
    expect(batteryAvailable(p.costs)).toBe(true);
    const noBattery = { ...p.costs, battery_installed_cost: { ...p.costs.battery_installed_cost, line: { ...p.costs.battery_installed_cost.line, low: null, likely: null, high: null, source_url: null, verified_on: null, verification: 'unverified' as const } } };
    expect(batteryAvailable(noBattery)).toBe(false);
  });
});

describe('date-effective VAT', () => {
  it('0% to 31 Mar 2027, 5% from 1 Apr 2027, for solar and batteries; a date before any window is missing data', async () => {
    const w = (await props()).vatRates.map(calcVatWindow);
    for (const item of ['solar', 'battery'] as const) {
      expect(resolveVatRate(w, item, '2026-11-22', 'GB')).toEqual({ ok: true, value: 0 });
      expect(resolveVatRate(w, item, '2027-03-31', 'GB')).toEqual({ ok: true, value: 0 });
      expect(resolveVatRate(w, item, '2027-04-01', 'GB')).toEqual({ ok: true, value: 0.05 });
      expect(resolveVatRate(w, item, '2031-01-01', 'GB')).toEqual({ ok: true, value: 0.05 });
    }
    expect(resolveVatRate(w, 'solar', '2023-04-30', 'GB')).toEqual({ ok: false, missing: ['vat_rates[GB/solar@2023-04-30]'] });
    expect(resolveVatRate([], 'solar', '2026-11-22', 'GB')).toEqual({ ok: false, missing: ['vat_rates[GB/solar@2026-11-22]'] });
  });
  it('install options follow the windows that have not ended', async () => {
    const o = installOptions((await props()).vatRates.map(calcVatWindow), '2026-11-22');
    expect(o.map((x) => [x.label, x.installDate, x.solarVat])).toEqual([
      ['Installed by 31 March 2027', '2026-11-22', 0],
      ['Installed from 1 April 2027', '2027-04-01', 0.05],
    ]);
    // After the zero-rate window only the 5% choice remains.
    expect(installOptions((await props()).vatRates.map(calcVatWindow), '2027-05-10').map((x) => [x.installDate, x.solarVat])).toEqual([['2027-05-10', 0.05]]);
  });
  it('the same system costs 5% more after the zero-rate window ends (solar cost line is ex-VAT)', async () => {
    const p = await props();
    const run = { utilityId: 'gb-cap-london', exportPolicyId: 'gb-octopus-seg-fixed' };
    const a = calculateGlobal({ utilityId: run.utilityId, avgMonthlyBill: 100, battery: 0, shading: 'none', installDate: '2027-01-15' }, buildUkContext(p, run, LONDON)!) as GlobalCalcSuccess;
    const b = calculateGlobal({ utilityId: run.utilityId, avgMonthlyBill: 100, battery: 0, shading: 'none', installDate: '2027-04-01' }, buildUkContext(p, run, LONDON)!) as GlobalCalcSuccess;
    expect(a.ok && b.ok).toBe(true);
    expect(b.cost.likely / a.cost.likely).toBeCloseTo(1.05, 1);
    expect(b.paybackYears.likely!).toBeGreaterThan(a.paybackYears.likely!);
    expect(a.assumptions.some((t) => t.startsWith('VAT on the installation on 2027-01-15: 0%'))).toBe(true);
    expect(b.assumptions.some((t) => t.startsWith('VAT on the installation on 2027-04-01: 5%'))).toBe(true);
  });
});

describe('export offers', () => {
  it('shows the headline pence per kWh on the install date, sorted by name', async () => {
    const o = exportOffers((await props()).exportPolicies, '2026-11-22');
    const by = Object.fromEntries(o.map((x) => [x.id, x.pence]));
    expect(by).toEqual({
      'gb-british-gas-export-premium': 12,
      'gb-british-gas-export-seg': 3,
      'gb-edf-export-12m': 13,
      'gb-edf-seg-export-variable': 2,
      'gb-eon-next-flex-export': 6,
      'gb-octopus-outgoing': 12,
      'gb-octopus-seg-fixed': 4.1,
      'gb-ovo-seg': 4,
    });
    expect(o.map((x) => x.name)).toEqual([...o.map((x) => x.name)].sort((a, b) => a.localeCompare(b, 'en-GB')));
    // EDF's 2.0p only applies from 28 Oct 2026: before then no rate row matches.
    expect(exportOffers((await props()).exportPolicies, '2026-10-01').find((x) => x.id === 'gb-edf-seg-export-variable')?.pence).toBeNull();
  });
  it('pence conversion has no float noise', () => {
    expect(poundsToPence(0.041)).toBe(4.1);
    expect(poundsToPence(0.12)).toBe(12);
    expect(poundsToPence(0.02)).toBe(2);
  });
});

describe('inputs and yield helpers', () => {
  it('annual kWh round-trips through the bill the engine inverts', async () => {
    const p = await props();
    const u = p.utilities.find((x) => x.id === 'gb-cap-north-western-england')!;
    const bill = billFromAnnualKwh(u, 3100)!;
    // 3,100 kWh at 26.49p + 45.68p/day standing charge (x365/12 = GBP 13.90 a month, as stored)
    expect(bill).toBeCloseTo(13.9 + (3100 / 12) * 0.2649, 1);
    const res = calculateGlobal({ utilityId: u.id, avgMonthlyBill: bill, battery: 0, shading: 'none', installDate: '2026-11-22' }, buildUkContext(p, { utilityId: u.id, exportPolicyId: 'gb-ovo-seg' }, MANCHESTER)!) as GlobalCalcSuccess;
    expect(res.ok && res.annualUsageKwh).toBeGreaterThan(3000);
    expect(res.ok && res.annualUsageKwh).toBeLessThan(3200);
  });
  it('orientation factors and production scaling', async () => {
    const p = await props();
    expect(orientationFactor(p.assumptions, 'south')).toBe(1);
    expect(orientationFactor(p.assumptions, 'east_west')).toBe(0.789);
    expect(orientationFactor(p.assumptions, 'north')).toBe(0.537);
    const s = scaleProduction({ annualKwhPerKw: 1000, monthlyKwhPerKw: [100, 50] }, 0.789);
    expect(s).toEqual({ annualKwhPerKw: 789, monthlyKwhPerKw: [78.9, 39.5] });
    expect(scaleProduction({ annualKwhPerKw: 1000 }, 1)).toEqual({ annualKwhPerKw: 1000 });
  });
  it('losses per shade level and the canonical proxy URL', async () => {
    const p = await props();
    expect([lossesFor(p.assumptions, 'none'), lossesFor(p.assumptions, 'some'), lossesFor(p.assumptions, 'heavy')]).toEqual([14, 20, 30]);
    expect(pvgisUrl('GB', 51.5072, -0.1275, 14)).toBe('/api/pvgis?country=GB&lat=51.51&lon=-0.13&losses=14');
    expect(pvgisUrl('GB', 57.15, -2.11, 20)).toBe('/api/pvgis?country=GB&lat=57.15&lon=-2.11&losses=20');
    expect(locationFor(p, 'gb-cap-london')?.name).toBe('London');
    expect(locationFor(p, 'nope')).toBeNull();
  });
  it('context building fails (null) for an unknown region or offer', async () => {
    const p = await props();
    expect(buildUkContext(p, { utilityId: 'x', exportPolicyId: 'gb-ovo-seg' }, LONDON)).toBeNull();
    expect(buildUkContext(p, { utilityId: 'gb-cap-london', exportPolicyId: 'x' }, LONDON)).toBeNull();
  });
  it('sources list names rate, export, cost, VAT and yield point, each with a URL and date', async () => {
    const p = await props();
    const s = runSources(p, { utilityId: 'gb-cap-london', exportPolicyId: 'gb-ovo-seg' }, '2026-11-22', 1);
    expect(s.map((x) => x.label.split(':')[0]!.split(' (')[0])).toEqual(['Electricity price', 'Export payment', 'Installed solar cost', 'Installed battery cost', 'VAT on solar installation', 'Coordinates used for solar yield']);
    expect(s.every((x) => x.url.startsWith('https://') && /^\d{4}-\d{2}-\d{2}$/.test(x.verifiedOn))).toBe(true);
    expect(runSources(p, { utilityId: 'gb-cap-london', exportPolicyId: 'gb-ovo-seg' }, '2026-11-22', 0).some((x) => x.label.includes('battery'))).toBe(false);
  });
});

describe('engine regression for UK inputs (snapshot rows, real PVGIS yield)', () => {
  const calc = async (utilityId: string, exportPolicyId: string, production: typeof LONDON, bill: number, battery: 0 | 1, installDate: string, shading: 'none' | 'some' | 'heavy' = 'none') => {
    const p = await props();
    return calculateGlobal({ utilityId, avgMonthlyBill: bill, battery, shading, installDate }, buildUkContext(p, { utilityId, exportPolicyId }, production)!);
  };

  it('scenario A: London, GBP 90 a month, Octopus SEG 4.1p, solar only, install before 1 April 2027', async () => {
    const r = (await calc('gb-cap-london', 'gb-octopus-seg-fixed', LONDON, 90, 0, '2026-11-22')) as GlobalCalcSuccess;
    expect(r.ok).toBe(true);
    expect(r.country).toBe('GB');
    expect(r.currency).toBe('GBP');
    expect(r.upfrontIncentive).toEqual({ low: 0, likely: 0, high: 0 });
    expect(r.size.likely).toBeCloseTo(3.1, 1);
    expect(r.cost.low).toBeLessThan(r.cost.likely);
    expect(r.cost.likely).toBeLessThan(r.cost.high);
    expect(r.paybackYears.likely).not.toBeNull();
    expect(r.paybackYears.low!).toBeLessThanOrEqual(r.paybackYears.likely!);
    expect(r.assumptions.join(' ')).toContain('£');
    expect(r.assumptions.join(' ')).not.toContain('$');
    expect(r.assumptions.join(' ')).not.toMatch(/25D|federal/i);
    expect(r.assumptions.some((t) => t.startsWith('No incentive is included'))).toBe(true);
    // export rate bounds are estimated (the offers publish one headline rate)
    expect(r.assumptions.some((t) => t.includes('bounds of the export rate are estimated'))).toBe(true);
    expect({ size: r.size, cost: r.cost, year1: r.year1Savings, payback: r.paybackYears, net: r.netSavings25 }).toMatchSnapshot();
  });

  it('scenario B: Manchester (North Western), GBP 140 a month, Outgoing Octopus 12p, 1 battery, install from 1 April 2027', async () => {
    const r = (await calc('gb-cap-north-western-england', 'gb-octopus-outgoing', MANCHESTER, 140, 1, '2027-04-01')) as GlobalCalcSuccess;
    expect(r.ok).toBe(true);
    expect(r.assumptions.some((t) => t.includes('VAT on the installation on 2027-04-01: 5%'))).toBe(true);
    expect(r.assumptions.some((t) => t.startsWith('1 battery system at'))).toBe(true);
    expect({ size: r.size, cost: r.cost, year1: r.year1Savings, payback: r.paybackYears, net: r.netSavings25 }).toMatchSnapshot();
  });

  it('scenario C: Aberdeen (Northern Scotland), GBP 60 a month, EDF SEG 2.0p, low usage', async () => {
    const r = (await calc('gb-cap-northern-scotland', 'gb-edf-seg-export-variable', ABERDEEN, 60, 0, '2026-12-01')) as GlobalCalcSuccess;
    expect(r.ok).toBe(true);
    expect({ size: r.size, cost: r.cost, year1: r.year1Savings, payback: r.paybackYears, net: r.netSavings25 }).toMatchSnapshot();
  });

  it('a better export rate and a battery change the result in the expected direction', async () => {
    const low = (await calc('gb-cap-london', 'gb-edf-seg-export-variable', LONDON, 90, 0, '2026-11-22')) as GlobalCalcSuccess;
    const high = (await calc('gb-cap-london', 'gb-octopus-outgoing', LONDON, 90, 0, '2026-11-22')) as GlobalCalcSuccess;
    expect(high.year1Savings.likely).toBeGreaterThan(low.year1Savings.likely);
    const withBattery = (await calc('gb-cap-london', 'gb-octopus-outgoing', LONDON, 90, 1, '2026-11-22')) as GlobalCalcSuccess;
    expect(withBattery.cost.likely).toBeGreaterThan(high.cost.likely + 5000);
  });

  it('an east/west roof needs a bigger, dearer system for the same usage and pays back later', async () => {
    const p = await props();
    const f = orientationFactor(p.assumptions, 'east_west')!;
    const south = (await calc('gb-cap-london', 'gb-ovo-seg', LONDON, 90, 0, '2026-11-22')) as GlobalCalcSuccess;
    const ew = (await calc('gb-cap-london', 'gb-ovo-seg', scaleProduction(LONDON, f) as typeof LONDON, 90, 0, '2026-11-22')) as GlobalCalcSuccess;
    expect(ew.size.likely).toBeGreaterThan(south.size.likely);
    expect(ew.cost.likely).toBeGreaterThan(south.cost.likely);
    expect(ew.paybackYears.likely!).toBeGreaterThanOrEqual(south.paybackYears.likely!);
  });

  it('a missing VAT window is reported as missing data, never defaulted', async () => {
    const p = await props();
    const ctx = buildUkContext({ ...p, vatRates: p.vatRates.filter((v) => v.applies_to === 'battery') }, { utilityId: 'gb-cap-london', exportPolicyId: 'gb-ovo-seg' }, LONDON)!;
    const r = calculateGlobal({ utilityId: 'gb-cap-london', avgMonthlyBill: 90, battery: 0, shading: 'none', installDate: '2026-11-22' }, ctx);
    expect(r).toEqual({ ok: false, reason: 'missing_data', missing: ['vat_rates[GB/solar@2026-11-22]'] });
  });

  it('invalid bills and unknown regions still fail as before', async () => {
    expect(await calc('gb-cap-london', 'gb-ovo-seg', LONDON, 0, 0, '2026-11-22')).toMatchObject({ ok: false, reason: 'invalid_bill' });
    expect(await calc('gb-cap-london', 'gb-ovo-seg', LONDON, 5000, 0, '2026-11-22')).toMatchObject({ ok: false, reason: 'invalid_bill' });
  });
});
