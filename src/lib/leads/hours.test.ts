import { describe, expect, it } from 'vitest';
import { isStaffedNow, parseCallNumber, type StaffedHours } from './hours';

const ny: StaffedHours = { timezone: 'America/New_York', days: [1, 2, 3, 4, 5], open_time: '09:00:00', close_time: '17:00:00' };

describe('isStaffedNow', () => {
  it('is true inside the window in the configured timezone', () => {
    // Mon 2026-10-26 14:00 UTC = 10:00 EDT
    expect(isStaffedNow(new Date('2026-10-26T14:00:00Z'), ny)).toBe(true);
  });
  it('reads the time in the state timezone, not the visitor timezone', () => {
    // Mon 13:00 UTC = 09:00 EDT (open, inclusive); 12:59 UTC = 08:59 EDT (closed)
    expect(isStaffedNow(new Date('2026-10-26T13:00:00Z'), ny)).toBe(true);
    expect(isStaffedNow(new Date('2026-10-26T12:59:00Z'), ny)).toBe(false);
  });
  it('close time is exclusive', () => {
    expect(isStaffedNow(new Date('2026-10-26T20:59:00Z'), ny)).toBe(true); // 16:59 EDT
    expect(isStaffedNow(new Date('2026-10-26T21:00:00Z'), ny)).toBe(false); // 17:00 EDT
  });
  it('is false on days not listed', () => {
    expect(isStaffedNow(new Date('2026-10-24T15:00:00Z'), ny)).toBe(false); // Saturday
  });
  it('handles daylight saving (Los Angeles, after the Nov 1 2026 change)', () => {
    const la: StaffedHours = { timezone: 'America/Los_Angeles', days: [7], open_time: '10:00', close_time: '12:00' };
    expect(isStaffedNow(new Date('2026-11-01T19:00:00Z'), la)).toBe(true); // Sun 11:00 PST
    expect(isStaffedNow(new Date('2026-11-01T17:30:00Z'), la)).toBe(false); // 09:30 PST
  });
  it('hides on bad config instead of guessing', () => {
    expect(isStaffedNow(new Date(), { ...ny, timezone: 'Mars/Base' })).toBe(false);
    expect(isStaffedNow(new Date(), { ...ny, open_time: 'nine' })).toBe(false);
    expect(isStaffedNow(new Date(), { ...ny, close_time: '08:00' })).toBe(false);
    expect(isStaffedNow(new Date(), { ...ny, days: [] })).toBe(false);
  });
});

describe('parseCallNumber', () => {
  it('formats a valid US number', () => {
    expect(parseCallNumber('305-201-0123')).toEqual({ tel: '+13052010123', display: '(305) 201-0123' });
    expect(parseCallNumber('+1 (305) 201 0123')?.tel).toBe('+13052010123');
  });
  it('rejects unset values, placeholders and junk', () => {
    for (const v of [undefined, '', '{{CALL_NUMBER}}', '123', 'call us', '105-201-0123']) expect(parseCallNumber(v)).toBeNull();
  });
});
