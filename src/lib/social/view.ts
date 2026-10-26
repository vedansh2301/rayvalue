/** Display helpers for /admin/social (pure): calendar grid, insights table, status chips. */
import type { PostStatus, SocialPost } from './types';

/** "YYYY-MM-DD" of an instant in `tz`. */
export function dayKey(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A valid "YYYY-MM" or the month of `fallback` in `tz`. */
export function parseMonth(raw: string | null, fallback: Date, tz: string): string {
  return raw && MONTH_RE.test(raw) && Number(raw.slice(0, 4)) >= 2000 ? raw : dayKey(fallback.toISOString(), tz).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const m = MONTH_RE.exec(month)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const monthLabel = (month: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00Z`));

export type CalendarPost = Pick<SocialPost, 'id' | 'title' | 'type' | 'status' | 'scheduled_at' | 'published_at'>;
export interface CalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
  posts: { post: CalendarPost; at: string }[];
}

/** The instant a post sits on the calendar: when it went out, or when it is due. Archived posts are left off. */
export const calendarInstant = (p: CalendarPost): string | null => (p.status === 'archived' ? null : p.status === 'published' ? (p.published_at ?? p.scheduled_at) : p.scheduled_at);

/** Sunday-first month grid, whole weeks, with each post placed on its day in `tz`. */
export function buildMonthGrid(month: string, tz: string, posts: CalendarPost[]): CalendarCell[][] {
  const m = MONTH_RE.exec(month)!;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const start = new Date(Date.UTC(y, mo - 1, 1 - first.getUTCDay()));
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const weeks = Math.ceil((first.getUTCDay() + daysInMonth) / 7);
  const byDay = new Map<string, CalendarCell['posts']>();
  for (const post of posts) {
    const at = calendarInstant(post);
    if (!at) continue;
    const k = dayKey(at, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), { post, at }]);
  }
  const grid: CalendarCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const row: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * 86_400_000);
      const key = date.toISOString().slice(0, 10);
      row.push({ date: key, day: date.getUTCDate(), inMonth: key.startsWith(month), posts: [...(byDay.get(key) ?? [])].sort((a, b) => a.at.localeCompare(b.at)) });
    }
    grid.push(row);
  }
  return grid;
}

// ------------------------------------------------------------------ insights
type InsightPost = Pick<SocialPost, 'id' | 'insights'>;

/** Every metric name present in any post's insights, sorted. */
export const insightKeys = (posts: InsightPost[]): string[] => [...new Set(posts.flatMap((p) => Object.keys(p.insights ?? {})))].sort();

/** Sum of each metric over the posts that report it. */
export function insightTotals(posts: InsightPost[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const p of posts) for (const [k, v] of Object.entries(p.insights ?? {})) if (typeof v === 'number' && Number.isFinite(v)) t[k] = (t[k] ?? 0) + v;
  return t;
}

/** Highest first by `metric`; posts without it go last. */
export function sortByMetric<T extends InsightPost>(posts: T[], metric: string | null): T[] {
  if (!metric) return [...posts];
  const val = (p: T) => {
    const v = p.insights?.[metric];
    return typeof v === 'number' ? v : -Infinity;
  };
  return [...posts].sort((a, b) => val(b) - val(a));
}

export const metricLabel = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Tailwind classes for a status chip (kept here so the pages and tests agree). */
export const STATUS_CHIP: Record<PostStatus, string> = {
  draft: 'border-stone-300 bg-stone-100 text-stone-800',
  review: 'border-amber-400 bg-amber-100 text-amber-900',
  scheduled: 'border-sky-300 bg-sky-100 text-sky-900',
  publishing: 'border-indigo-300 bg-indigo-100 text-indigo-900',
  published: 'border-green-400 bg-green-100 text-green-900',
  failed: 'border-red-400 bg-red-100 text-red-900',
  archived: 'border-stone-300 bg-white text-stone-600',
};

export function formatBytes(n: number | null): string {
  if (n === null) return 'unknown size';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
