/** Post status rules (pure). The single source of truth for which moves /admin/social and the publisher may make. */
import type { PostStatus } from './types';

export const TRANSITIONS: Record<PostStatus, readonly PostStatus[]> = {
  draft: ['review', 'scheduled', 'archived'],
  review: ['draft', 'scheduled', 'archived'],
  scheduled: ['draft', 'publishing', 'failed', 'archived'],
  publishing: ['published', 'failed'],
  published: ['archived'],
  failed: ['scheduled', 'draft', 'archived'],
  archived: ['draft'],
};

export const canTransition = (from: PostStatus, to: PostStatus) => TRANSITIONS[from].includes(to);

/**
 * Extra moves only the publisher makes (the owner's UI never does): a scheduled post whose checks fail on the final
 * re-check goes to "review", and a publish that failed with attempts left goes back to "scheduled" to retry.
 */
const PUBLISHER_MOVES: readonly (readonly [PostStatus, PostStatus])[] = [
  ['scheduled', 'review'],
  ['publishing', 'scheduled'],
];
export const publisherCanMove = (from: PostStatus, to: PostStatus) => canTransition(from, to) || PUBLISHER_MOVES.some(([a, b]) => a === from && b === to);

/** Content edits are allowed only before the publisher has touched the post. */
export const isEditable = (s: PostStatus) => s === 'draft' || s === 'review' || s === 'scheduled' || s === 'failed';

/**
 * Where a post lands when the owner (or the generator) asks to schedule it: passing posts go to "scheduled" when
 * auto-publish is on or the owner scheduled it by hand; anything with a failing check waits in "review".
 */
export function statusOnSchedule(opts: { checksPassed: boolean; autoPublish: boolean; byOwner: boolean }): 'scheduled' | 'review' {
  if (!opts.checksPassed) return 'review';
  return opts.autoPublish || opts.byOwner ? 'scheduled' : 'review';
}

/** Failed publishes retry automatically this many times before staying "failed" for the owner. */
export const MAX_ATTEMPTS = 3;

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Draft',
  review: 'Needs review',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
  archived: 'Archived',
};
