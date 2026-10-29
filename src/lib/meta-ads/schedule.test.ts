import { describe, expect, it } from 'vitest';
import { inWindow, localDayHour, parseWindows, scheduleAction, type ScheduleInput, type Windows } from './schedule';

const NY = 'America/New_York';
const W: Windows = { sun: [[10, 21]], mon: [[18, 22]], tue: [[18, 22]], wed: [[18, 22]], thu: [[18, 22]], fri: [[18, 22]], sat: [[10, 21]] };

describe('parseWindows', () => {
  it('accepts valid windows and fills missing days with none', () => {
    expect(parseWindows({ mon: [[18, 22]] })).toEqual({ sun: [], mon: [[18, 22]], tue: [], wed: [], thu: [], fri: [], sat: [] });
  });
  it.each([null, [], 'x', { mon: [[22, 18]] }, { mon: [[18]] }, { mon: [[18.5, 22]] }, { mon: [[-1, 4]] }, { mon: [[20, 25]] }, { mon: 'all' }])('rejects %j', (v) => {
    expect(parseWindows(v)).toBeNull();
  });
});

describe('localDayHour / inWindow', () => {
  it('uses New York time, including the daylight saving change', () => {
    // Tue 27 Oct 2026 22:30 UTC = 18:30 EDT (UTC-4)
    expect(localDayHour(new Date('2026-10-27T22:30:00Z'), NY)).toEqual({ day: 'tue', hour: 18 });
    // Tue 3 Nov 2026 22:30 UTC = 17:30 EST (UTC-5), after DST ends on 1 Nov
    expect(localDayHour(new Date('2026-11-03T22:30:00Z'), NY)).toEqual({ day: 'tue', hour: 17 });
  });
  it('start hour is inside, end hour is outside', () => {
    expect(inWindow(new Date('2026-10-27T22:00:00Z'), NY, W)).toBe(true); // Tue 18:00 EDT
    expect(inWindow(new Date('2026-10-28T01:59:00Z'), NY, W)).toBe(true); // Tue 21:59 EDT
    expect(inWindow(new Date('2026-10-28T02:00:00Z'), NY, W)).toBe(false); // Tue 22:00 EDT
    expect(inWindow(new Date('2026-10-27T16:00:00Z'), NY, W)).toBe(false); // Tue 12:00 EDT
  });
  it('weekend daytime window', () => {
    expect(inWindow(new Date('2026-10-31T15:00:00Z'), NY, W)).toBe(true); // Sat 11:00 EDT
    expect(inWindow(new Date('2026-10-31T13:00:00Z'), NY, W)).toBe(false); // Sat 09:00 EDT
  });
});

describe('scheduleAction', () => {
  const now = new Date('2026-10-27T23:00:00Z');
  const base: ScheduleInput = { enabled: true, inWindow: true, status: 'PAUSED', endTime: '2026-11-04T05:00:00Z', todaySpendInr: 0, capInr: 100, now };

  it('switches on inside the window', () => expect(scheduleAction(base).action).toBe('activate'));
  it('leaves an active ad set on inside the window', () => expect(scheduleAction({ ...base, status: 'ACTIVE' }).action).toBe('none'));
  it('switches off outside the window', () => expect(scheduleAction({ ...base, inWindow: false, status: 'ACTIVE' }).action).toBe('pause'));
  it('does nothing outside the window when already off', () => expect(scheduleAction({ ...base, inWindow: false }).action).toBe('none'));
  it('switches off at the cap even inside the window', () => {
    expect(scheduleAction({ ...base, status: 'ACTIVE', todaySpendInr: 100 }).action).toBe('pause');
    expect(scheduleAction({ ...base, todaySpendInr: 100.5 }).action).toBe('none');
  });
  it('never switches on when spend is unknown, and switches off', () => {
    expect(scheduleAction({ ...base, todaySpendInr: null }).action).toBe('none');
    expect(scheduleAction({ ...base, status: 'ACTIVE', todaySpendInr: null }).action).toBe('pause');
  });
  it('does nothing when disabled or ended', () => {
    expect(scheduleAction({ ...base, enabled: false, status: 'ACTIVE', inWindow: false }).action).toBe('none');
    expect(scheduleAction({ ...base, endTime: '2026-10-27T00:00:00Z' }).action).toBe('none');
  });
});
