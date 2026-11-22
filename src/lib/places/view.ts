/**
 * Builds everything a place page prints from the place's sourced facts. Pure. The page component only prints this view
 * model: it computes nothing. A section appears only when it has a sourced fact (see gate.ts); a line appears only when
 * its fact has a value, a source URL and a check date; there are no placeholders and no typed-in numbers.
 */
import type { KeyNumber, KeyNumbersBlock } from '../seo/key-numbers.ts';
import { maxDate } from '../seo/lastmod.ts';
import { placeCountryByCode, placePath, regionHubPath, type PlaceCountry } from './config.ts';
import { SECTION_KEYS, evaluatePlace, isSourcedFact, type SectionId } from './gate.ts';
import { formatDate, formatMoney, formatNumber, formatPercent, formatPeriod, monthLabels } from './format.ts';
import { PLACE_TEXT, type PlaceDict } from './i18n.ts';
import { parseYieldNote } from './yield-rows.ts';
import type { PlaceFact, PlaceRegion, PlaceWithFacts } from './schema.ts';

export interface ViewLine {
  label: string;
  value: string;
  source: { label: string; url: string } | null;
  checkedOn: string | null;
  checkedIso: string | null;
  note: string | null;
}

export interface ViewSection {
  id: SectionId;
  heading: string;
  intro: string | null;
  lines: ViewLine[];
  chart: { monthly: number[]; annual: string | null; months: string[]; method: string | null } | null;
}

export interface PlaceView {
  country: PlaceCountry;
  lang: string;
  path: string;
  hubPath: string;
  regionName: string;
  name: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  keyNumbersHeading: string;
  keyNumbers: KeyNumbersBlock;
  sections: ViewSection[];
  /** Newest verified_on among the facts shown, ISO. */
  checkedIso: string | null;
  text: PlaceDict;
}

type Kind = 'int' | 'dec1' | 'dec2' | 'pct' | 'money' | 'text';
/** How each fact key is formatted. `dataUnit`: print the unit stored with the fact (for rates whose unit carries VAT / GST terms). */
const FORMATS: Readonly<Record<string, { kind: Kind; dataUnit?: boolean; showNote?: boolean }>> = {
  solar_yield_kwh_per_kwp: { kind: 'int' },
  price_cap_region: { kind: 'text' },
  price_cap_unit_rate_dd: { kind: 'dec2', dataUnit: true },
  price_cap_standing_charge_dd: { kind: 'dec2', dataUnit: true },
  pv_installations_cumulative: { kind: 'int' },
  pv_installations_per_1000_households: { kind: 'dec1' },
  pv_capacity_mw_cumulative: { kind: 'dec1' },
  homeownership_pct: { kind: 'pct' },
  houses_pct: { kind: 'pct' },
  avg_install_cost_per_kw_0_4kw_mean: { kind: 'money' },
  avg_install_cost_per_kw_4_10kw_mean: { kind: 'money' },
  owner_occupier_rate_zensus2022: { kind: 'pct' },
  single_dwelling_building_share: { kind: 'pct' },
  heatpump_solar_heated_building_share: { kind: 'pct' },
  mastr_pv_units_in_operation: { kind: 'int' },
  stc_zone: { kind: 'text' },
  network_for_place: { kind: 'text' },
  dmo_annual_price_flat: { kind: 'int', dataUnit: true },
  dmo_annual_usage_assumed: { kind: 'int', dataUnit: true },
  dmo_flat_usage_rate: { kind: 'dec2', dataUnit: true },
  dmo_flat_supply_charge: { kind: 'dec2', dataUnit: true },
  cer_solar_pv_installations_postcode: { kind: 'int', showNote: true },
  cer_solar_pv_capacity_postcode: { kind: 'int', showNote: true },
  cer_battery_installations_postcode: { kind: 'int', showNote: true },
  separate_houses_postal_area: { kind: 'int' },
  occupied_private_dwellings: { kind: 'int' },
  separate_house_pct: { kind: 'pct' },
};

/** Candidate facts to display: have a value, an http source and a check date, and are not "unverified". */
const displayable = (f: PlaceFact): boolean => isSourcedFact({ ...f, confidence: 'primary' });

/** The fact to show for a key: primary over secondary, then the latest period. */
export function pickFact(facts: readonly PlaceFact[], key: string): PlaceFact | null {
  const c = facts.filter((f) => f.key === key && displayable(f));
  if (c.length === 0) return null;
  return [...c].sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'primary' ? -1 : 1) || (a.period < b.period ? 1 : a.period > b.period ? -1 : 0))[0] ?? null;
}

/** The 12 monthly yield values when all of m01..m12 are sourced, else null. */
export function monthlyYield(facts: readonly PlaceFact[]): number[] | null {
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const f = facts.find((x) => x.key === 'solar_yield_monthly_kwh_per_kwp' && x.period === `m${String(m).padStart(2, '0')}` && displayable(x) && x.value_num !== null);
    if (!f || f.value_num === null) return null;
    out.push(f.value_num);
  }
  return out;
}

/** "Census 2021 G37 (Greater Sydney (GCCSA)): occupied ..." -> "Greater Sydney (GCCSA)"; null when the note has no area. */
export function censusAreaFromNote(note: string | null): string | null {
  const m = /^Census 2021 G37 \((.+?)\): /.exec(note ?? '');
  return m?.[1] ?? null;
}

