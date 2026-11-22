/**
 * Pure mapping of a rvplan country pack (pages.csv + facts.csv, plus optional places_coords.csv / places_yield.csv from
 * scripts/places/fetch-yield.ts) to `places` and `place_facts` rows. No I/O: the import script reads the files and talks
 * to the database; everything decided here is unit tested.
 *
 * Rules: only facts with an http(s) source_url, a value and a retrieved_on date are imported; secondary confidence is
 * kept and flagged; regional / network figures are copied onto each place with scope + scope_label; PVGIS rows from the
 * fetch script replace the pack's own yield rows for the same key (one provider, one method per country).
 */
import { parseCsvObjects } from '../scrape/csv.ts';
import type { PlaceCountryCode } from './config.ts';
import { ALLOWED_KEYS } from './gate.ts';

export interface PackPlace {
  country: PlaceCountryCode;
  regionSlug: string;
  slug: string;
  name: string;
}

export interface PackFact {
  key: string;
  region: string;
  value: string;
  unit: string;
  valid_from: string;
  valid_to: string;
  source_url: string;
  publisher: string;
  retrieved_on: string;
  excerpt: string;
  confidence: string;
}

export interface PlaceFactInsert {
  /** `${country}/${regionSlug}/${slug}` */
  place: string;
  key: string;
  value_num: number | null;
  value_text: string | null;
  unit: string;
  period: string;
  scope: 'place' | 'region' | 'network';
  scope_label: string | null;
  source_url: string;
  publisher: string | null;
  verified_on: string;
  confidence: 'primary' | 'secondary';
  status: 'agent_sourced';
  note: string | null;
}

export const placeKey = (p: Pick<PackPlace, 'country' | 'regionSlug' | 'slug'>): string => `${p.country}/${p.regionSlug}/${p.slug}`;

const TITLE_NAME: Record<PlaceCountryCode, RegExp> = {
  GB: / in (.+?)\?$/,
  DE: / in (.+?): /,
  AU: / in (.+?): /,
};
const titleCase = (slug: string): string => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** City rows of pages.csv: /<cc>/<topic>/<region>/<slug>, with the name taken from the page title. */
export function parsePackPlaces(country: PlaceCountryCode, pagesCsv: string): PackPlace[] {
  const out: PackPlace[] = [];
  const seen = new Set<string>();
  for (const r of parseCsvObjects(pagesCsv)) {
    if (r.page_type !== 'city') continue;
    const parts = (r.url ?? '').split('/');
    if (parts.length !== 5) continue;
    const regionSlug = parts[3]!;
    const slug = parts[4]!;
    const k = `${regionSlug}/${slug}`;
    if (seen.has(k) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(regionSlug)) continue;
    seen.add(k);
    const name = TITLE_NAME[country].exec(r.title ?? '')?.[1]?.trim() || titleCase(slug);
    out.push({ country, regionSlug, slug, name });
  }
  return out;
}

export function packFactsFromCsv(csv: string): PackFact[] {
  return parseCsvObjects(csv).map((r) => ({
    key: r.key ?? '', region: r.region ?? '', value: r.value ?? '', unit: r.unit ?? '', valid_from: r.valid_from ?? '', valid_to: r.valid_to ?? '',
    source_url: r.source_url ?? '', publisher: r.publisher ?? '', retrieved_on: r.retrieved_on ?? '', excerpt: r.excerpt ?? '', confidence: r.confidence ?? '',
  }));
}

/** Where a pack fact for this place is filed in facts.csv `region`. */
export function placeLocator(p: PackPlace): string {
  return p.country === 'GB' ? p.slug : p.country === 'AU' ? `${p.regionSlug}/${p.slug}` : `city:${p.slug}`;
}

export const slugify = (s: string): string => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const NETWORK_NAMES: Readonly<Record<string, string>> = { ausgrid: 'Ausgrid', energex: 'Energex', 'sa-power-networks': 'SA Power Networks', 'endeavour-energy': 'Endeavour Energy', 'essential-energy': 'Essential Energy' };
export const networkDisplayName = (slug: string): string => NETWORK_NAMES[slug] ?? titleCase(slug);

