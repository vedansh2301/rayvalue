import { describe, expect, it } from 'vitest';
import { eventSource, parseSummary } from './summary';

const ok = { firstName: 'Ana', installers: ['Acme Solar LLC'], serviced: true, status: 'new', phoneVerified: false, state: 'FL', source: 'results', tracked: false, otpOffered: false, zip: '33101' };

describe('parseSummary', () => {
  it('round-trips a valid summary (object or JSON string)', () => {
    expect(parseSummary(ok)).toEqual(ok);
    expect(parseSummary(JSON.stringify(ok))).toEqual(ok);
  });
  it('rejects junk and bad statuses/states', () => {
    for (const bad of [null, '', '{bad', 5, { ...ok, status: 'sold' }, { ...ok, state: 'TX' }, { ...ok, firstName: 'x'.repeat(61) }]) expect(parseSummary(bad as unknown)).toBeNull();
  });
  it('keeps otpOffered only when exactly true', () => {
    expect(parseSummary({ ...ok, otpOffered: true })?.otpOffered).toBe(true);
    expect(parseSummary({ ...ok, otpOffered: 'yes' })?.otpOffered).toBe(false);
  });
  it('keeps only a 5-digit zip', () => {
    expect(parseSummary({ ...ok, zip: 'abc' })?.zip).toBe('');
    expect(parseSummary({ ...ok, zip: undefined })?.zip).toBe('');
  });
  it('keeps at most 3 string installer names', () => {
    expect(parseSummary({ ...ok, installers: ['a', 'b', 'c', 'd', 5] })?.installers).toEqual(['a', 'b', 'c']);
  });
});

describe('eventSource', () => {
  it('collapses city sources', () => {
    expect(eventSource('city:florida/miami')).toBe('city');
    expect(eventSource('results')).toBe('results');
    expect(eventSource('blog:solar-battery-fl')).toBe('blog');
    expect(eventSource('guide:net-metering')).toBe('guide');
  });
});
