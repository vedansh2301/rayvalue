/** Pure mapping of rvplan country packs (sources.csv / facts.csv) to sources and facts_staging rows. No I/O. */
import { parseCsvObjects } from './csv';
import { accessFromUrl, cadenceDays, canonicalUrl, normaliseAccess, normaliseRobots, normaliseType, type Access, type RobotsOk, type SourceType } from './normalise';

export interface SourceIn {
  country: string;
  url: string;
  source_name: string;
  type: SourceType;
  covers: string | null;
  language: string | null;
  notes: string | null;
  origin: 'pack' | 'fact';
  update_cadence: string | null;
  cadence_days: number;
  access: Access;
  robots_ok: RobotsOk;
}

export interface FactIn {
  natural_key: string;
  country: string;
  key: string;
  region: string;
  value: string | null;
  unit: string | null;
  valid_from: string;
  valid_to: string | null;
  source_url: string;
  publisher: string | null;
  retrieved_on: string | null;
  excerpt: string | null;
  confidence: 'primary' | 'secondary';
}

const blank = (s: string | undefined): string | null => (s && s.trim() !== '' ? s.trim() : null);
const isIsoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const isHttp = (u: string): boolean => /^https?:\/\/[^\s]+$/.test(u);

/** sources.csv to rows. Rows with a missing/invalid URL are skipped; duplicate URLs keep the first row. */
export function sourcesFromCsv(country: string, csv: string): { rows: SourceIn[]; skipped: number } {
  const seen = new Set<string>();
  const rows: SourceIn[] = [];
  let skipped = 0;
  for (const r of parseCsvObjects(csv)) {
    const url = (r.url ?? '').trim();
    const canon = canonicalUrl(url);
    if (!isHttp(url) || seen.has(canon)) {
      skipped++;
      continue;
    }
    seen.add(canon);
    const type = normaliseType(r.type ?? '');
    const access = normaliseAccess(r.access ?? '', url);
    rows.push({
      country,
      url,
      source_name: (r.source_name ?? '').trim() || url,
      type,
      covers: blank(r.covers),
      language: blank(r.language),
      notes: blank(r.notes),
      origin: 'pack',
      update_cadence: blank(r.update_cadence),
      cadence_days: cadenceDays(r.update_cadence ?? '', type, access),
      access,
      robots_ok: normaliseRobots(r.robots_ok ?? ''),
    });
  }
  return { rows, skipped };
}

export const factNaturalKey = (f: Pick<FactIn, 'country' | 'key' | 'region' | 'valid_from' | 'unit' | 'source_url'>): string =>
  [f.country, f.key, f.region, f.valid_from, f.unit ?? '', f.source_url].join('|');

/** facts.csv to rows. Rows missing key or a valid source_url are skipped (reported in `skipped`); duplicates: last wins. */
export function factsFromCsv(country: string, csv: string): { rows: FactIn[]; skipped: string[] } {
  const byKey = new Map<string, FactIn>();
  const skipped: string[] = [];
  for (const r of parseCsvObjects(csv)) {
    const key = (r.key ?? '').trim();
    const source_url = (r.source_url ?? '').trim();
    if (!key || !isHttp(source_url)) {
      skipped.push(`${country}:${key || '(no key)'}`);
      continue;
    }
    const retrieved = (r.retrieved_on ?? '').trim();
    const f: FactIn = {
      natural_key: '',
      country,
      key,
      region: (r.region ?? '').trim(),
      value: blank(r.value),
      unit: blank(r.unit),
      valid_from: (r.valid_from ?? '').trim(),
      valid_to: blank(r.valid_to),
      source_url,
      publisher: blank(r.publisher),
      retrieved_on: isIsoDate(retrieved) ? retrieved : null,
      excerpt: blank(r.excerpt),
      confidence: (r.confidence ?? '').trim().toLowerCase() === 'primary' ? 'primary' : 'secondary',
    };
    f.natural_key = factNaturalKey(f);
    byKey.set(f.natural_key, f);
  }
  return { rows: [...byKey.values()], skipped };
}

/** Pages cited by facts but absent from the registry become `origin: 'fact'` sources so those facts can be re-checked. */
export function derivedSources(facts: FactIn[], known: Set<string>): SourceIn[] {
  const out: SourceIn[] = [];
  const seen = new Set(known);
  for (const f of facts) {
    const id = `${f.country}|${canonicalUrl(f.source_url)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const access = accessFromUrl(f.source_url);
    out.push({
      country: f.country,
      url: f.source_url,
      source_name: f.publisher ?? f.source_url,
      type: 'other',
      covers: null,
      language: null,
      notes: 'Cited by facts.csv; not listed in sources.csv',
      origin: 'fact',
      update_cadence: null,
      cadence_days: 30,
      access,
      robots_ok: 'unknown',
    });
  }
  return out;
}

export const sourceId = (country: string, url: string): string => `${country}|${canonicalUrl(url)}`;

export interface ExistingFact {
  natural_key: string;
  value: string | null;
  valid_to: string | null;
  publisher: string | null;
  retrieved_on: string | null;
  excerpt: string | null;
  confidence: string;
}
export type FactUpsert = FactIn & { source_id: string | null; status?: 'new' | 'changed'; previous_value?: string | null };

/**
 * Decide what to write so a re-import is idempotent. New facts: status 'new'. Existing with a different value:
 * status 'changed' + previous_value. Existing with only metadata differences: updated without touching status.
 * Identical: skipped.
 */
export function planFactUpserts(incoming: FactIn[], existing: Map<string, ExistingFact>, sourceIds: Map<string, string>): { upserts: FactUpsert[]; created: number; changedValue: number; metadataOnly: number; unchanged: number } {
  const upserts: FactUpsert[] = [];
  let created = 0;
  let changedValue = 0;
  let metadataOnly = 0;
  let unchanged = 0;
  for (const f of incoming) {
    const source_id = sourceIds.get(sourceId(f.country, f.source_url)) ?? null;
    const ex = existing.get(f.natural_key);
    if (!ex) {
      upserts.push({ ...f, source_id, status: 'new' });
      created++;
    } else if (ex.value !== f.value) {
      upserts.push({ ...f, source_id, status: 'changed', previous_value: ex.value });
      changedValue++;
    } else if (ex.valid_to !== f.valid_to || ex.publisher !== f.publisher || ex.retrieved_on !== f.retrieved_on || ex.excerpt !== f.excerpt || ex.confidence !== f.confidence) {
      upserts.push({ ...f, source_id });
      metadataOnly++;
    } else unchanged++;
  }
  return { upserts, created, changedValue, metadataOnly, unchanged };
}
