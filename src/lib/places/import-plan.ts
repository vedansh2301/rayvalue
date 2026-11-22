/**
 * Pure planning for the places import: place rows (with region codes and coordinates), fact rows, and the dry-run gate
 * report (how many places would pass the >= 3 sourced sections gate). No I/O.
 */
import { parseCsvObjects } from '../scrape/csv.ts';
import type { PlaceCountryCode } from './config.ts';
import { MIN_SECTIONS, evaluatePlace, type SectionId } from './gate.ts';
import { mapPackFacts, placeKey, type PackFact, type PackPlace, type PlaceFactInsert } from './pack.ts';
import type { PlaceFact } from './schema.ts';

export interface PlaceInsert {
  country: PlaceCountryCode;
  region_code: string;
  slug: string;
  name: string;
  lat: number | null;
  lon: number | null;
  coord_source_url: string | null;
}

export interface CoordRow { region: string; slug: string; lat: string; lon: string; source_url: string }

export const coordsFromCsv = (csv: string): CoordRow[] => parseCsvObjects(csv) as unknown as CoordRow[];

export interface CountryPlan {
  country: PlaceCountryCode;
  places: PlaceInsert[];
  facts: PlaceFactInsert[];
  skippedFacts: Record<string, number>;
  /** Places whose region slug is not in the regions table. */
  unknownRegion: string[];
  gate: GateReport;
}

export interface GateReport {
  places: number;
  /** published is false for every imported place, so this counts places that WOULD render once published. */
  pass: number;
  fail: number;
  bySectionCount: Record<number, number>;
  sectionTotals: Partial<Record<SectionId, number>>;
}

export function planCountry(
  country: PlaceCountryCode,
  packPlaces: readonly PackPlace[],
  regions: readonly { country: string; code: string; name: string; slug: string }[],
  pack: readonly PackFact[],
  extra: readonly PackFact[],
  coords: readonly CoordRow[],
): CountryPlan {
  const mine = regions.filter((r) => r.country === country);
  const regionBySlug = new Map(mine.map((r) => [r.slug, r]));
  const regionNames = Object.fromEntries(mine.map((r) => [r.slug, r.name]));
  const coordBy = new Map(coords.map((c) => [`${c.region}/${c.slug}`, c]));
  const unknownRegion: string[] = [];
  const places: PlaceInsert[] = [];
  const kept: PackPlace[] = [];
  for (const p of packPlaces) {
    const r = regionBySlug.get(p.regionSlug);
    if (!r) { unknownRegion.push(`${p.regionSlug}/${p.slug}`); continue; }
    const c = coordBy.get(`${p.regionSlug}/${p.slug}`);
    const lat = c && Number.isFinite(Number(c.lat)) ? Number(c.lat) : null;
    const lon = c && Number.isFinite(Number(c.lon)) ? Number(c.lon) : null;
    const ok = lat !== null && lon !== null && /^https?:\/\//.test(c?.source_url ?? '');
    places.push({ country, region_code: r.code, slug: p.slug, name: p.name, lat: ok ? lat : null, lon: ok ? lon : null, coord_source_url: ok ? c!.source_url : null });
    kept.push(p);
  }
  const mapped = mapPackFacts(country, kept, pack, extra, { regionNames });
  return { country, places, facts: mapped.facts, skippedFacts: mapped.skipped, unknownRegion, gate: gateReport(country, kept, mapped.facts) };
}

const toFact = (f: PlaceFactInsert): PlaceFact => ({
  key: f.key, value_num: f.value_num, value_text: f.value_text, unit: f.unit, period: f.period, scope: f.scope, scope_label: f.scope_label,
  source_url: f.source_url, publisher: f.publisher, verified_on: f.verified_on, confidence: f.confidence, status: f.status, note: f.note,
});

/** Runs the real gate over the planned rows, as if every place were published. */
export function gateReport(country: PlaceCountryCode, places: readonly PackPlace[], facts: readonly PlaceFactInsert[]): GateReport {
  const byPlace = new Map<string, PlaceFact[]>();
  for (const f of facts) byPlace.set(f.place, [...(byPlace.get(f.place) ?? []), toFact(f)]);
  const report: GateReport = { places: places.length, pass: 0, fail: 0, bySectionCount: {}, sectionTotals: {} };
  for (const p of places) {
    const g = evaluatePlace(country, { published: true, place_facts: byPlace.get(placeKey(p)) ?? [] });
    if (g.sections.length >= MIN_SECTIONS) report.pass++; else report.fail++;
    report.bySectionCount[g.sections.length] = (report.bySectionCount[g.sections.length] ?? 0) + 1;
    for (const s of g.sections) report.sectionTotals[s] = (report.sectionTotals[s] ?? 0) + 1;
  }
  return report;
}
