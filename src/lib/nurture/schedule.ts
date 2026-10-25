/**
 * Nurture schedule (pure). Five emails over about three weeks, counted from the day the person signed up:
 * 1 estimate (immediately), 2 on day 2, 3 on day 5, 4 on day 10, 5 on day 18. The job runs once a day, so an
 * email goes out on the first run on or after its day, never more than one per run per person, and never to
 * a sign-up older than NURTURE_MAX_AGE_DAYS (so turning the job on late does not mail a stale backlog).
 */
export const NURTURE_OFFSETS_DAYS = [0, 2, 5, 10, 18] as const;
export const NURTURE_STEPS = NURTURE_OFFSETS_DAYS.length;
export const NURTURE_MAX_AGE_DAYS = 35;
/** Minimum time between two emails to one person (catching up never sends two in a day). */
export const NURTURE_MIN_GAP_HOURS = 20;

const DAY_MS = 86_400_000;

export interface NurtureRow {
  created_at: string;
  nurture_step: number;
  nurture_last_sent_at: string | null;
  /** estimate_requests only: 'sent' means the immediate estimate email (step 1) already went out. */
  email_status?: string | null;
}

/** The step (1-5) to send now, or null when nothing is due. */
export function dueStep(row: NurtureRow, now: Date): number | null {
  const created = Date.parse(row.created_at);
  if (!Number.isFinite(created)) return null;
  const done = Math.max(row.nurture_step, row.email_status === 'sent' ? 1 : 0);
  if (done >= NURTURE_STEPS) return null;
  const ageDays = (now.getTime() - created) / DAY_MS;
  if (ageDays > NURTURE_MAX_AGE_DAYS) return null;
  const next = done + 1;
  if (ageDays < NURTURE_OFFSETS_DAYS[next - 1]!) return null;
  if (row.nurture_last_sent_at) {
    const last = Date.parse(row.nurture_last_sent_at);
    if (Number.isFinite(last) && now.getTime() - last < NURTURE_MIN_GAP_HOURS * 3_600_000) return null;
  }
  return next;
}
