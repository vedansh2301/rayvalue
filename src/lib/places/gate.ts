/**
 * The publish gate for place pages (CLAUDE.md rule 9). A place page renders only when the place is published AND it has
 * at least MIN_SECTIONS distinct sections backed by sourced facts. Pure; the page, the sitemap and llms.txt all call
 * these functions, so a URL can never be in one and not the others.
 *
 * A fact is "sourced" when it has a value, an http(s) source_url, a verified_on date, primary confidence and a status
 * other than 'unverified'. Secondary-confidence facts may be shown (flagged) but never count toward the gate.
 */
import type { PlaceCountryCode } from './config.ts';
import type { PlaceFact, PlaceWithFacts } from './schema.ts';

export type SectionId = 'yield' | 'housing' | 'installs' | 'tariff' | 'cost' | 'zone' | 'heating';

export const MIN_SECTIONS = 3;
/** A region hub lists published places, so it needs enough of them to be more than a stub. */
export const MIN_HUB_PLACES = 3;

/**
 * Which fact keys make up each section, per country. A section counts when ANY of its keys has a sourced fact.
 * The order of keys is the display order inside the section.
 */
export const SECTION_KEYS: Readonly<Record<PlaceCountryCode, readonly { id: SectionId; keys: readonly string[] }[]>> = {
  GB: [
    { id: 'yield', keys: ['solar_yield_kwh_per_kwp', 'solar_yield_monthly_kwh_per_kwp'] },
    { id: 'tariff', keys: ['price_cap_unit_rate_dd', 'price_cap_standing_charge_dd'] },
    { id: 'installs', keys: ['pv_installations_cumulative', 'pv_installations_per_1000_households', 'pv_capacity_mw_cumulative'] },
    { id: 'housing', keys: ['homeownership_pct', 'houses_pct'] },
    { id: 'cost', keys: ['avg_install_cost_per_kw_0_4kw_mean', 'avg_install_cost_per_kw_4_10kw_mean'] },
  ],
  DE: [
    { id: 'yield', keys: ['solar_yield_kwh_per_kwp', 'solar_yield_monthly_kwh_per_kwp'] },
    { id: 'housing', keys: ['owner_occupier_rate_zensus2022', 'single_dwelling_building_share'] },
    { id: 'heating', keys: ['heatpump_solar_heated_building_share'] },
    { id: 'installs', keys: ['mastr_pv_units_in_operation'] },
  ],
  AU: [
    { id: 'yield', keys: ['solar_yield_kwh_per_kwp', 'solar_yield_monthly_kwh_per_kwp'] },
    { id: 'housing', keys: ['homeownership_pct', 'separate_house_pct', 'occupied_private_dwellings'] },
    { id: 'zone', keys: ['stc_zone'] },
    { id: 'installs', keys: ['cer_solar_pv_installations_postcode', 'cer_solar_pv_capacity_postcode', 'cer_battery_installations_postcode'] },
    { id: 'tariff', keys: ['dmo_annual_price_flat', 'dmo_annual_usage_assumed', 'dmo_flat_usage_rate', 'dmo_flat_supply_charge'] },
  ],
};

/** Label-only keys that are shown next to a section but never make a section count on their own. */
export const SUPPORT_KEYS: readonly string[] = ['price_cap_region', 'network_for_place', 'separate_houses_postal_area'];

/** Every fact key a place page can show (the import script uses this as its allow list). */
export const ALLOWED_KEYS: Readonly<Record<PlaceCountryCode, readonly string[]>> = {
  GB: [...SECTION_KEYS.GB.flatMap((s) => s.keys), ...SUPPORT_KEYS],
  DE: [...SECTION_KEYS.DE.flatMap((s) => s.keys), ...SUPPORT_KEYS],
  AU: [...SECTION_KEYS.AU.flatMap((s) => s.keys), ...SUPPORT_KEYS],
};

const HTTP = /^https?:\/\/\S+$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** True when the fact may count toward the gate. */
export function isSourcedFact(f: PlaceFact): boolean {
  const hasValue = (f.value_num !== null && Number.isFinite(f.value_num)) || (f.value_text !== null && f.value_text.trim() !== '');
  return hasValue && !!f.source_url && HTTP.test(f.source_url) && !!f.verified_on && ISO.test(f.verified_on) && f.confidence === 'primary' && f.status !== 'unverified';
}

/** The section ids that have at least one sourced fact, in the country's display order. */
export function sectionsPresent(country: PlaceCountryCode, facts: readonly PlaceFact[]): SectionId[] {
  const sourced = new Set(facts.filter(isSourcedFact).map((f) => f.key));
  return SECTION_KEYS[country].filter((s) => s.keys.some((k) => sourced.has(k))).map((s) => s.id);
}

export interface PlaceGate {
  published: boolean;
  sections: SectionId[];
  /** published AND at least MIN_SECTIONS distinct sourced sections. */
  renders: boolean;
}

export function evaluatePlace(country: PlaceCountryCode, place: Pick<PlaceWithFacts, 'published' | 'place_facts'>): PlaceGate {
  const sections = sectionsPresent(country, place.place_facts);
  return { published: place.published, sections, renders: place.published === true && sections.length >= MIN_SECTIONS };
}

/** Convenience for lists: only the places that pass the gate. */
export const renderablePlaces = <T extends Pick<PlaceWithFacts, 'country' | 'published' | 'place_facts'>>(places: readonly T[]): T[] =>
  places.filter((p) => (p.country === 'GB' || p.country === 'DE' || p.country === 'AU') && evaluatePlace(p.country, p).renders);

/** A region hub renders when it has at least MIN_HUB_PLACES renderable places. */
export const hubRenders = (renderableCount: number): boolean => renderableCount >= MIN_HUB_PLACES;
