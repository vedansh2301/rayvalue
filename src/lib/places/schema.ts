/**
 * Row shapes for places and place_facts (migration 0033) and their Zod validation. Pure: no I/O.
 * Postgres numeric can arrive as a string, so numbers are coerced; null stays null.
 */
import { z } from 'zod';

const num = z.preprocess((v) => (v === null || v === undefined ? null : Number(v)), z.number().nullable());
const Iso = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

export const PlaceFactSchema = z.object({
  key: z.string().min(1),
  value_num: num,
  value_text: z.string().nullable(),
  unit: z.string(),
  period: z.string(),
  scope: z.enum(['place', 'region', 'network']),
  scope_label: z.string().nullable(),
  source_url: z.string().nullable(),
  publisher: z.string().nullable(),
  verified_on: Iso.nullable().transform((d) => (d ? d.slice(0, 10) : null)),
  confidence: z.enum(['primary', 'secondary']),
  status: z.enum(['agent_sourced', 'human_verified', 'unverified']),
  note: z.string().nullable(),
});
export type PlaceFact = z.infer<typeof PlaceFactSchema>;

export const PlaceSchema = z.object({
  id: z.string().min(1),
  country: z.string().regex(/^[A-Z]{2}$/),
  region_code: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  lat: num,
  lon: num,
  published: z.boolean(),
  updated_at: z.string().nullable().optional().transform((d) => d ?? null),
  place_facts: z.array(PlaceFactSchema).default([]),
});
export type PlaceWithFacts = z.infer<typeof PlaceSchema>;
export const PlacesSchema = z.array(PlaceSchema);

export const PlaceRegionSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  code: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
});
export type PlaceRegion = z.infer<typeof PlaceRegionSchema>;
export const PlaceRegionsSchema = z.array(PlaceRegionSchema);
