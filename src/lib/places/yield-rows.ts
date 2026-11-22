/**
 * Turns one PVGIS result (from the same proxy logic the calculator uses: equator-facing, optimal tilt) into pack-format
 * fact rows, and reads the method note back for display. Pure.
 */
import type { PackFact } from './pack.ts';

export interface YieldResultLike {
  annualKwhPerKw: number;
  monthlyKwhPerKw: readonly number[];
  dataset: string;
  tiltDeg: number | null;
  compassAzimuthDeg: number;
}

/** "db=PVGIS-SARAH3;tilt=43;azimuth=180;loss=14": language-neutral; the page words it per locale. */
export function yieldNote(r: YieldResultLike, lossPct: number): string {
  const tilt = r.tiltDeg === null ? '' : `;tilt=${r.tiltDeg}`;
  const az = Number.isFinite(r.compassAzimuthDeg) ? `;azimuth=${Math.round(r.compassAzimuthDeg)}` : '';
  return `db=${r.dataset}${tilt}${az};loss=${lossPct}`;
}

export interface YieldNote { db: string; tilt: number | null; azimuth: number | null; loss: number | null }

export function parseYieldNote(note: string | null): YieldNote | null {
  if (!note) return null;
  const kv = Object.fromEntries(note.split(';').map((p) => p.split('=') as [string, string]));
  if (!kv.db) return null;
  const n = (v: string | undefined): number | null => (v !== undefined && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null);
  return { db: kv.db, tilt: n(kv.tilt), azimuth: n(kv.azimuth), loss: n(kv.loss) };
}

/** 1 annual row + 12 monthly rows for a place, filed under `locator` (the pack's facts.csv region value). */
export function yieldFactRows(locator: string, upstreamUrl: string, r: YieldResultLike, lossPct: number, retrievedOn: string): PackFact[] {
  const common = { region: locator, valid_from: '', valid_to: '', source_url: upstreamUrl, publisher: 'EU JRC PVGIS 5.3', retrieved_on: retrievedOn, confidence: 'primary' };
  const note = yieldNote(r, lossPct);
  const rows: PackFact[] = [{ ...common, key: 'solar_yield_kwh_per_kwp', value: String(r.annualKwhPerKw), unit: 'kWh/kWp/yr', excerpt: note }];
  r.monthlyKwhPerKw.forEach((v, i) => rows.push({ ...common, key: 'solar_yield_monthly_kwh_per_kwp', value: String(v), unit: `kWh/kWp (month ${i + 1})`, excerpt: `month=${i + 1}; ${note}` }));
  return rows;
}

const WKT = /^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/;
/** Wikidata P625 as "Point(lon lat)" -> { lat, lon } rounded to 4 decimals, or null. */
export function parseWktPoint(wkt: string): { lat: number; lon: number } | null {
  const m = WKT.exec(wkt.trim());
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

/** lat/lon from a PVGIS URL (the pack's existing yield rows carry the coordinates they were fetched at). */
export function coordsFromPvgisUrl(url: string): { lat: number; lon: number } | null {
  const lat = /[?&]lat=(-?\d+(?:\.\d+)?)/.exec(url)?.[1];
  const lon = /[?&]lon=(-?\d+(?:\.\d+)?)/.exec(url)?.[1];
  return lat !== undefined && lon !== undefined ? { lat: Number(lat), lon: Number(lon) } : null;
}
