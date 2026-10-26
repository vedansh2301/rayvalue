/**
 * Hashtag sets per channel. Tags are not figures, so they carry no data_refs.
 *
 * Instagram (12-18 tags, at the end of the caption): broad solar tags for discovery; homeowner and money tags because
 * the audience is people paying an electric bill, not the solar trade; state tags; the utility's own tag (people
 * search their utility); and the worked example's city when the data has one. Deliberately left out: anything that
 * implies a tax credit is available (#solartaxcredit, #taxcredit, #itc), follow/like bait (#followforfollow,
 * #like4like) and generic spam magnets (#money, #free).
 *
 * Facebook: hashtags do little there, so 2-3 readable CamelCase tags.
 */
import type { Channel } from '../types';

const IG_BROAD = ['solar', 'solarenergy', 'solarpanels', 'solarpower', 'renewableenergy', 'cleanenergy'];
const IG_HOMEOWNER = ['homeowner', 'homeownership', 'energybill', 'electricbill', 'savemoney'];
const IG_STATE: Record<'FL' | 'CA', string[]> = {
  FL: ['floridasolar', 'floridahomeowner', 'floridahomes'],
  CA: ['californiasolar', 'californiahomeowner', 'californiahomes'],
};
/** By utility page slug (src/lib/utility/pages.ts). */
const IG_UTILITY: Record<string, string> = { fpl: 'fpl', 'duke-energy-florida': 'dukeenergy', teco: 'teco', pge: 'pge', sce: 'sce', sdge: 'sdge' };

const FB_STATE: Record<'FL' | 'CA', string> = { FL: 'FloridaSolar', CA: 'CaliforniaSolar' };
const FB_UTILITY: Record<string, string> = { fpl: 'FPL', 'duke-energy-florida': 'DukeEnergy', teco: 'TECO', pge: 'PGE', sce: 'SCE', sdge: 'SDGE' };

export const IG_HASHTAG_MAX = 18;

export interface HashtagInput {
  state: 'FL' | 'CA';
  /** Utility page slugs the post covers. */
  utilitySlugs: readonly string[];
  /** The worked example's city, when there is one. */
  city?: string | null;
}

/** "St. Petersburg" -> "stpetersburg". */
export const hashtagWord = (s: string) =>
  s
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Tags (without "#") for one channel, deduplicated. */
export function hashtagsFor(channel: Channel, h: HashtagInput): string[] {
  if (channel === 'facebook') {
    const util = h.utilitySlugs.length === 1 ? FB_UTILITY[h.utilitySlugs[0]!] : undefined;
    return [FB_STATE[h.state], util ?? 'Homeowners', 'SolarEnergy'];
  }
  const city = h.city ? hashtagWord(h.city) : '';
  const tags = [
    ...IG_BROAD,
    ...IG_HOMEOWNER,
    ...IG_STATE[h.state],
    ...h.utilitySlugs.flatMap((s) => (IG_UTILITY[s] ? [IG_UTILITY[s]!] : [])),
    ...(/^[a-z]/.test(city) ? [city] : []),
  ];
  return [...new Set(tags)].slice(0, IG_HASHTAG_MAX);
}

export const hashtagLine = (tags: readonly string[]) => tags.map((t) => `#${t}`).join(' ');
