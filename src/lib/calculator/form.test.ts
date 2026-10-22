import { describe, expect, it } from 'vitest';
import { parseBill } from './form';

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
