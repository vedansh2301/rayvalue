/**
 * Posting channels (pure): which channels a post goes to, what each channel's result is, and whether the Facebook Page
 * is connected. Shared by /admin/social, the generator and the admin pages' status display.
 */
import { CHANNELS, type Channel, type PostStatus, type SocialPost } from './types';

export const CHANNEL_LABEL: Record<Channel, string> = { instagram: 'Instagram', facebook: 'Facebook' };
export const DEFAULT_CHANNELS: readonly Channel[] = ['instagram'];

export const isChannel = (v: unknown): v is Channel => typeof v === 'string' && (CHANNELS as readonly string[]).includes(v);

/**
 * Whatever came out of the database or a form, as a clean channel list: only known channels, no repeats, canonical
 * order. An empty or unreadable value falls back to Instagram only (the pre-Facebook behaviour).
 */
export function normalizeChannels(raw: unknown): Channel[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  const out = CHANNELS.filter((c) => list.includes(c));
  return out.length ? out : [...DEFAULT_CHANNELS];
}

/** "Instagram", "Instagram and Facebook". */
export const channelsLabel = (channels: readonly Channel[]) => channels.map((c) => CHANNEL_LABEL[c]).join(' and ');

/** The Page is connected when both environment variables are set. Values are never read out or shown. */
export const facebookConnected = (env: { FB_PAGE_ID?: string; FB_PAGE_TOKEN?: string }): boolean => Boolean(env.FB_PAGE_ID?.trim() && env.FB_PAGE_TOKEN?.trim());

/** Channels that already published for this post and so cannot be taken off it. */
export function publishedChannels(post: Pick<SocialPost, 'ig_media_id' | 'fb_post_id'>): Channel[] {
  return [...(post.ig_media_id ? (['instagram'] as const) : []), ...(post.fb_post_id ? (['facebook'] as const) : [])];
}

export type ChannelState = 'published' | 'publishing' | 'waiting' | 'failed' | 'not_posted' | 'not_selected';

export interface ChannelResult {
  channel: Channel;
  label: string;
  state: ChannelState;
  /** Short text for the state, e.g. "Published". */
  text: string;
  permalink: string | null;
  error: string | null;
  at: string | null;
}

const STATE_TEXT: Record<ChannelState, string> = {
  published: 'Published',
  publishing: 'Publishing',
  waiting: 'Waiting',
  failed: 'Failed',
  not_posted: 'Not posted',
  not_selected: 'Not selected',
};

/** Tailwind classes for a channel state chip. */
export const CHANNEL_CHIP: Record<ChannelState, string> = {
  published: 'border-green-400 bg-green-100 text-green-900',
  publishing: 'border-indigo-300 bg-indigo-100 text-indigo-900',
  waiting: 'border-sky-300 bg-sky-100 text-sky-900',
  failed: 'border-red-400 bg-red-100 text-red-900',
  not_posted: 'border-stone-300 bg-white text-stone-700',
  not_selected: 'border-stone-300 bg-stone-50 text-stone-700',
};

type ResultPost = Pick<
  SocialPost,
  'status' | 'channels' | 'ig_media_id' | 'ig_permalink' | 'published_at' | 'last_error' | 'fb_post_id' | 'fb_permalink' | 'fb_published_at' | 'fb_last_error'
>;

/** One channel's result for a post. */
export function channelResult(post: ResultPost, channel: Channel): ChannelResult {
  const selected = normalizeChannels(post.channels).includes(channel);
  const fb = channel === 'facebook';
  const id = fb ? post.fb_post_id : post.ig_media_id;
  const permalink = (fb ? post.fb_permalink : post.ig_permalink) ?? null;
  const at = (fb ? post.fb_published_at : post.published_at) ?? null;
  const error = (fb ? (post.fb_last_error ?? post.last_error) : post.last_error) ?? null;
  const done = (state: ChannelState): ChannelResult => ({
    channel,
    label: CHANNEL_LABEL[channel],
    state,
    text: STATE_TEXT[state],
    permalink: state === 'published' ? permalink : null,
    error: state === 'failed' ? error : null,
    at: state === 'published' ? at : null,
  });
  // A post that went out on a channel stays published there, even if it was later archived.
  if (id) return done('published');
  if (!selected) return done('not_selected');
  const s: PostStatus = post.status;
  if (s === 'failed') return done('failed');
  if (s === 'publishing') return done('publishing');
  if (s === 'archived' || s === 'published') return done('not_posted');
  return done('waiting');
}

/** Results for every channel (editor), or only the selected ones (list). */
export function channelResults(post: ResultPost, opts: { selectedOnly?: boolean } = {}): ChannelResult[] {
  const all = CHANNELS.map((c) => channelResult(post, c));
  return opts.selectedOnly ? all.filter((r) => r.state !== 'not_selected') : all;
}
