/** "On this page" list: h2 headings only, shown when an article has at least this many. */
export const TOC_MIN_HEADINGS = 4;

export interface TocHeading { depth: number; slug: string; text: string }

export function tocItems(headings: readonly TocHeading[]): TocHeading[] {
  return headings.filter((h) => h.depth === 2 && h.slug && h.text);
}
