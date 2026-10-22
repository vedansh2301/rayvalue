/** Read noindex/draft from raw MDX frontmatter. noindex defaults to true (matches content schema). */
export function guideFlags(raw: string): { noindex: boolean; draft: boolean } {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? '';
  const flag = (k: string, dflt: boolean) => {
    const m = new RegExp(`^${k}:\\s*(true|false)\\s*$`, 'm').exec(fm);
    return m ? m[1] === 'true' : dflt;
  };
  return { noindex: flag('noindex', true), draft: flag('draft', false) };
}

/** Pathnames to keep out of the sitemap. */
export function excludedGuideUrls(guides: { id: string; noindex: boolean; draft: boolean }[]): Set<string> {
  return new Set(guides.filter((g) => g.noindex || g.draft).map((g) => `/guides/${g.id}`));
}
