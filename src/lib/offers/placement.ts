/**
 * Where affiliate offers appear: ONE place to tune it. Offers are display-only and never feed the calculator
 * (the 50/30/20 editorial stance: the numbers come first, offers sit beside them).
 */
import type { OfferCategory } from './offers';

export type PlacementKind = 'guide' | 'blog' | 'results';

export interface PlacementContext {
  kind: PlacementKind;
  /** Content id (slug) for guides/blog; the state for results pages. */
  id: string;
  tags?: readonly string[];
  topic?: string;
  /** ISO2 lowercase country of the page (default 'us'); offers are filtered to this country. */
  country?: string;
}

export interface Placement {
  show: boolean;
  categories: readonly OfferCategory[];
  /** Max offers on one page. */
  max: number;
}

/** Tuning knobs. */
export const PLACEMENT_CONFIG = {
  /** Offer categories shown on battery-relevant pages. */
  categories: ['battery', 'portable_power'] as readonly OfferCategory[],
  max: 3,
  /** A page is battery-relevant when it has one of these tags, topic 'battery', or an id containing one of these words. */
  batteryTags: ['batteries', 'battery', 'backup-power', 'backup'] as readonly string[],
  batteryIdWords: ['battery', 'batteries', 'backup'] as readonly string[],
  /** Content ids that are battery-relevant for editorial reasons even without a matching tag/word. */
  extraIds: [] as readonly string[],
  /** Results pages (calculator): which states discuss a battery on the page. */
  resultsStates: ['FL', 'CA'] as readonly string[],
};

const NONE: Placement = { show: false, categories: [], max: 0 };

export function batteryRelevant(ctx: PlacementContext, cfg = PLACEMENT_CONFIG): boolean {
  if (ctx.kind === 'results') return cfg.resultsStates.includes(ctx.id);
  if (cfg.extraIds.includes(ctx.id)) return true;
  if (ctx.topic === 'battery') return true;
  if ((ctx.tags ?? []).some((t) => cfg.batteryTags.includes(t.toLowerCase()))) return true;
  return cfg.batteryIdWords.some((w) => ctx.id.toLowerCase().includes(w));
}

export function placementFor(ctx: PlacementContext, cfg = PLACEMENT_CONFIG): Placement {
  return batteryRelevant(ctx, cfg) ? { show: true, categories: cfg.categories, max: cfg.max } : NONE;
}
