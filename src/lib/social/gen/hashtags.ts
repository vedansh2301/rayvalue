/**
 * Hashtag sets per channel. Tags are not figures, so they carry no data_refs.
 *
 * Instagram now ranks on captions and on-screen text as search keywords, and recommends a few relevant hashtags over
 * many broad ones. So: 3-5 tags, all on topic: the state's solar tag, #solarpanels (what homeowners search), the
 * utility's own tag (people search their utility), then #solarenergy to fill. Deliberately left out: anything that
 * implies a tax credit is available (#solartaxcredit, #taxcredit, #itc), follow/like bait and generic spam magnets.
 *
 * Facebook: hashtags do little there, so 2-3 readable CamelCase tags.
 */
import type { Channel } from '../types';

const IG_STATE: Record<'FL' | 'CA', string> = { FL: 'floridasolar', CA: 'californiasolar' };
/** By utility page slug (src/lib/utility/pages.ts). */
const IG_UTILITY: Record<string, string> = { fpl: 'fpl', 'duke-energy-florida': 'dukeenergy', teco: 'teco', pge: 'pge', sce: 'sce', sdge: 'sdge' };

const FB_STATE: Record<'FL' | 'CA', string> = { FL: 'FloridaSolar', CA: 'CaliforniaSolar' };
const FB_UTILITY: Record<string, string> = { fpl: 'FPL', 'duke-energy-florida': 'DukeEnergy', teco: 'TECO', pge: 'PGE', sce: 'SCE', sdge: 'SDGE' };

export const IG_HASHTAG_MIN = 3;
export const IG_HASHTAG_MAX = 5;

export interface HashtagInput {
  state: 'FL' | 'CA';
  /** Utility page slugs the post covers. */
  utilitySlugs: readonly string[];
}

/** Tags (without "#") for one channel, deduplicated. */
export function hashtagsFor(channel: Channel, h: HashtagInput): string[] {
  if (channel === 'facebook') {
    const util = h.utilitySlugs.length === 1 ? FB_UTILITY[h.utilitySlugs[0]!] : undefined;
    return [FB_STATE[h.state], util ?? 'Homeowners', 'SolarEnergy'];
  }
  const utilities = h.utilitySlugs.flatMap((s) => (IG_UTILITY[s] ? [IG_UTILITY[s]!] : []));
  return [...new Set([IG_STATE[h.state], 'solarpanels', ...utilities, 'solarenergy'])].slice(0, IG_HASHTAG_MAX);
}

export const hashtagLine = (tags: readonly string[]) => tags.map((t) => `#${t}`).join(' ');
