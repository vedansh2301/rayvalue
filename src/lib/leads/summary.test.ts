import { describe, expect, it } from 'vitest';
import { eventSource, parseSummary } from './summary';

const ok = { firstName: 'Ana', installers: ['Acme Solar LLC'], serviced: true, status: 'new', phoneVerified: false, state: 'FL', source: 'results', tracked: false };

describe('parseSummary', () => {
  it('round-trips a valid summary (object or JSON string)', () => {
    expect(parseSummary(ok)).toEqual(ok);
    expect(parseSummary(JSON.stringify(ok))).toEqual(ok);
  });
  it('rejects junk and bad statuses/states', () => {
    for (const bad of [null, '', '{bad', 5, { ...ok, status: 'sold' }, { ...ok, state: 'TX' }, { ...ok, firstName: 'x'.repeat(61) }]) expect(parseSummary(bad as unknown)).toBeNull();
  });
  it('keeps at most 3 string installer names', () => {
    expect(parseSummary({ ...ok, installers: ['a', 'b', 'c', 'd', 5] })?.installers).toEqual(['a', 'b', 'c']);
  });
});

describe('eventSource', () => {
  it('collapses city sources', () => {
    expect(eventSource('city:florida/miami')).toBe('city');
    expect(eventSource('results')).toBe('results');
  });
});
