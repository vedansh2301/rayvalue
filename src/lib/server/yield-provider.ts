/**
 * Solar-yield provider abstraction (pure; shared by the proxies and the precompute scripts).
 *
 * One provider per COUNTRY, chosen by markets.yield_provider and never by coordinates, so a country is never
 * served by two different models: 'pvwatts' (NLR PVWatts v8: US, CA) or 'pvgis' (EU JRC PVGIS 5.3: everywhere
 * else). Routes: /api/pvwatts (existing, unchanged) and /api/pvgis.
 *
 * AZIMUTH CONVENTION. RayValue stores the array azimuth as "180 = facing the equator", in BOTH hemispheres, so one
 * number in model_assumptions means the same thing everywhere. Providers want compass directions:
 *   northern hemisphere: compass = rayvalue            (180 = south)
 *   southern hemisphere: compass = rayvalue + 180 mod 360  (180 = equator-facing = compass 0 = NORTH)
 *   PVWatts azimuth   = compass azimuth  (0 = N, 90 = E, 180 = S, 270 = W)
 *   PVGIS aspect      = compass - 180, in (-180, 180]  (0 = S, 90 = W, -90 = E, 180 = N)
 * So an equator-facing array is PVWatts azimuth 180 / PVGIS aspect 0 in the north, and PVWatts azimuth 0 /
 * PVGIS aspect 180 in the south.
 */
export type YieldProviderId = 'pvwatts_v8' | 'pvgis_5_3';
export type Hemisphere = 'N' | 'S';

export interface YieldMarket {
  code: string;
  yield_provider: 'pvwatts' | 'pvgis';
}

export interface YieldQuery {
  country: string;
  lat: number;
  lon: number;
  lossesPct: number;
  /** Degrees from horizontal, or 'optimal' (provider-computed; PVGIS only). */
  tiltDeg: number | 'optimal';
  /** RayValue convention: 180 = equator-facing in either hemisphere. */
  azimuthDeg: number;
}

export interface YieldResult {
  providerId: YieldProviderId;
  /** kWh AC per year per kW DC. */
  annualKwhPerKw: number;
  /** January..December. */
  monthlyKwhPerKw: number[];
  /** Radiation dataset the provider used, e.g. 'PVGIS-ERA5'. */
  dataset: string;
  /** Tilt actually used (the optimum when requested); null when the provider does not report it. */
  tiltDeg: number | null;
  /** Compass azimuth actually used (0 = N). */
  compassAzimuthDeg: number;
}

/** lat < 0 = southern hemisphere; the equator itself counts as northern. */
export const hemisphereOfLat = (lat: number): Hemisphere => (lat < 0 ? 'S' : 'N');

const mod360 = (d: number) => ((d % 360) + 360) % 360;

/** RayValue azimuth (180 = equator-facing) -> compass azimuth (0 = north). */
export function toCompassAzimuth(rayvalueAzimuth: number, hemisphere: Hemisphere): number {
  return hemisphere === 'N' ? mod360(rayvalueAzimuth) : mod360(rayvalueAzimuth + 180);
}

/** Compass azimuth -> PVWatts azimuth (identical). */
export const toPvwattsAzimuth = (compass: number): number => mod360(compass);

/** Compass azimuth -> PVGIS aspect: 0 = south, 90 = west, -90 = east, 180 = north (range -180 < aspect <= 180). */
export function toPvgisAspect(compass: number): number {
  const a = mod360(compass - 180);
  return a > 180 ? a - 360 : a;
}

/** Which provider serves a country, from the markets table. Unknown country -> null (the caller must not guess). */
export function providerForCountry(country: string, markets: readonly YieldMarket[]): YieldProviderId | null {
  const m = markets.find((x) => x.code === country);
  if (!m) return null;
  return m.yield_provider === 'pvwatts' ? 'pvwatts_v8' : 'pvgis_5_3';
}

/** The proxy route for a provider. */
export const routeForProvider = (id: YieldProviderId): '/api/pvwatts' | '/api/pvgis' => (id === 'pvwatts_v8' ? '/api/pvwatts' : '/api/pvgis');

/** True when no country appears under two providers (guards a markets table edit). */
export function providersAreExclusive(markets: readonly YieldMarket[]): boolean {
  const seen = new Map<string, string>();
  for (const m of markets) {
    const prev = seen.get(m.code);
    if (prev !== undefined && prev !== m.yield_provider) return false;
    seen.set(m.code, m.yield_provider);
  }
  return true;
}
