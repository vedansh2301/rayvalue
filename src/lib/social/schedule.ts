/** Posting-slot and due-post helpers (pure; time zone math with Intl only). */
import type { PostType, Slot, SocialPost } from './types';

/** Wall-clock parts of `date` in `timeZone`. */
function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    h: Number(get('hour')),
    min: Number(get('minute')),
    s: Number(get('second')),
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
  };
}

/** UTC instant for a wall-clock time in `timeZone` (DST-safe: corrects by the zone offset at that instant). */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = zonedParts(new Date(guess), timeZone);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - guess;
  const first = guess - offset;
  const p2 = zonedParts(new Date(first), timeZone);
  const offset2 = Date.UTC(p2.y, p2.m - 1, p2.d, p2.h, p2.min, p2.s) - first;
  return new Date(guess - offset2);
}

export const isValidSlot = (s: unknown): s is Slot =>
  typeof s === 'object' && s !== null && Number.isInteger((s as Slot).dow) && (s as Slot).dow >= 0 && (s as Slot).dow <= 6 && /^([01]\d|2[0-3]):[0-5]\d$/.test(String((s as Slot).time)) && ['reel', 'image', 'carousel', 'story'].includes(String((s as Slot).type));

/** Upcoming slot instants (UTC) for `type`, starting after `from`, over the next `days` days, in time order. */
export function upcomingSlots(slots: Slot[], type: PostType, timeZone: string, from: Date, days = 21): Date[] {
  const out: Date[] = [];
  const start = zonedParts(from, timeZone);
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const dow = day.getUTCDay();
    for (const s of slots) {
      if (s.type !== type || s.dow !== dow) continue;
      const [h, min] = s.time.split(':').map(Number) as [number, number];
      const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, min, timeZone);
      if (at > from) out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** First upcoming slot for `type` that no scheduled post already occupies (same minute). null if none in range. */
export function nextFreeSlot(slots: Slot[], type: PostType, timeZone: string, taken: (string | null)[], from: Date): Date | null {
  const used = new Set(taken.filter((t): t is string => !!t).map((t) => Math.floor(new Date(t).getTime() / 60000)));
  return upcomingSlots(slots, type, timeZone, from).find((d) => !used.has(Math.floor(d.getTime() / 60000))) ?? null;
}

/** Posts the publisher should act on now: scheduled and due, or mid-publish (container waiting), oldest first. */
export function duePosts<T extends Pick<SocialPost, 'status' | 'scheduled_at'>>(posts: T[], now: Date, limit = 5): T[] {
  return posts
    .filter((p) => p.status === 'publishing' || (p.status === 'scheduled' && p.scheduled_at !== null && new Date(p.scheduled_at) <= now))
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
    .slice(0, limit);
}

/** "Mon 3 Nov, 6:00 PM ET"-style label for the admin UI. */
export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
}
