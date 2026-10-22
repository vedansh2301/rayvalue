import assumptionsJson from './assumptions.json';
import citiesJson from './cities.json';
import costsJson from './costs.json';
import utilitiesJson from './utilities.json';
import caZipsJson from './zips/ca.json';
import flZipsJson from './zips/fl.json';
import zipMetaJson from './zips/_meta.json';
import {
  AssumptionsSchema,
  CitiesFileSchema,
  CostsSchema,
  UtilitiesSchema,
  ZipMapSchema,
  ZipMetaSchema,
  type City,
  type State,
  type Utility,
} from './schemas';

export * from './schemas';

/**
 * Everything here is parsed when this module loads. Invalid data throws, which fails
 * `astro build` (a page imports this module) and the Vitest suite.
 */
export const utilities: readonly Utility[] = UtilitiesSchema.parse(utilitiesJson);
export const costs = CostsSchema.parse(costsJson);
export const assumptions = AssumptionsSchema.parse(assumptionsJson);
const citiesFile = CitiesFileSchema.parse(citiesJson);
export const cities: readonly City[] = citiesFile.cities;
export const citiesCoordinatesSource = citiesFile.coordinates_source;
export const zips = {
  FL: ZipMapSchema.parse(flZipsJson),
  CA: ZipMapSchema.parse(caZipsJson),
} as const;
export const zipMeta = ZipMetaSchema.parse(zipMetaJson);

export function getUtilitiesByState(state: State): Utility[] {
  return utilities.filter((u) => u.state === state);
}

export function getUtility(id: string): Utility | undefined {
  return utilities.find((u) => u.id === id);
}

export function getCitiesByState(state: State): City[] {
  return cities.filter((c) => c.state === state);
}

export function getCity(state: State, slug: string): City | undefined {
  return cities.find((c) => c.state === state && c.slug === slug);
}
