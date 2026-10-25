/** Content a utility page links to, by state. Titles come from the content collections, not from here. */
export const UTILITY_READ_MORE: Record<'FL' | 'CA', { collection: 'blog' | 'guides'; id: string }[]> = {
  FL: [
    { collection: 'blog', id: 'florida-electricity-rates-2026' },
    { collection: 'blog', id: 'florida-summer-bills-and-solar' },
    { collection: 'blog', id: 'community-solar-florida-california' },
    { collection: 'guides', id: 'florida-solar-without-federal-tax-credit' },
  ],
  CA: [
    { collection: 'blog', id: 'why-california-electricity-is-expensive' },
    { collection: 'blog', id: 'solar-and-ev-charging' },
    { collection: 'blog', id: 'home-battery-costs-and-backup' },
    { collection: 'guides', id: 'california-nem-3-batteries' },
  ],
};
