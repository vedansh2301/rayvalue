/**
 * Staffed call hours (pure). The hours live in the Supabase table staffed_hours (per state, in that state's own
 * timezone) and the number in the CALL_NUMBER env var; nothing is hardcoded. Without a valid number or hours the
 * "Talk to someone now" link is simply not shown.
 */
export interface StaffedHours {
  /** IANA timezone, e.g. America/New_York. */
  timezone: string;
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
  days: number[];
  /** "HH:MM" or "HH:MM:SS", inclusive. */
  open_time: string;
  /** "HH:MM" or "HH:MM:SS", exclusive. */
  close_time: string;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const minutesOf = (t: string): number | null => {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 24 && mi < 60 ? h * 60 + mi : null;
};

/** Is `now` inside the staffed hours (weekday and time of day are read in the configured timezone)? */
export function isStaffedNow(now: Date, h: StaffedHours): boolean {
  const open = minutesOf(h.open_time);
  const close = minutesOf(h.close_time);
  if (open === null || close === null || close <= open || h.days.length === 0) return false;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: h.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    return false; // unknown timezone: hide rather than guess
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = WEEKDAYS[get('weekday')];
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  if (!day || !Number.isFinite(minutes)) return false;
  return h.days.includes(day) && minutes >= open && minutes < close;
}

export interface CallNumber {
  /** E.164, for the tel: link. */
  tel: string;
  /** "(305) 201-0123" */
  display: string;
}

/** The owner's CALL_NUMBER value -> a callable US number, or null (unset, a {{placeholder}}, or malformed). */
export function parseCallNumber(raw: unknown): CallNumber | null {
  if (typeof raw !== 'string' || raw.length > 40 || /[^\d\s().+\-]/.test(raw)) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  return { tel: `+1${d}`, display: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` };
}
