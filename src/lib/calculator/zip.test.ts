import { describe, expect, it } from 'vitest';
import caZips from '../../data/zips/ca.json';
import flZips from '../../data/zips/fl.json';
import { lookupZip } from '../geo';
import { checkZipIn, loadZipTable, prefixMatcher, stateByPrefix, type ZipTable } from './zip';

const FL = flZips as unknown as ZipTable;
const CA = caZips as unknown as ZipTable;

describe('prefixMatcher / stateByPrefix', () => {
  it('handles ranges and single prefixes', () => {
    const m = prefixMatcher('320-339, 341, 342');
    expect(['320', '333', '339', '341', '342'].every(m)).toBe(true);
    expect(['319', '340', '343'].some(m)).toBe(false);
  });
  it('maps prefixes to states', () => {
    expect(stateByPrefix('33101')).toBe('FL');
    expect(stateByPrefix('94103')).toBe('CA');
    expect(stateByPrefix('10001')).toBeNull();
  });
});

describe('checkZipIn', () => {
  it('accepts an in-state ZIP with its coordinates', () => {
    const r = checkZipIn(' 33101 ', 'FL', FL);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.location).toEqual(lookupZip('33101'));
  });
  it('flags malformed input', () => {
    expect(checkZipIn('3310', 'FL', FL)).toEqual({ ok: false, error: 'format' });
    expect(checkZipIn('abcde', 'CA', CA)).toEqual({ ok: false, error: 'format' });
  });
  it('flags unknown ZIPs', () => {
    expect(checkZipIn('10001', 'FL', FL)).toEqual({ ok: false, error: 'not_found' });
    expect(checkZipIn('constructor'.slice(0, 5), 'FL', FL)).toEqual({ ok: false, error: 'format' });
  });
  it('points other-state ZIPs to the other calculator without its table', () => {
    expect(checkZipIn('94103', 'FL', FL)).toEqual({ ok: false, error: 'other_state', otherState: 'CA' });
    expect(checkZipIn('33101', 'CA', CA)).toEqual({ ok: false, error: 'other_state', otherState: 'FL' });
  });
  it('agrees with lookupZip for every ZIP in both tables', () => {
    for (const [state, table] of [['FL', FL], ['CA', CA]] as const) {
      for (const zip of Object.keys(table)) {
        const r = checkZipIn(zip, state, table);
        expect(r.ok && r.location).toEqual(lookupZip(zip));
      }
    }
  });
});

describe('loadZipTable', () => {
  it('loads and caches one state table', async () => {
    const a = await loadZipTable('FL');
    expect(a['33101']).toEqual(FL['33101']);
    expect(await loadZipTable('FL')).toBe(a);
  });
});
