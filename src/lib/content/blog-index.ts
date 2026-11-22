/**
 * Pure data shaping for the blog indexes (/blog and /<cc>/blog): topic of each post, the featured lead + two side cards,
 * the lead's badge and the country chips. Nothing numeric is typed here (CLAUDE.md rule 1): counts and dates are computed
 * from the content collection frontmatter.
 *
 * TOPIC RULES (first match wins; haystack = slug + title + tags, lowercased; the multi-language keywords are structural):
 *   1. frontmatter `deadline` set                          -> policy  ("Rules & deadlines")
 *   2. "doesn't pay / not worth / nicht lohnt / non conviene / no compensan ..." -> nopay ("When it doesn't pay")
 *   3. red flag / scam / quote / offer words in any covered language -> flags ("Quote red flags")
 *   4. battery / Speicher / accumulo / thuisbatterij ...    -> battery ("Batteries")
 *   5. deadline / ends / price cap / ECO4 / regulation / subsidy / lock-in -> policy
 *   6. cost / price / rates / bills / tariff ...            -> costs ("Costs")
 *   7. otherwise                                            -> worth ("Worth it?")
 */
export const BLOG_TOPICS = ['worth', 'nopay', 'flags', 'battery', 'policy', 'costs'] as const;
export type BlogTopic = (typeof BLOG_TOPICS)[number];
export const BLOG_TOPIC_LABEL: Readonly<Record<BlogTopic, string>> = {
  worth: 'Worth it?', nopay: 'When it doesn’t pay', flags: 'Quote red flags', battery: 'Batteries', policy: 'Rules & deadlines', costs: 'Costs',
};

const NOPAY = /do(es)?n'?t[- ]pay|isn'?t[- ]worth|not[- ]worth|nicht[- ]lohnt|non[- ]conviene|niet[- ]lonen|no[- ]compensan|nao[- ]compensam|n[aõ]o compensam|n-est-pas-rentable|pas rentable|nu[- ]merita|nu merit|eivat[- ]kannata|eivät kannata|mukanai|furada|向かない|元が取れない/;
const FLAGS = /red[- ]?flags?|scam|estaf|truff|golpe|podvod|pulapki|preventiv|ofert|nabidk|misleid|angebot-pruefen|segnali|alarma|energosmejd|quote/;
const BATTERY = /batter|speicher|accumul|storage|backup|magazyn|蓄電池/;
const POLICY = /deadline|\bends?\b|ending|lock-in|price-cap|eco4|borrador|creg|regulaci|subsid|quita|supprim|elafgift|bandeira/;
const COSTS = /cost|pric|preis|prezz|prec|preço|費用|相場|\brates?\b|tarif|\bbills?\b|conta de luz/;

export function blogTopic(a: { id: string; title: string; tags?: readonly string[]; deadline?: Date | null }): BlogTopic {
  if (a.deadline) return 'policy';
  const hay = `${a.id} ${a.title} ${(a.tags ?? []).join(' ')}`.toLowerCase().replace(/[’]/g, "'");
  if (NOPAY.test(hay)) return 'nopay';
  if (FLAGS.test(hay)) return 'flags';
  if (BATTERY.test(hay)) return 'battery';
  if (POLICY.test(hay)) return 'policy';
  if (COSTS.test(hay)) return 'costs';
  return 'worth';
}

export interface BlogPost { id: string; segment: string; published: Date; deadline?: Date | null }

const byNewest = <T extends { published: Date; id: string }>(a: T, b: T) => b.published.getTime() - a.published.getTime() || a.id.localeCompare(b.id);

/**
 * Featured block: the lead is the post whose dated deadline is soonest and still ahead of `now`, else the newest post.
 * The two side cards are the newest other posts, preferring countries not yet featured. Needs at least 4 posts so the
 * list below is never empty; otherwise nothing is featured.
 */
export function pickFeatured<T extends BlogPost>(posts: readonly T[], now: Date): { lead: T; side: T[] } | null {
  if (posts.length < 4) return null;
  const sorted = [...posts].sort(byNewest);
  const upcoming = sorted.filter((p) => p.deadline && p.deadline.getTime() >= now.getTime()).sort((a, b) => a.deadline!.getTime() - b.deadline!.getTime());
  const lead = upcoming[0] ?? sorted[0];
  const rest = sorted.filter((p) => p !== lead);
  const side: T[] = [];
  const seen = new Set([lead.segment]);
  for (const p of rest) if (side.length < 2 && !seen.has(p.segment)) { side.push(p); seen.add(p.segment); }
  for (const p of rest) if (side.length < 2 && !side.includes(p)) side.push(p);
  return { lead, side };
}

/** The lead's badge text. Only a dated deadline from frontmatter that is still ahead produces one; otherwise null (the caller shows the topic). */
export function leadBadge(lead: Pick<BlogPost, 'deadline'>, now: Date): string | null {
  if (!lead.deadline || lead.deadline.getTime() < now.getTime()) return null;
  return `Deadline ${lead.deadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
}

export interface CountryChip { segment: string; name: string; n: number }
/** Chips: countries by post count (desc) then name. */
export function countryChips(posts: readonly { segment: string }[], nameOf: (seg: string) => string): CountryChip[] {
  const counts = new Map<string, number>();
  for (const p of posts) counts.set(p.segment, (counts.get(p.segment) ?? 0) + 1);
  return [...counts].map(([segment, n]) => ({ segment, name: nameOf(segment), n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}
