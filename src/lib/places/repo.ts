/**
 * Reads places, their facts and the regions through PostgREST with the publishable key (RLS lets anon SELECT only
 * published places and the facts of published places). Validates every load, returns a Result, never throws. SERVER-ONLY.
 * Unpublished places are also filtered here, so a policy mistake could not publish one by accident.
 */
import { z } from 'zod';
import { err, ok, selectRows, siteDbEnv, type DbEnv, type Result } from '../db/client.ts';
import { PlaceRegionsSchema, PlacesSchema, type PlaceRegion, type PlaceWithFacts } from './schema.ts';

export interface PlacesRepoDeps {
  env?: DbEnv | null;
  fetch?: typeof fetch;
}

const FACT_COLS = 'key,value_num,value_text,unit,period,scope,scope_label,source_url,publisher,verified_on,confidence,status,note';
export const PLACE_SELECT = `id,country,region_code,slug,name,lat,lon,published,updated_at,place_facts(${FACT_COLS})`;
const PAGE = 200;

function validate<S extends z.ZodType>(schema: S, value: unknown, what: string): Result<z.infer<S>> {
  const r = schema.safeParse(value);
  if (r.success) return ok(r.data);
  return err('invalid', `${what} failed validation`, r.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
}

export function createPlacesRepo(deps: PlacesRepoDeps = {}) {
  const env = deps.env === undefined ? siteDbEnv() : deps.env;
  const f = deps.fetch ?? fetch;
  const rows = <T>(table: string, params: Record<string, string>) => selectRows<T>(env, table, params, f);

  async function loadRegions(country?: string): Promise<Result<PlaceRegion[]>> {
    const r = await rows<Record<string, unknown>>('regions', { select: 'country,code,name,slug', order: 'country.asc,code.asc', ...(country ? { country: `eq.${country}` } : {}) });
    return r.ok ? validate(PlaceRegionsSchema, r.value, 'regions') : r;
  }

  /** Published places (with all their facts) matching the filters, in pages of PAGE places. */
  async function loadPlaces(filter: { country?: string; regionCode?: string; slug?: string } = {}): Promise<Result<PlaceWithFacts[]>> {
    const out: PlaceWithFacts[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const params: Record<string, string> = { select: PLACE_SELECT, published: 'is.true', order: 'country.asc,region_code.asc,slug.asc', limit: String(PAGE), offset: String(offset) };
      if (filter.country) params.country = `eq.${filter.country}`;
      if (filter.regionCode) params.region_code = `eq.${filter.regionCode}`;
      if (filter.slug) params.slug = `eq.${filter.slug}`;
      const r = await rows<Record<string, unknown>>('places', params);
      if (!r.ok) return r;
      const v = validate(PlacesSchema, r.value, 'places');
      if (!v.ok) return v;
      out.push(...v.value.filter((p) => p.published === true));
      if (r.value.length < PAGE) break;
    }
    return ok(out);
  }

  return { loadRegions, loadPlaces };
}

export const loadPlaceRegions = (country?: string, deps?: PlacesRepoDeps) => createPlacesRepo(deps).loadRegions(country);
export const loadPublishedPlaces = (filter?: { country?: string; regionCode?: string; slug?: string }, deps?: PlacesRepoDeps) => createPlacesRepo(deps).loadPlaces(filter);
