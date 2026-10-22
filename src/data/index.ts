import caZipsJson from './zips/ca.json';
import flZipsJson from './zips/fl.json';
import zipMetaJson from './zips/_meta.json';
import { ZipMapSchema, ZipMetaSchema } from './schemas';

export * from './schemas';

/**
 * Calculator VALUES (rates, costs, assumptions, cities, offers, precomputed production)
 * live in Supabase and are loaded at request time by src/lib/db/repo.ts. The only data
 * kept in the repo is the generated Census ZCTA ZIP -> lat/lon reference table.
 */
export const zips = {
  FL: ZipMapSchema.parse(flZipsJson),
  CA: ZipMapSchema.parse(caZipsJson),
} as const;
export const zipMeta = ZipMetaSchema.parse(zipMetaJson);
