/** Real stories: pure helpers (no astro:content import, so they are unit-testable). */
export type StoryState = 'FL' | 'CA';
export type StoryFilter = StoryState | 'both';

export interface StoryLike {
  data: { state: StoryState; date_reported: Date };
}

/** Stories reported before this year get an explicit year label, so older events are not read as current. */
export const STORY_RECENT_FROM_YEAR = 2024;

const newestFirst = <T extends StoryLike>(a: T, b: T) => b.data.date_reported.getTime() - a.data.date_reported.getTime();
const isRecent = (s: StoryLike) => s.data.date_reported.getUTCFullYear() >= STORY_RECENT_FROM_YEAR;

/** The year to label a story with, or null when it is recent enough not to need one. */
export function olderStoryYear(dateReported: Date): number | null {
  const y = dateReported.getUTCFullYear();
  return y < STORY_RECENT_FROM_YEAR ? y : null;
}

/**
 * Deterministic "mostly recent" pick from a pool: the newest (limit - 1) recent stories plus the newest older one
 * for context. Short on recent stories, it fills with older ones; short on older ones, with more recent ones.
 * Returned newest first. No randomness, so static pages are reproducible.
 */
export function mixStories<T extends StoryLike>(pool: readonly T[], limit: number): T[] {
  const n = Math.max(0, Math.floor(limit));
  const sorted = [...pool].sort(newestFirst);
  if (sorted.length <= n) return sorted;
  const recent = sorted.filter(isRecent);
  const older = sorted.filter((s) => !isRecent(s));
  const picked = recent.slice(0, older.length > 0 && n > 1 ? n - 1 : n);
  for (const s of [...older, ...recent]) {
    if (picked.length >= n) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.sort(newestFirst);
}

/**
 * Filtered by state, newest first. Without a limit: every story (the full /stories page).
 * With a limit: the mostly-recent mix from mixStories (calculator pages).
 */
export function selectStories<T extends StoryLike>(stories: readonly T[], state: StoryFilter = 'both', limit?: number): T[] {
  const pool = stories.filter((s) => state === 'both' || s.data.state === state);
  return limit === undefined ? [...pool].sort(newestFirst) : mixStories(pool, limit);
}

/**
 * Home page picks (default 3): the newest recent Florida story and the newest recent California story, plus the
 * newest older story for context; any gap is filled by the next newest recent stories, then older ones.
 * Returned newest first.
 */
export function homeStories<T extends StoryLike>(stories: readonly T[], limit = 3): T[] {
  const n = Math.max(0, Math.floor(limit));
  const sorted = [...stories].sort(newestFirst);
  const recent = sorted.filter(isRecent);
  const older = sorted.filter((s) => !isRecent(s));
  const firstOf = (state: StoryState) => recent.find((s) => s.data.state === state);
  const picked: T[] = [];
  const add = (s: T | undefined) => {
    if (s && picked.length < n && !picked.includes(s)) picked.push(s);
  };
  add(firstOf('FL'));
  add(firstOf('CA'));
  if (n > 1) add(older[0]);
  for (const s of [...recent, ...older]) add(s);
  return picked.sort(newestFirst);
}