function formatValue(f: PlaceFact, kind: Kind, country: PlaceCountry, dataUnit: boolean, unitSuffix: string | undefined): string {
  const loc = country.locale;
  if (kind === 'text' || f.value_num === null) return f.value_text ?? '';
  const n = f.value_num;
  let v: string;
  if (kind === 'int') v = formatNumber(n, loc, 0);
  else if (kind === 'dec1') v = formatNumber(n, loc, 1, 1);
  else if (kind === 'dec2') v = formatNumber(n, loc, 2, 2);
  else if (kind === 'pct') return formatPercent(n, loc, 1);
  else return `${formatMoney(n, country.currency, loc, 0)}${unitSuffix ?? ''}`;
  if (dataUnit && f.unit) return `${v} ${f.unit}`;
  return `${v}${unitSuffix ?? ''}`;
}

function lineFor(f: PlaceFact, country: PlaceCountry, text: PlaceDict): ViewLine | null {
  const fmt = FORMATS[f.key];
  const label = text.labels[f.key];
  if (!fmt || !label) return null;
  const notes: string[] = [];
  if (f.scope === 'region' && f.scope_label) notes.push(text.scopeRegion(f.scope_label));
  if (f.scope === 'network' && f.scope_label) notes.push(text.scopeNetwork(f.scope_label));
  const area = censusAreaFromNote(f.note);
  if (area) notes.push(text.geography(area));
  const period = formatPeriod(f.period, country.locale, text.periodTo);
  if (period) notes.push(period);
  if (fmt.showNote && f.note) notes.push(f.note);
  if (f.confidence === 'secondary') notes.push(text.secondary);
  return {
    label,
    value: formatValue(f, fmt.kind, country, fmt.dataUnit === true, text.units[f.key]),
    source: f.source_url ? { label: f.publisher ?? f.source_url, url: f.source_url } : null,
    checkedOn: f.verified_on ? formatDate(f.verified_on, country.locale) : null,
    checkedIso: f.verified_on,
    note: notes.length ? notes.join(' · ') : null,
  };
}

function methodLine(note: string | null, country: PlaceCountry, text: PlaceDict): string | null {
  const n = parseYieldNote(note);
  return n ? text.chart.methodLine(n.db, n.tilt, n.loss, text.facing[country.facing]) : null;
}

export function buildPlaceView(place: PlaceWithFacts, region: PlaceRegion): PlaceView | null {
  const country = placeCountryByCode(place.country);
  if (!country) return null;
  const gate = evaluatePlace(country.code, place);
  if (!gate.renders) return null;
  const text = PLACE_TEXT[country.code];
  const facts = place.place_facts;
  const monthly = monthlyYield(facts);
  const months = monthLabels(country.locale);

  const sections: ViewSection[] = [];
  const shown: PlaceFact[] = [];
  for (const def of SECTION_KEYS[country.code]) {
    if (!gate.sections.includes(def.id)) continue;
    const lines: ViewLine[] = [];
    // Support facts (region / network labels) print before the numbers of the section they explain.
    const support = def.id === 'tariff' ? [country.code === 'GB' ? 'price_cap_region' : 'network_for_place'] : [];
    for (const key of [...support, ...def.keys]) {
      if (key === 'solar_yield_monthly_kwh_per_kwp') continue;
      const f = pickFact(facts, key);
      const line = f ? lineFor(f, country, text) : null;
      if (f && line) { lines.push(line); shown.push(f); }
    }
    const yieldFact = def.id === 'yield' ? pickFact(facts, 'solar_yield_kwh_per_kwp') : null;
    const annual = yieldFact?.value_num != null ? formatNumber(yieldFact.value_num, country.locale, 0) : null;
    sections.push({
      id: def.id,
      heading: text.sections[def.id].heading(place.name),
      intro: text.sections[def.id].intro ?? null,
      lines,
      chart: def.id === 'yield' && monthly ? { monthly, annual, months, method: methodLine(yieldFact?.note ?? null, country, text) } : null,
    });
  }

  // Key numbers: the first line of each section, in section order, at most 5, never a label-only line.
  const items: KeyNumber[] = [];
  for (const s of sections) {
    const pick = s.lines.find((x) => x.source && x.checkedOn && /\d/.test(x.value));
    if (pick && items.length < 5) items.push({ label: pick.label, value: pick.value, source: pick.source, checkedOn: pick.checkedOn, ...(pick.note ? { note: pick.note } : {}) });
  }
  const yieldFact = pickFact(facts, 'solar_yield_kwh_per_kwp');
  const answer = yieldFact?.value_num != null ? text.answerYield(place.name, formatNumber(yieldFact.value_num, country.locale, 0), text.facing[country.facing]) : null;
  const checkedIso = maxDate(...shown.map((f) => f.verified_on), ...(monthly ? facts.filter((f) => f.key === 'solar_yield_monthly_kwh_per_kwp').map((f) => f.verified_on) : []));
  const keyNumbers: KeyNumbersBlock = items.length >= 3
    ? { answer, items, checkedOn: checkedIso ? formatDate(checkedIso, country.locale) : null }
    : { answer: null, items: [], checkedOn: null };

  return {
    country,
    lang: country.htmlLang,
    path: placePath(country, region.slug, place.slug),
    hubPath: regionHubPath(country, region.slug),
    regionName: region.name,
    name: place.name,
    title: text.title(place.name),
    description: text.description(place.name, region.name),
    h1: text.h1(place.name),
    intro: text.intro(place.name, region.name),
    keyNumbersHeading: text.keyNumbersHeading(place.name),
    keyNumbers,
    sections,
    checkedIso,
    text,
  };
}
