import { describe, expect, it } from 'vitest';
import { channelResult, channelResults, channelsLabel, facebookConnected, normalizeChannels, publishedChannels } from './channels';
import { checksPassed, runChecks } from './checks';
import type { SocialPost } from './types';

type R = Parameters<typeof channelResult>[0];
const post = (o: Partial<SocialPost> = {}): R => ({
  status: 'draft',
  channels: ['instagram'],
  ig_media_id: null,
  ig_permalink: null,
  published_at: null,
  last_error: null,
  fb_post_id: null,
  fb_permalink: null,
  fb_published_at: null,
  fb_last_error: null,
  ...o,
});

describe('normalizeChannels', () => {
  it('keeps known channels in canonical order without repeats', () => {
    expect(normalizeChannels(['facebook', 'instagram', 'facebook'])).toEqual(['instagram', 'facebook']);
    expect(normalizeChannels(['facebook'])).toEqual(['facebook']);
  });
  it('falls back to Instagram for empty, unknown or missing values', () => {
    expect(normalizeChannels([])).toEqual(['instagram']);
    expect(normalizeChannels(['tiktok'])).toEqual(['instagram']);
    expect(normalizeChannels(undefined)).toEqual(['instagram']);
    expect(normalizeChannels('facebook')).toEqual(['instagram']);
  });
  it('labels', () => expect(channelsLabel(['instagram', 'facebook'])).toBe('Instagram and Facebook'));
});

describe('facebookConnected', () => {
  it('needs both variables, non-blank', () => {
    expect(facebookConnected({ FB_PAGE_ID: '123', FB_PAGE_TOKEN: 'tok' })).toBe(true);
    expect(facebookConnected({ FB_PAGE_ID: '123' })).toBe(false);
    expect(facebookConnected({ FB_PAGE_TOKEN: 'tok' })).toBe(false);
    expect(facebookConnected({ FB_PAGE_ID: ' ', FB_PAGE_TOKEN: 'tok' })).toBe(false);
    expect(facebookConnected({})).toBe(false);
  });
});

describe('channelResult', () => {
  it('shows unselected channels as not selected', () => {
    expect(channelResult(post(), 'facebook').state).toBe('not_selected');
    expect(channelResult(post({ channels: ['facebook'] }), 'instagram').state).toBe('not_selected');
  });
  it('waits for draft, review and scheduled posts; publishing while publishing', () => {
    for (const status of ['draft', 'review', 'scheduled'] as const) expect(channelResult(post({ status }), 'instagram').state).toBe('waiting');
    expect(channelResult(post({ status: 'publishing' }), 'instagram').state).toBe('publishing');
  });
  it('is published with a permalink once the channel has an id', () => {
    const r = channelResult(
      post({ status: 'published', channels: ['instagram', 'facebook'], ig_media_id: 'm1', ig_permalink: 'https://instagram.com/p/x', published_at: 'T1', fb_post_id: 'f1', fb_permalink: 'https://facebook.com/f1', fb_published_at: 'T2' }),
      'facebook',
    );
    expect(r).toMatchObject({ state: 'published', permalink: 'https://facebook.com/f1', at: 'T2', error: null });
  });
  it('one channel can be published while the other failed', () => {
    const p = post({ status: 'failed', channels: ['instagram', 'facebook'], ig_media_id: 'm1', ig_permalink: 'https://instagram.com/p/x', last_error: 'ig err', fb_last_error: 'Token expired' });
    expect(channelResult(p, 'instagram').state).toBe('published');
    expect(channelResult(p, 'facebook')).toMatchObject({ state: 'failed', error: 'Token expired', permalink: null });
  });
  it('a failed Facebook falls back to the post-level error; Instagram uses last_error', () => {
    const p = post({ status: 'failed', channels: ['instagram', 'facebook'], last_error: 'Upload rejected' });
    expect(channelResult(p, 'facebook').error).toBe('Upload rejected');
    expect(channelResult(p, 'instagram')).toMatchObject({ state: 'failed', error: 'Upload rejected' });
  });
  it('an archived post that never went out is not posted; one that did stays published', () => {
    expect(channelResult(post({ status: 'archived' }), 'instagram').state).toBe('not_posted');
    expect(channelResult(post({ status: 'archived', ig_media_id: 'm1' }), 'instagram').state).toBe('published');
  });
  it('selectedOnly drops unselected channels', () => {
    expect(channelResults(post(), { selectedOnly: true }).map((r) => r.channel)).toEqual(['instagram']);
    expect(channelResults(post()).map((r) => r.channel)).toEqual(['instagram', 'facebook']);
  });
});

describe('publishedChannels', () => {
  it('lists channels that have an id', () => {
    expect(publishedChannels({ ig_media_id: 'a', fb_post_id: null })).toEqual(['instagram']);
    expect(publishedChannels({ ig_media_id: 'a', fb_post_id: 'b' })).toEqual(['instagram', 'facebook']);
    expect(publishedChannels({ ig_media_id: null, fb_post_id: null })).toEqual([]);
  });
});

describe('Story + Facebook check (live in the editor and on the server)', () => {
  const base = { caption: 'Hello', data_refs: [], numbers_confirmed: false, media: [{ kind: 'image' as const, mime: 'image/jpeg' as const, width: 1080, height: 1920, duration_s: null }] };
  it('is an error for a story with Facebook, fine for Instagram-only stories', () => {
    expect(checksPassed(runChecks({ ...base, type: 'story', channels: ['instagram', 'facebook'] }))).toBe(false);
    expect(checksPassed(runChecks({ ...base, type: 'story', channels: ['facebook'] }))).toBe(false);
    expect(checksPassed(runChecks({ ...base, type: 'story', channels: ['instagram'] }))).toBe(true);
    expect(checksPassed(runChecks({ ...base, type: 'story' }))).toBe(true);
  });
  it('an empty channel list is an error', () => {
    const r = runChecks({ ...base, type: 'story', channels: [] });
    expect(r.find((c) => c.key === 'channels')).toMatchObject({ ok: false, level: 'error' });
  });
});
