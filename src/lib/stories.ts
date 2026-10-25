/** Real stories: pure helpers (no astro:content import, so they are unit-testable). */
export type StoryState = 'FL' | 'CA';
export type StoryFilter = StoryState | 'both';

export interface StoryLike {
  data: { state: StoryState; date_reported: Date };
}

/** Newest first, optionally filtered by state, optionally limited. */
export function selectStories<T extends StoryLike>(stories: readonly T[], state: StoryFilter = 'both', limit?: number): T[] {
  const out = stories
    .filter((s) => state === 'both' || s.data.state === state)
    .sort((a, b) => b.data.date_reported.getTime() - a.data.date_reported.getTime());
  return limit === undefined ? out : out.slice(0, Math.max(0, limit));
}

/** Stories reported before this year get an explicit year label, so older events are not read as current. */
export const STORY_RECENT_FROM_YEAR = 2024;

/** The year to label a story with, or null when it is recent enough not to need one. */
export function olderStoryYear(dateReported: Date): number | null {
  const y = dateReported.getUTCFullYear();
  return y < STORY_RECENT_FROM_YEAR ? y : null;
}

/** Home page picks: Florida first (newest two), then the newest California story. */
export function homeStories<T extends StoryLike>(stories: readonly T[], flCount = 2, caCount = 1): T[] {
  return [...selectStories(stories, 'FL', flCount), ...selectStories(stories, 'CA', caCount)];
}
