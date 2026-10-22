import { describe, expect, it } from 'vitest';
import { checkZip, parseBill } from './form';

describe('checkZip', () => {
  it('accepts an in-state ZIP and returns its location', () => {
    const r = checkZip(' 33101 ', 'FL');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.location.state).toBe('FL');
  });
  it('flags malformed input', () => {
    expect(checkZip('3310', 'FL')).toEqual({ ok: false, error: 'format' });
    expect(checkZip('abcde', 'FL')).toEqual({ ok: false, error: 'format' });
    expect(checkZip('', 'CA')).toEqual({ ok: false, error: 'format' });
  });
  it('flags ZIPs that are not in either state table', () => {
    expect(checkZip('10001', 'FL')).toEqual({ ok: false, error: 'not_found' });
  });
  it('points out-of-state ZIPs to the other state', () => {
    expect(checkZip('94103', 'FL')).toEqual({ ok: false, error: 'other_state', otherState: 'CA' });
    expect(checkZip('33101', 'CA')).toEqual({ ok: false, error: 'other_state', otherState: 'FL' });
  });
});

describe('parseBill', () => {
  it('parses plain and formatted dollar amounts', () => {
    expect(parseBill('185', 5000)).toEqual({ ok: true, value: 185 });
    expect(parseBill(' $1,250.50 ', 5000)).toEqual({ ok: true, value: 1250.5 });
  });
  it('rejects empty and non-numeric input', () => {
    expect(parseBill('  ', 5000)).toEqual({ ok: false, error: 'empty' });
    expect(parseBill('abc', 5000)).toEqual({ ok: false, error: 'not_number' });
    expect(parseBill('-20', 5000)).toEqual({ ok: false, error: 'not_number' });
    expect(parseBill('1e3', 5000)).toEqual({ ok: false, error: 'not_number' });
    expect(parseBill('12.345', 5000)).toEqual({ ok: false, error: 'not_number' });
  });
  it('enforces bounds', () => {
    expect(parseBill('0', 5000)).toEqual({ ok: false, error: 'too_low' });
    expect(parseBill('5000', 5000)).toEqual({ ok: true, value: 5000 });
    expect(parseBill('5000.01', 5000)).toEqual({ ok: false, error: 'too_high' });
  });
});
