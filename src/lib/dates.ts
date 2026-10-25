/** Human-readable date, e.g. "Oct 25, 2026". UTC so the day matches the frontmatter date everywhere. */
export const displayDate = (d: Date): string => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
/** "Updated" is shown only when it is a different day from the publish date. */
export const showUpdated = (published: Date | undefined, updated: Date | undefined): boolean =>
  !!updated && (!published || isoDay(updated) !== isoDay(published));
