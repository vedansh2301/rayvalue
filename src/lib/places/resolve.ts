/**
 * Route resolution for /<cc>/<topic>/<region>[/<place>]: pure, so the 404 rules are unit tested. A place page exists only
 * when the place is published AND passes the 3-section gate; a region hub only when it lists >= MIN_HUB_PLACES of them.
 * Anything else is not_found (the route answers 404; unpublished places never leak).
 */
import { placeCountryForRoute, placePath, regionHubPath, type PlaceCountry } from './config.ts';
import { PLACE_TEXT, type PlaceDict } from './i18n.ts';
import { evaluatePlace, hubRenders } from './gate.ts';
import type { PlaceRegion, PlaceWithFacts } from './schema.ts';
import { buildPlaceView, type PlaceView } from './view.ts';

export interface HubView {
  country: PlaceCountry;
  lang: string;
  path: string;
  regionName: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  places: { name: string; href: string }[];
  text: PlaceDict;
}

export type PlaceRoute = { kind: 'place'; view: PlaceView } | { kind: 'hub'; hub: HubView } | { kind: 'not_found'; country: PlaceCountry | null };

export interface RouteParams { cc: string; topic: string; region: string; city?: string | undefined }

export function resolvePlaceRoute(params: RouteParams, data: { regions: readonly PlaceRegion[]; places: readonly PlaceWithFacts[] }): PlaceRoute {
  const country = placeCountryForRoute(params.cc, params.topic);
  if (!country) return { kind: 'not_found', country: null };
  const region = data.regions.find((r) => r.country === country.code && r.slug === params.region);
  if (!region) return { kind: 'not_found', country };

  if (params.city !== undefined) {
    const place = data.places.find((p) => p.country === country.code && p.region_code === region.code && p.slug === params.city);
    const view = place ? buildPlaceView(place, region) : null;
    return view ? { kind: 'place', view } : { kind: 'not_found', country };
  }

  const text = PLACE_TEXT[country.code];
  const listed = data.places
    .filter((p) => p.country === country.code && p.region_code === region.code && evaluatePlace(country.code, p).renders)
    .sort((a, b) => a.name.localeCompare(b.name, country.locale));
  if (!hubRenders(listed.length)) return { kind: 'not_found', country };
  return {
    kind: 'hub',
    hub: {
      country,
      lang: country.htmlLang,
      path: regionHubPath(country, region.slug),
      regionName: region.name,
      title: text.hubTitle(region.name),
      description: text.hubDescription(region.name),
      h1: text.hubH1(region.name),
      intro: text.hubIntro(region.name),
      places: listed.map((p) => ({ name: p.name, href: placePath(country, region.slug, p.slug) })),
      text,
    },
  };
}
