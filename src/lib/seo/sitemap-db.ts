/**
 * DB-backed index entries (state calculators, utility pages, published city pages) with real lastmod values.
 * Read through PostgREST with the publishable key (RLS limits it to SELECT on reference tables). Any failure is an
 * error result: endpoints answer 503, never an empty sitemap (search engines read an empty sitemap as "these URLs
 * are gone"). Unpublished cities are never listed, even if the database returned them.
 */
import { err, ok, selectRows, siteDbEnv, type DbEnv, type Result } from '../db/client.ts';
import { cityPath, utilityPath } from '../paths.ts';
import { UTILITY_PAGES, RESERVED_CITY_SLUGS, utilityPagePath, type UtilityPageMeta } from '../utility/pages.ts';
import { CALCULATOR_PAGES, type IndexEntry } from './site-index.ts';
import { pageLastmod, toDate, type Stamped, type UtilityStamps } from './lastmod.ts';

interface CityRow extends Stamped { state: string; slug: string; name: string; default_utility_id: string; published: boolean }
interface HousingRow extends Stamped { state: string; slug: string }
interface ProductionRow extends Stamped { state: string; slug: string }
interface UtilityRow extends UtilityStamps { id: string; state: string; name: string; source_url: string | null; avg_rate_source_url: string | null; export_credit_source_url: string | null }
interface StateStamp extends Stamped { state: string | null }

export interface DbIndexDeps {
  env?: DbEnv | null;
  fetch?: typeof fetch;
  /** The utility pages that are indexable now (same predicate as the page's noindex). Throws or rejects on DB failure. */
  indexableUtilities?: () => Promise<readonly UtilityPageMeta[]>;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isState = (s: unknown): s is 'FL' | 'CA' => s === 'FL' || s === 'CA';

/** Default: the utility page's own loader (page is indexable only when its worked examples have results). */
async function defaultIndexableUtilities(): Promise<UtilityPageMeta[]> {
  const { loadUtilityPageData } = await import('../utility/load.ts');
  const out: UtilityPageMeta[] = [];
  for (const p of UTILITY_PAGES) {
    const d = await loadUtilityPageData(p.slug);
    if (d.kind === 'unavailable') throw new Error(`utility ${p.slug} unavailable`);
    if (d.vm.indexable) out.push(p);
  }
  return out;
}

export async function loadDbIndexEntries(deps: DbIndexDeps = {}): Promise<Result<IndexEntry[]>> {
  const env = deps.env === undefined ? siteDbEnv() : deps.env;
  const rows = <T>(table: string, select: string, extra: Record<string, string> = {}) => selectRows<T>(env, table, { select, ...extra }, deps.fetch ?? fetch);
  const [cities, housing, production, utilities, costs, assumptions] = await Promise.all([
    rows<CityRow>('cities', 'state,slug,name,default_utility_id,published,updated_at', { published: 'is.true', order: 'state.asc,slug.asc' }),
    rows<HousingRow>('city_housing', 'state,slug,updated_at,verified_on'),
    rows<ProductionRow>('pvwatts_city_production', 'state,slug,updated_at,fetched_on'),
    rows<UtilityRow>('utilities', 'id,state,name,source_url,avg_rate_source_url,export_credit_source_url,updated_at,verified_on,avg_rate_verified_on,export_credit_verified_on,utility_tier_sets(updated_at,utility_tiers(updated_at)),utility_tou_rates(updated_at)'),
    rows<StateStamp>('cost_ranges', 'state,updated_at,verified_on'),
    rows<StateStamp>('model_assumptions', 'state,updated_at'),
  ]);
  if (!cities.ok) return cities;
  if (!housing.ok) return housing;
  if (!production.ok) return production;
  if (!utilities.ok) return utilities;
  if (!costs.ok) return costs;
  if (!assumptions.ok) return assumptions;

  let indexable: readonly UtilityPageMeta[];
  try {
    indexable = await (deps.indexableUtilities ?? defaultIndexableUtilities)();
  } catch (e) {
    return err('network', `utility pages unavailable (${e instanceof Error ? e.message : 'error'})`);
  }

  const costsFor = (st: string) => costs.value.filter((c) => c.state === st);
  const assumpFor = (st: string) => assumptions.value.filter((a) => a.state === null || a.state === st);
  const utilByState = (st: string) => utilities.value.filter((u) => u.state === st);
  const out: IndexEntry[] = [];

  const published = cities.value.filter((c) => c.published === true && isState(c.state) && typeof c.slug === 'string' && SLUG_RE.test(c.slug) && !RESERVED_CITY_SLUGS.has(c.slug));

  for (const calc of CALCULATOR_PAGES) {
    out.push({
      path: calc.path, country: 'us', type: 'calculators', section: 'calculators', state: calc.state, name: calc.meta.title,
      lastmod: pageLastmod({ utilities: utilByState(calc.state), costs: costsFor(calc.state), assumptions: assumpFor(calc.state), cities: published.filter((c) => c.state === calc.state) }),
      title: calc.meta.title, summary: calc.meta.description,
    });
  }

  for (const p of indexable) {
    const u = utilities.value.find((x) => x.id === p.utilityId);
    const sources = u
      ? [
          { url: u.source_url, checkedOn: toDate(u.verified_on) },
          { url: u.avg_rate_source_url, checkedOn: toDate(u.avg_rate_verified_on) },
          { url: u.export_credit_source_url, checkedOn: toDate(u.export_credit_verified_on) },
        ].filter((s): s is { url: string; checkedOn: string | null } => typeof s.url === 'string' && /^https?:\/\//.test(s.url))
      : [];
    out.push({
      path: utilityPagePath(p), country: 'us', type: 'utilities', section: 'utilities', state: p.state, name: u?.name ?? p.short,
      lastmod: pageLastmod({ utilities: [u ?? null], costs: costsFor(p.state), assumptions: assumpFor(p.state) }),
      title: p.title, summary: p.description, sources,
    });
  }

  for (const c of published) {
    const state = c.state as 'FL' | 'CA';
    const u = utilities.value.find((x) => x.id === c.default_utility_id) ?? null;
    const page = UTILITY_PAGES.find((x) => x.utilityId === c.default_utility_id && x.state === state);
    const lastmod = pageLastmod({
      city: c,
      housing: housing.value.find((h) => h.state === c.state && h.slug === c.slug),
      production: production.value.filter((r) => r.state === c.state && r.slug === c.slug),
      utilities: [u],
      costs: costsFor(state),
      assumptions: assumpFor(state),
    });
    const util = u ? { name: u.name, path: page && indexable.includes(page) ? utilityPath(state, page.slug) : null } : undefined;
    out.push({
      path: cityPath(state, c.slug), country: 'us', type: 'cities', section: 'cities', state, name: c.name, lastmod,
      title: `Solar payback in ${c.name}, ${state}`,
      summary: `${util ? `${util.name} rates, ` : 'Rates, '}sun and example solar payback ranges for ${c.name}, ${state}${lastmod ? `; data checked ${lastmod}` : ''}`,
      ...(util ? { utility: util } : {}),
    });
  }
  return ok(out);
}
