/**
 * Sitemap / llms index entries for place pages. Only places that pass the gate (published AND >= 3 sourced sections) and
 * region hubs with enough such places are listed, so the sitemap can never contain a URL the page would answer 404 for.
 * lastmod is the newest verified_on / updated_at of the rows the page shows, never a build time. Pure except the loader.
 */
import { err, ok, type Result } from '../db/client.ts';
import { maxDate, toDate } from '../seo/lastmod.ts';
import type { IndexEntry } from '../seo/site-index.ts';
import { isRegionPage, placeCountryByCode, placePath, regionHubPath } from './config.ts';
import { evaluatePlace, hubRenders } from './gate.ts';
import { PLACE_TEXT } from './i18n.ts';
import { loadPlaceRegions, loadPublishedPlaces, type PlacesRepoDeps } from './repo.ts';
import type { PlaceRegion, PlaceWithFacts } from './schema.ts';

const placeStamp = (p: PlaceWithFacts): string | null => maxDate(toDate(p.updated_at), ...p.place_facts.map((f) => f.verified_on));

export function placeIndexEntries(regions: readonly PlaceRegion[], places: readonly PlaceWithFacts[]): IndexEntry[] {
  const out: IndexEntry[] = [];
  const byRegion = new Map<string, { region: PlaceRegion; places: PlaceWithFacts[] }>();
  for (const p of places) {
    const country = placeCountryByCode(p.country);
    const region = regions.find((r) => r.country === p.country && r.code === p.region_code);
    if (!country || !region || !evaluatePlace(country.code, p).renders) continue;
    const text = PLACE_TEXT[country.code];
    out.push({
      path: placePath(country, region.slug, p.slug),
      country: country.segment,
      type: 'places',
      section: 'places',
      lastmod: placeStamp(p),
      title: text.title(p.name),
      summary: text.description(p.name, region.name),
      name: p.name,
      region: region.name,
      placeKind: 'place',
    });
    const k = `${p.country}/${region.code}`;
    const g = byRegion.get(k) ?? { region, places: [] };
    g.places.push(p);
    byRegion.set(k, g);
  }
  for (const g of byRegion.values()) {
    const country = placeCountryByCode(g.region.country);
    // A county page (IE) already occupies the hub URL, so no separate hub entry is listed for that region.
    if (!country || !hubRenders(g.places.length) || g.places.some((p) => isRegionPage(country, g.region.slug, p.slug))) continue;
    const text = PLACE_TEXT[country.code];
    out.push({
      path: regionHubPath(country, g.region.slug),
      country: country.segment,
      type: 'places',
      section: 'places',
      lastmod: maxDate(...g.places.map(placeStamp)),
      title: text.hubTitle(g.region.name),
      summary: text.hubDescription(g.region.name),
      name: g.region.name,
      region: g.region.name,
      placeKind: 'hub',
    });
  }
  return out;
}

/**
 * Loads published places and builds their entries. Before migration 0033 is applied PostgREST answers 404 for the
 * missing tables: that is "no places yet" (empty list), not an outage. Any other failure is returned as an error so the
 * sitemap answers 503 instead of silently dropping URLs.
 */
export async function loadPlaceIndexEntries(deps: PlacesRepoDeps = {}): Promise<Result<IndexEntry[]>> {
  const [regions, places] = await Promise.all([loadPlaceRegions(undefined, deps), loadPublishedPlaces({}, deps)]);
  const missing = (r: Result<unknown>) => !r.ok && r.error.kind === 'http' && /HTTP 404\b/.test(r.error.message);
  if (missing(places) || missing(regions)) return ok([]);
  if (!regions.ok) return err(regions.error.kind, regions.error.message);
  if (!places.ok) return err(places.error.kind, places.error.message);
  return ok(placeIndexEntries(regions.value, places.value));
}
