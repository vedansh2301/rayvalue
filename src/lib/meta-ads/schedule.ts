/**
 * Ad set hour schedule (pure, unit tested). Meta only dayparts ad sets with a lifetime budget, and a lifetime budget
 * front-loads spend past the owner's ₹100/day cap (27 Oct 2026: ₹289.83 in one evening). So the schedule keeps a
 * daily-budget ad set and switches it on inside the windows and off outside them, from a 5-minute cron.
 *
 * The windows, time zone and ad set come from public.ads_schedule (with a rationale); the cap is
 * ads_settings.max_daily_budget_inr, checked against today's whole-account spend (ad account time zone).
 * Rules, in order:
 *   - schedule disabled -> do nothing;
 *   - today's spend unknown -> never switch on; switch off if it is on;
 *   - today's spend >= the stop point (the cap, or ads_schedule.stop_at_inr below it) -> switch off;
 *   - ad set past its end_time -> do nothing (Meta has stopped it);
 *   - inside a window -> switch on; outside -> switch off.
 */

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** [start hour, end hour) in local time, whole hours 0-24, start < end. */
export type HourWindow = [number, number];
export type Windows = Record<Weekday, HourWindow[]>;

/** Validate the jsonb windows column; null when any part is malformed (the schedule then does nothing). */
export function parseWindows(v: unknown): Windows | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {} as Windows;
  for (const d of WEEKDAYS) {
    const list = (v as Record<string, unknown>)[d] ?? [];
    if (!Array.isArray(list)) return null;
    const windows: HourWindow[] = [];
    for (const w of list) {
      if (!Array.isArray(w) || w.length !== 2) return null;
      const [s, e] = w as unknown[];
      if (!Number.isInteger(s) || !Number.isInteger(e) || (s as number) < 0 || (e as number) > 24 || (s as number) >= (e as number)) return null;
      windows.push([s as number, e as number]);
    }
    out[d] = windows;
  }
  return out;
}

/** Weekday and hour of `now` in `timeZone` (IANA name, so daylight saving is handled). */
export function localDayHour(now: Date, timeZone: string): { day: Weekday; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const wd = parts.find((p) => p.type === 'weekday')?.value.slice(0, 3).toLowerCase() as Weekday;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return { day: wd, hour };
}

export function inWindow(now: Date, timeZone: string, windows: Windows): boolean {
  const { day, hour } = localDayHour(now, timeZone);
  return (windows[day] ?? []).some(([s, e]) => hour >= s && hour < e);
}

/**
 * The spend at which the schedule switches off: the daily cap, or ads_schedule.stop_at_inr when that is lower.
 * Meta reports spend late, so stopping below the cap leaves room for spend that has not been reported yet.
 */
export function stopAtInr(capInr: number, stopAt: number | null): number {
  return stopAt !== null && Number.isFinite(stopAt) && stopAt > 0 && stopAt < capInr ? stopAt : capInr;
}

export interface ScheduleInput {
  enabled: boolean;
  inWindow: boolean;
  /** The ad set's configured status (ACTIVE / PAUSED / ...). */
  status: string | null;
  /** ISO end_time of the ad set, or null for no end. */
  endTime: string | null;
  /** Whole-account spend today in INR; null = could not be read. */
  todaySpendInr: number | null;
  capInr: number;
  now: Date;
}

export type ScheduleAction = { action: 'activate' | 'pause' | 'none'; reason: string };

export function scheduleAction(i: ScheduleInput): ScheduleAction {
  const on = i.status === 'ACTIVE';
  const off = (reason: string): ScheduleAction => (on ? { action: 'pause', reason } : { action: 'none', reason });
  if (!i.enabled) return { action: 'none', reason: 'schedule disabled' };
  if (i.todaySpendInr === null) return off("today's spend could not be read");
  if (i.todaySpendInr >= i.capInr) return off(`today's spend ₹${i.todaySpendInr} reached the ₹${i.capInr} cap`);
  if (i.endTime && Date.parse(i.endTime) <= i.now.getTime()) return { action: 'none', reason: 'ad set has ended' };
  if (i.inWindow) return on ? { action: 'none', reason: 'inside window, already on' } : { action: 'activate', reason: 'inside window' };
  return off('outside window');
}