/** valid_from / valid_to -> '' | 'YYYY-MM-DD' | 'from/to'. */
export function periodOf(from: string, to: string): string {
  if (!from && !to) return '';
  if (!to || to === from) return from;
  if (!from) return to;
  return `${from}/${to}`;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
const HTTP = /^https?:\/\/\S+$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface MapOptions {
  /** Region names by slug, for the scope label of regional figures (from the regions table / migration seed). */
  regionNames: Readonly<Record<string, string>>;
  /** Pack rows for these keys are dropped for this country (a fetched replacement is supplied in `extra`). */
  replaceKeys?: ReadonlySet<string>;
}

export interface MapReport {
  facts: PlaceFactInsert[];
  /** Pack rows not imported, by reason. */
  skipped: Record<string, number>;
}

export function mapPackFacts(country: PlaceCountryCode, places: readonly PackPlace[], pack: readonly PackFact[], extra: readonly PackFact[], opts: MapOptions): MapReport {
  const allowed = new Set(ALLOWED_KEYS[country]);
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const replace = opts.replaceKeys ?? new Set(extra.map((f) => f.key));

  const idx = new Map<string, PackFact[]>();
  const add = (f: PackFact) => {
    if (!allowed.has(f.key)) return skip('key not shown on place pages');
    const k = `${f.key}|${f.region}`;
    idx.set(k, [...(idx.get(k) ?? []), f]);
  };
  for (const f of pack) {
    if (replace.has(f.key)) { skip('replaced by fetched rows'); continue; }
    add(f);
  }
  for (const f of extra) add(f);
  const rowsFor = (key: string, loc: string): PackFact[] => idx.get(`${key}|${loc}`) ?? [];

  const out: PlaceFactInsert[] = [];
  const seen = new Set<string>();
  const push = (p: PackPlace, f: PackFact, scope: PlaceFactInsert['scope'], label: string | null) => {
    const verified = f.retrieved_on;
    if (!HTTP.test(f.source_url)) return skip('no source_url');
    if (!ISO.test(verified)) return skip('no retrieved_on date');
    const value = f.value.trim();
    if (value === '') return skip('no value');
    const monthly = f.key === 'solar_yield_monthly_kwh_per_kwp' ? /month (\d{1,2})\b/.exec(f.unit)?.[1] : undefined;
    if (f.key === 'solar_yield_monthly_kwh_per_kwp' && !monthly) return skip('monthly row without month');
    const period = monthly ? `m${monthly.padStart(2, '0')}` : periodOf(f.valid_from, f.valid_to);
    const unit = monthly ? 'kWh/kWp' : f.unit;
    let text: string | null = NUMERIC.test(value) ? null : value;
    if (f.key === 'network_for_place' && text) text = networkDisplayName(text);
    const k = `${placeKey(p)}|${f.key}|${period}|${unit}`;
    if (seen.has(k)) return skip('duplicate');
    seen.add(k);
    out.push({
      place: placeKey(p), key: f.key, value_num: text === null ? Number(value) : null, value_text: text, unit, period, scope, scope_label: scope === 'place' ? null : label,
      source_url: f.source_url, publisher: f.publisher || null, verified_on: verified, confidence: f.confidence === 'secondary' ? 'secondary' : 'primary', status: 'agent_sourced',
      note: f.excerpt ? f.excerpt.slice(0, 300) : null,
    });
  };

  for (const p of places) {
    const loc = placeLocator(p);
    // GB price-cap rates are the Ofgem REGION's, so they are filed below with scope 'region', never as place figures.
    for (const key of allowed) {
      if (country === 'GB' && (key === 'price_cap_unit_rate_dd' || key === 'price_cap_standing_charge_dd')) continue;
      for (const f of rowsFor(key, loc)) push(p, f, 'place', null);
    }

    if (country === 'GB') {
      const cap = rowsFor('price_cap_region', loc)[0]?.value;
      if (cap) {
        for (const key of ['price_cap_unit_rate_dd', 'price_cap_standing_charge_dd']) for (const f of rowsFor(key, `cap-${slugify(cap)}`)) push(p, f, 'region', cap);
      }
      for (const key of ['avg_install_cost_per_kw_0_4kw_mean', 'avg_install_cost_per_kw_4_10kw_mean']) {
        for (const f of rowsFor(key, p.regionSlug)) push(p, f, 'region', opts.regionNames[p.regionSlug] ?? titleCase(p.regionSlug));
      }
    }
    if (country === 'AU') {
      const net = rowsFor('network_for_place', loc)[0]?.value;
      if (net) {
        for (const key of ['dmo_annual_price_flat', 'dmo_flat_usage_rate', 'dmo_flat_supply_charge', 'dmo_annual_usage_assumed']) for (const f of rowsFor(key, `${p.regionSlug}/${net}`)) push(p, f, 'network', networkDisplayName(net));
      }
    }
  }
  return { facts: out, skipped };
}

/** Region (slug -> name) pairs from the regions INSERT in migration 0033, so a dry run needs no database. */
export function regionsFromMigration(sql: string): { country: string; code: string; name: string; slug: string }[] {
  const out: { country: string; code: string; name: string; slug: string }[] = [];
  for (const m of sql.matchAll(/\('(GB|DE|AU)',\s*'([A-Z0-9-]+)',\s*'([^']+)',\s*'([a-z0-9-]+)'/g)) out.push({ country: m[1]!, code: m[2]!, name: m[3]!, slug: m[4]! });
  return out;
}
