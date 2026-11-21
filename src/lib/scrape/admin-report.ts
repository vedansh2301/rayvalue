/** Pure summary of the scraper tables for /admin/sources. */
export interface SourceStat {
  country: string;
  last_status: number | null;
  last_fetched_at: string | null;
  consecutive_failures: number;
}
export interface FactStat {
  country: string;
  status: 'new' | 'changed' | 'confirmed' | 'rejected';
}
export interface CountryRow {
  country: string;
  sources: number;
  fetched: number;
  failing: number;
  blocked: number;
  facts: number;
  confirmed: number;
  changed: number;
}

export function summariseByCountry(sources: SourceStat[], facts: FactStat[]): CountryRow[] {
  const m = new Map<string, CountryRow>();
  const row = (c: string): CountryRow => {
    let r = m.get(c);
    if (!r) m.set(c, (r = { country: c, sources: 0, fetched: 0, failing: 0, blocked: 0, facts: 0, confirmed: 0, changed: 0 }));
    return r;
  };
  for (const s of sources) {
    const r = row(s.country);
    r.sources++;
    if (s.last_fetched_at) r.fetched++;
    if (s.last_status === -1) r.blocked++;
    else if (s.consecutive_failures > 0) r.failing++;
  }
  for (const f of facts) {
    const r = row(f.country);
    r.facts++;
    if (f.status === 'confirmed') r.confirmed++;
    if (f.status === 'changed') r.changed++;
  }
  return [...m.values()].sort((a, b) => a.country.localeCompare(b.country));
}

export const total = (rows: CountryRow[]): CountryRow =>
  rows.reduce((t, r) => ({ ...t, sources: t.sources + r.sources, fetched: t.fetched + r.fetched, failing: t.failing + r.failing, blocked: t.blocked + r.blocked, facts: t.facts + r.facts, confirmed: t.confirmed + r.confirmed, changed: t.changed + r.changed }), { country: 'All', sources: 0, fetched: 0, failing: 0, blocked: 0, facts: 0, confirmed: 0, changed: 0 });
