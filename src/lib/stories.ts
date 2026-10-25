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
