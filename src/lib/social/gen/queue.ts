/** Where a freshly generated post lands in the queue (pure). */
import { nextFreeSlot } from '../schedule';
import { statusOnSchedule } from '../status';
import type { PostType, SocialSettings } from '../types';

export interface QueueDecision {
  status: 'draft' | 'review' | 'scheduled';
  scheduledAt: Date | null;
}

/**
 * - paused: generate but keep it a draft.
 * - failing checks, or auto-publish off: "review" (statusOnSchedule).
 * - otherwise: "scheduled" at the next free slot for its type; with no free slot it stays a draft.
 */
export function decideQueueState(opts: {
  checksPassed: boolean;
  type: PostType;
  settings: Pick<SocialSettings, 'auto_publish' | 'paused' | 'timezone' | 'slots'>;
  /** scheduled_at of posts already holding a slot. */
  taken: (string | null)[];
  now: Date;
}): QueueDecision {
  const { settings } = opts;
  if (settings.paused) return { status: 'draft', scheduledAt: null };
  const s = statusOnSchedule({ checksPassed: opts.checksPassed, autoPublish: settings.auto_publish, byOwner: false });
  if (s === 'review') return { status: 'review', scheduledAt: null };
  const slot = nextFreeSlot(settings.slots, opts.type, settings.timezone, opts.taken, opts.now);
  return slot ? { status: 'scheduled', scheduledAt: slot } : { status: 'draft', scheduledAt: null };
}
