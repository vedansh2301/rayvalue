/** Read noindex/draft from raw MDX frontmatter. noindex defaults to true (matches content schema). */
export function guideFlags(raw: string): { noindex: boolean; draft: boolean } {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? '';
  const flag = (k: string, dflt: boolean) => {
    const m = new RegExp(`^${k}:\\s*(true|false)\\s*$`, 'm').exec(fm);
    return m ? m[1] === 'true' : dflt;
  };
  return { noindex: flag('noindex', true), draft: flag('draft', false) };
}

type GuideFlags = { id: string; noindex: boolean; draft: boolean };

/** A guide is published (linked from the nav, listed on /guides) unless it is a draft. */
export const hasPublishedGuides = (guides: readonly Pick<GuideFlags, 'draft'>[]): boolean => guides.some((g) => !g.draft);

/** Pathnames to keep out of the sitemap: noindex/draft entries, and the index itself while nothing is published. */
export function excludedCollectionUrls(base: string, entries: GuideFlags[]): Set<string> {
  const out = new Set(entries.filter((g) => g.noindex || g.draft).map((g) => `${base}/${g.id}`));
  if (!hasPublishedGuides(entries)) out.add(base);
  return out;
}

export const excludedGuideUrls = (guides: GuideFlags[]) => excludedCollectionUrls('/guides', guides);
