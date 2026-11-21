import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvObjects } from './csv';
import { derivedSources, factsFromCsv, planFactUpserts, sourceId, sourcesFromCsv, type ExistingFact } from './import';

describe('parseCsv', () => {
  it('handles quotes, commas, doubled quotes, CRLF and embedded newlines', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"l1\nl2",z\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['l1\nl2', 'z']]);
  });
  it('strips BOM, skips blank lines, pads missing cells', () => {
    expect(parseCsvObjects('﻿a,b\n1\n\n2,3')).toEqual([{ a: '1', b: '' }, { a: '2', b: '3' }]);
  });
});

const SOURCES = `source_name,url,type,covers,update_cadence,access,robots_ok,language,notes
Bundesnetzagentur,https://www.bundesnetzagentur.de/eeg,regulator,"feed-in, degression",half-yearly,html|pdf,unknown,de,
Dup,https://www.bundesnetzagentur.de/eeg/,regulator,x,daily,html,yes,de,
Bad,not-a-url,regulator,,,html,yes,de,
Feed,https://example.org/rss.xml,rss,news,daily,rss,not checked (fetched),en,
`;
const FACTS = `key,region,value,unit,valid_from,valid_to,source_url,publisher,retrieved_on,excerpt,confidence
fit_partial,national,7.70,ct/kWh,2026-08-01,2026-12-31,https://www.bundesnetzagentur.de/eeg,BNetzA,2026-11-22,"Teileinspeisung: 7,70 ct/kWh",primary
fit_partial,national,7.70,ct/kWh,2026-08-01,2026-12-31,https://www.bundesnetzagentur.de/eeg,BNetzA,2026-11-22,"dup row later wins",primary
other,x,,,,,https://other.example/page,Other,2026-13-99,,weird
nokey,,1,,,,not-a-url,,,,primary
`;

describe('importer mapping', () => {
  it('maps sources, drops invalid URLs and canonical duplicates', () => {
    const { rows, skipped } = sourcesFromCsv('de', SOURCES);
    expect(skipped).toBe(2);
    expect(rows.map((r) => [r.url, r.access, r.robots_ok, r.cadence_days, r.type])).toEqual([
      ['https://www.bundesnetzagentur.de/eeg', 'html', 'unknown', 30, 'regulator'],
      ['https://example.org/rss.xml', 'rss', 'unknown', 1, 'rss'],
    ]);
  });
  it('maps facts: last duplicate wins, bad dates null, unknown confidence is secondary, invalid rows reported', () => {
    const { rows, skipped } = factsFromCsv('de', FACTS);
    expect(skipped).toEqual(['de:nokey']);
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.key === 'fit_partial')!;
    expect(a.excerpt).toBe('dup row later wins');
    expect(a.natural_key).toBe('de|fit_partial|national|2026-08-01|ct/kWh|https://www.bundesnetzagentur.de/eeg');
    const b = rows.find((r) => r.key === 'other')!;
    expect(b).toMatchObject({ value: null, unit: null, retrieved_on: null, confidence: 'secondary', valid_from: '' });
  });
  it('derives sources only for fact URLs not in the registry', () => {
    const src = sourcesFromCsv('de', SOURCES).rows;
    const facts = factsFromCsv('de', FACTS).rows;
    const d = derivedSources(facts, new Set(src.map((s) => sourceId(s.country, s.url))));
    expect(d.map((s) => [s.url, s.origin])).toEqual([['https://other.example/page', 'fact']]);
  });
  it('plans an idempotent re-import and flags changed values', () => {
    const facts = factsFromCsv('de', FACTS).rows;
    const ids = new Map([[sourceId('de', 'https://www.bundesnetzagentur.de/eeg'), 'src-1']]);
    const first = planFactUpserts(facts, new Map(), ids);
    expect(first.created).toBe(2);
    expect(first.upserts[0]).toMatchObject({ status: 'new', source_id: 'src-1' });
    expect(first.upserts[1]!.source_id).toBeNull();
    const existing = new Map<string, ExistingFact>(facts.map((f) => [f.natural_key, { natural_key: f.natural_key, value: f.value, valid_to: f.valid_to, publisher: f.publisher, retrieved_on: f.retrieved_on, excerpt: f.excerpt, confidence: f.confidence }]));
    expect(planFactUpserts(facts, existing, ids)).toMatchObject({ created: 0, unchanged: 2, upserts: [] });
    const k = facts[0]!.natural_key;
    existing.set(k, { ...existing.get(k)!, value: '7.20' });
    const again = planFactUpserts(facts, existing, ids);
    expect(again.upserts).toHaveLength(1);
    expect(again.upserts[0]).toMatchObject({ status: 'changed', previous_value: '7.20', value: '7.70' });
    existing.set(k, { ...existing.get(k)!, value: '7.70', publisher: 'old' });
    expect(planFactUpserts(facts, existing, ids)).toMatchObject({ metadataOnly: 1, changedValue: 0 });
  });
});
