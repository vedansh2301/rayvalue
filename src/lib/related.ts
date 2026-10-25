/** Pure picker for the blog "Related reading" block. */
export interface RelatedCandidate {
  id: string;
  state?: 'FL' | 'CA' | 'both';
  tags: readonly string[];
  published: Date;
}

/** 1 for the same state, 0.5 when one side covers both states, else 0. */
const stateScore = (a?: RelatedCandidate['state'], b?: RelatedCandidate['state']): number =>
  !a || !b ? 0 : a === b ? 1 : a === 'both' || b === 'both' ? 0.5 : 0;

/** Score = shared tags (2 each) + state match (1, or 0.5 for a both-state post). */
export const relatedScore = (a: RelatedCandidate, b: RelatedCandidate): number => {
  const shared = a.tags.filter((t) => b.tags.includes(t)).length;
  return shared * 2 + stateScore(a.state, b.state);
};

/**
 * Up to `n` other posts, best match first. Ties go to the next posts in id order after the current one (wrapping),
 * which is deterministic and spreads inbound links evenly instead of always favouring the newest posts.
 */
export function pickRelated<T extends RelatedCandidate>(current: RelatedCandidate, all: readonly T[], n = 3): T[] {
  const ids = [...new Set([...all.map((p) => p.id), current.id])].sort();
  const dist = (id: string) => (ids.indexOf(id) - ids.indexOf(current.id) + ids.length) % ids.length;
  return all
    .filter((p) => p.id !== current.id)
    .map((p) => ({ p, s: relatedScore(current, p) }))
    .sort((x, y) => y.s - x.s || dist(x.p.id) - dist(y.p.id))
    .slice(0, n)
    .map((x) => x.p);
}
