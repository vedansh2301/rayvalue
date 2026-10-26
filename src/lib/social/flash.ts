/** One-line confirmations shown after a redirect (?ok=<code>). Codes, not text, travel in the URL. */
export const FLASH = {
  saved: 'Saved.',
  created: 'Draft created.',
  scheduled: 'Scheduled.',
  queued_now: 'Queued to publish now. The publisher runs about every 15 minutes, so it goes out within roughly 15 minutes.',
  needs_review: 'Some checks failed, so the post will not publish yet. It is waiting for review. Fix the checks, then schedule it again.',
  demoted_draft: 'Some checks failed, so the post will not publish. It is a draft. Fix the checks, then schedule it again.',
  demoted_by_save: 'Saved. A check now fails, so the post was taken off the schedule and is a draft.',
  unscheduled: 'Taken off the schedule; it is a draft again.',
  retried: 'Queued again. The publisher picks it up within about 15 minutes.',
  archived: 'Archived.',
  duplicated: 'Duplicated as a draft. Edit the copy, then schedule it.',
  deleted: 'Draft deleted.',
  paused: 'All posting is paused. Nothing will publish until you resume.',
  resumed: 'Posting resumed.',
  rendering: 'Rendering. The post appears here in a few minutes.',
  no_token: 'Generation runs nightly. GITHUB_DISPATCH_TOKEN is not configured, so it cannot be started from here.',
} as const;

export type FlashCode = keyof typeof FLASH;
export const flashText = (code: string | null): string | null => (code && Object.hasOwn(FLASH, code) ? FLASH[code as FlashCode] : null);
