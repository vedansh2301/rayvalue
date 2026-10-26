import { describe, expect, it } from 'vitest';
import {
  isUploadPath,
  isUuid,
  newStoragePath,
  parseGenerateTarget,
  parseChannels,
  parseListFilters,
  parseLocalDateTime,
  parseMediaMeta,
  parseMediaRegistration,
  parsePostForm,
  parseSettingsForm,
  parseTemplateForm,
  publicUrlFor,
  resolveScheduleTarget,
  sanitizeSearch,
  toLocalInput,
  validateUploadRequest,
} from './forms';
import { buildMonthGrid, dayKey, formatBytes, insightKeys, insightSortParam, insightTotals, metricsOf, parseInsightSort, parseMonth, shiftMonth, sortByMetric, type CalendarPost } from './view';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const form = (pairs: [string, string][]) => new URLSearchParams(pairs);
const base = (extra: [string, string][] = []) => form([['action', 'save'], ['type', 'reel'], ['channels', 'instagram'], ['title', ' Hi '], ['caption', 'a\r\nb'], ...extra]);

describe('uploads', () => {
  it('accepts only jpeg, mp4, mov up to 50 MB', () => {
    expect(validateUploadRequest({ mime: 'video/mp4', bytes: 1000 }).ok).toBe(true);
    expect(validateUploadRequest({ mime: 'image/png', bytes: 1000 }).ok).toBe(false);
    expect(validateUploadRequest({ mime: 'image/heic', bytes: 1000 }).ok).toBe(false);
    expect(validateUploadRequest({ mime: 'video/mp4', bytes: 52428801 }).ok).toBe(false);
    expect(validateUploadRequest({ mime: 'video/mp4', bytes: 52428800 }).ok).toBe(true);
    expect(validateUploadRequest({ mime: 'video/mp4', bytes: 0 }).ok).toBe(false);
    expect(validateUploadRequest({ mime: 'video/mp4', bytes: 1.5 }).ok).toBe(false);
    expect(validateUploadRequest(null).ok).toBe(false);
  });
  it('builds uploads/YYYY/MM/<uuid>.<ext> paths that validate', () => {
    const p = newStoragePath(new Date('2026-11-03T12:00:00Z'), U1, 'video/quicktime');
    expect(p).toBe(`uploads/2026/11/${U1}.mov`);
    expect(isUploadPath(p)).toBe(true);
    expect(isUploadPath('uploads/2026/11/../../x.jpg')).toBe(false);
    expect(isUploadPath(`other/2026/11/${U1}.jpg`)).toBe(false);
    expect(isUploadPath(`uploads/2026/11/${U1}.png`)).toBe(false);
  });
  it('computes the public URL', () => expect(publicUrlFor('https://x.supabase.co/', 'uploads/a.jpg')).toBe('https://x.supabase.co/storage/v1/object/public/social/uploads/a.jpg'));
  it('registers media with rounded duration and nulls for bad measurements', () => {
    const r = parseMediaRegistration({ storage_path: `uploads/2026/11/${U1}.mp4`, mime: 'video/mp4', bytes: 5000, width: 1080, height: 1920.4, duration_s: 12.3456, alt_text: '  ', credit: 'Me' });
    expect(r).toEqual({ ok: true, value: { kind: 'video', storage_path: `uploads/2026/11/${U1}.mp4`, mime: 'video/mp4', bytes: 5000, width: 1080, height: 1920, duration_s: 12.35, alt_text: null, credit: 'Me', license: null, source: 'upload' } });
    const bad = parseMediaRegistration({ storage_path: `uploads/2026/11/${U1}.mp4`, mime: 'video/mp4', bytes: 5000, width: -1, height: 'x', duration_s: Infinity });
    expect(bad.ok && [bad.value.width, bad.value.height, bad.value.duration_s]).toEqual([null, null, null]);
  });
  it('rejects mismatched type/extension and over-long text', () => {
    expect(parseMediaRegistration({ storage_path: `uploads/2026/11/${U1}.jpg`, mime: 'video/mp4', bytes: 5 }).ok).toBe(false);
    expect(parseMediaRegistration({ storage_path: `uploads/2026/11/${U1}.jpg`, mime: 'image/jpeg', bytes: 5, license: 'x'.repeat(121) }).ok).toBe(false);
  });
  it('parses media meta edits', () => {
    expect(parseMediaMeta(form([['id', U1], ['alt_text', ' a '], ['credit', ''], ['license', 'CC0']]))).toEqual({ ok: true, value: { id: U1, alt_text: 'a', credit: null, license: 'CC0' } });
    expect(parseMediaMeta(form([['id', 'nope']])).ok).toBe(false);
    expect(parseMediaMeta(form([['id', U1], ['credit', 'x'.repeat(301)]])).ok).toBe(false);
  });
});

describe('post form', () => {
  it('normalizes line endings, trims the title, keeps media order', () => {
    const r = parsePostForm(base([['media_ids', U2], ['media_ids', U1], ['thumb_offset_ms', '1500'], ['share_to_feed', 'on']]));
    expect(r.ok && r.value).toMatchObject({ title: 'Hi', caption: 'a\nb', media_ids: [U2, U1], thumb_offset_ms: 1500, share_to_feed: true, numbers_confirmed: false, when: 'none' });
  });
  it('only reels keep cover offset and share_to_feed=false', () => {
    const r = parsePostForm(form([['action', 'save'], ['type', 'image'], ['channels', 'instagram'], ['thumb_offset_ms', '900']]));
    expect(r.ok && [r.value.thumb_offset_ms, r.value.share_to_feed]).toEqual([null, true]);
    const reel = parsePostForm(base());
    expect(reel.ok && reel.value.share_to_feed).toBe(false);
  });
  it('rejects bad enums, ids, lengths and offsets', () => {
    expect(parsePostForm(form([['action', 'x'], ['type', 'reel']])).ok).toBe(false);
    expect(parsePostForm(form([['action', 'save'], ['type', 'gif']])).ok).toBe(false);
    expect(parsePostForm(base([['media_ids', 'zzz']])).ok).toBe(false);
    expect(parsePostForm(base([['media_ids', U1], ['media_ids', U1]])).ok).toBe(false);
    expect(parsePostForm(form([['action', 'save'], ['type', 'reel'], ['channels', 'instagram'], ['title', 'x'.repeat(121)]])).ok).toBe(false);
    expect(parsePostForm(form([['action', 'save'], ['type', 'reel'], ['channels', 'instagram'], ['caption', 'x'.repeat(2201)]])).ok).toBe(false);
    expect(parsePostForm(base([['thumb_offset_ms', '-5']])).ok).toBe(false);
    expect(parsePostForm(base([['thumb_offset_ms', '1.5']])).ok).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => ['media_ids', `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`] as [string, string]);
    expect(parsePostForm(base(eleven)).ok).toBe(false);
  });
  it('publish_now forces the now mode; unknown when falls back to none', () => {
    const a = parsePostForm(form([['action', 'publish_now'], ['type', 'reel'], ['channels', 'instagram'], ['when', 'custom']]));
    expect(a.ok && a.value.when).toBe('now');
    const b = parsePostForm(base([['when', 'weird']]));
    expect(b.ok && b.value.when).toBe('none');
  });
  it('reads the channel checkboxes: any non-empty subset, canonical order, no repeats', () => {
    const both = parsePostForm(base([['channels', 'facebook'], ['channels', 'instagram']]));
    expect(both.ok && both.value.channels).toEqual(['instagram', 'facebook']);
    const fb = parsePostForm(form([['action', 'save'], ['type', 'image'], ['channels', 'facebook']]));
    expect(fb.ok && fb.value.channels).toEqual(['facebook']);
    const dup = parsePostForm(form([['action', 'save'], ['type', 'image'], ['channels', 'facebook'], ['channels', 'facebook']]));
    expect(dup.ok && dup.value.channels).toEqual(['facebook']);
  });
  it('rejects no channel and unknown channels, and keeps other errors alongside', () => {
    const none = parsePostForm(form([['action', 'save'], ['type', 'reel']]));
    expect(none).toEqual({ ok: false, errors: ['Pick at least one channel to post to.'] });
    expect(parsePostForm(base([['channels', 'tiktok']])).ok).toBe(false);
    expect(parsePostForm(form([['action', 'save'], ['type', 'reel'], ['channels', '']])).ok).toBe(false);
    const both = parsePostForm(form([['action', 'save'], ['type', 'gif']]));
    expect(both.ok === false && both.errors).toHaveLength(2);
  });
  it('collects alt text only for selected media', () => {
    const r = parsePostForm(base([['media_ids', U1], [`alt_${U1}`, ' A roof '], [`alt_${U2}`, 'ignored']]));
    expect(r.ok && r.value.alt_text).toEqual({ [U1]: 'A roof' });
  });
});

describe('time helpers', () => {
  it('reads datetime-local values in the settings zone (DST aware)', () => {
    expect(parseLocalDateTime('2026-11-03T18:00', 'America/New_York')?.toISOString()).toBe('2026-11-03T23:00:00.000Z');
    expect(parseLocalDateTime('2026-07-03T18:00', 'America/Los_Angeles')?.toISOString()).toBe('2026-07-04T01:00:00.000Z');
    expect(parseLocalDateTime('2026-02-30T18:00', 'America/New_York')).toBeNull();
    expect(parseLocalDateTime('garbage', 'America/New_York')).toBeNull();
    expect(parseLocalDateTime('2026-11-03 18:00', 'America/New_York')).toBeNull();
  });
  it('round-trips through toLocalInput', () => {
    const d = parseLocalDateTime('2026-11-03T18:00', 'America/New_York')!;
    expect(toLocalInput(d.toISOString(), 'America/New_York')).toBe('2026-11-03T18:00');
    expect(toLocalInput('2026-01-01T00:00:00Z', 'America/Los_Angeles')).toBe('2025-12-31T16:00');
  });
});

describe('resolveScheduleTarget', () => {
  it('passing checks schedule from any editable state', () => {
    for (const from of ['draft', 'review', 'failed', 'scheduled'] as const) expect(resolveScheduleTarget(from, true, true)).toBe('scheduled');
  });
  it('the owner scheduling by hand wins over auto_publish off', () => expect(resolveScheduleTarget('draft', true, false)).toBe('scheduled'));
  it('failing checks go to review, or draft when already scheduled', () => {
    expect(resolveScheduleTarget('draft', false, true)).toBe('review');
    expect(resolveScheduleTarget('review', false, true)).toBe('review');
    expect(resolveScheduleTarget('scheduled', false, true)).toBe('draft');
  });
  it('published and publishing posts cannot be scheduled', () => {
    expect(resolveScheduleTarget('published', true, true)).toBeNull();
    expect(resolveScheduleTarget('publishing', true, true)).toBeNull();
  });
});

describe('list filters', () => {
  it('keeps valid status/type and strips filter syntax from search', () => {
    expect(parseListFilters(new URLSearchParams('status=failed&type=reel&q=a,b)(*%'))).toEqual({ status: 'failed', type: 'reel', channel: null, q: 'a b' });
    expect(parseListFilters(new URLSearchParams('status=zzz&type=x&channel=tiktok'))).toEqual({ status: null, type: null, channel: null, q: '' });
    expect(parseListFilters(new URLSearchParams('channel=facebook')).channel).toBe('facebook');
    expect(sanitizeSearch('x'.repeat(200))).toHaveLength(80);
  });
});

describe('settings form', () => {
  const slots = JSON.stringify([{ dow: 3, time: '18:00', type: 'reel' }, { dow: 1, time: '12:00', type: 'carousel' }]);
  it('parses, sorts slots and reads checkboxes', () => {
    const r = parseSettingsForm(form([['timezone', 'America/Los_Angeles'], ['auto_publish', 'on'], ['default_channels', 'instagram'], ['slots', slots]]));
    expect(r).toEqual({ ok: true, value: { default_channels: ['instagram'], auto_publish: true, paused: false, notify_email: false, timezone: 'America/Los_Angeles', slots: [{ dow: 1, time: '12:00', type: 'carousel' }, { dow: 3, time: '18:00', type: 'reel' }] } });
  });
  it('rejects unknown zones, bad slots and duplicates', () => {
    expect(parseSettingsForm(form([['timezone', 'Europe/London'], ['default_channels', 'instagram'], ['slots', '[]']])).ok).toBe(false);
    expect(parseSettingsForm(form([['timezone', 'America/New_York'], ['default_channels', 'instagram'], ['slots', '[{"dow":9,"time":"18:00","type":"reel"}]']])).ok).toBe(false);
    expect(parseSettingsForm(form([['timezone', 'America/New_York'], ['default_channels', 'instagram'], ['slots', '[{"dow":1,"time":"25:00","type":"reel"}]']])).ok).toBe(false);
    expect(parseSettingsForm(form([['timezone', 'America/New_York'], ['default_channels', 'instagram'], ['slots', '{not json']])).ok).toBe(false);
    const dup = JSON.stringify([{ dow: 1, time: '12:00', type: 'reel' }, { dow: 1, time: '12:00', type: 'reel' }]);
    expect(parseSettingsForm(form([['timezone', 'America/New_York'], ['default_channels', 'instagram'], ['slots', dup]])).ok).toBe(false);
  });
  it('reads default channels and requires at least one', () => {
    const both = parseSettingsForm(form([['timezone', 'America/New_York'], ['default_channels', 'facebook'], ['default_channels', 'instagram'], ['slots', '[]']]));
    expect(both.ok && both.value.default_channels).toEqual(['instagram', 'facebook']);
    expect(parseSettingsForm(form([['timezone', 'America/New_York'], ['slots', '[]']]))).toEqual({ ok: false, errors: ['Pick at least one default channel.'] });
    expect(parseSettingsForm(form([['timezone', 'America/New_York'], ['default_channels', 'myspace'], ['slots', '[]']])).ok).toBe(false);
  });
  it('allows no slots at all', () => expect(parseSettingsForm(form([['timezone', 'America/New_York'], ['default_channels', 'instagram'], ['slots', '[]']])).ok).toBe(true));
});

describe('template form', () => {
  it('validates kind and lengths', () => {
    expect(parseTemplateForm(form([['kind', 'hashtags'], ['name', ' Base '], ['body', '#solar #florida']]))).toEqual({ ok: true, value: { kind: 'hashtags', name: 'Base', body: '#solar #florida' } });
    expect(parseTemplateForm(form([['kind', 'x'], ['name', 'a'], ['body', 'b']])).ok).toBe(false);
    expect(parseTemplateForm(form([['kind', 'caption'], ['name', ''], ['body', 'b']])).ok).toBe(false);
    expect(parseTemplateForm(form([['kind', 'caption'], ['name', 'a'], ['body', ' ']])).ok).toBe(false);
    expect(parseTemplateForm(form([['kind', 'caption'], ['name', 'a'.repeat(81)], ['body', 'b']])).ok).toBe(false);
  });
});

describe('generate target', () => {
  it('checks the target against the template kind', () => {
    expect(parseGenerateTarget('utility', 'fpl', ['fpl', 'pge'])).toEqual({ ok: true, value: 'fpl' });
    expect(parseGenerateTarget('utility', 'nope', ['fpl']).ok).toBe(false);
    expect(parseGenerateTarget('state', 'ca', [])).toEqual({ ok: true, value: 'ca' });
    expect(parseGenerateTarget('state', 'ny', []).ok).toBe(false);
    expect(parseGenerateTarget('none', 'whatever', [])).toEqual({ ok: true, value: '' });
  });
});

describe('uuid', () => it('validates', () => {
  expect(isUuid(U1)).toBe(true);
  expect(isUuid('1')).toBe(false);
  expect(isUuid(undefined)).toBe(false);
}));

describe('calendar', () => {
  const post = (over: Partial<CalendarPost>): CalendarPost => ({ id: U1, title: 't', type: 'reel', status: 'scheduled', scheduled_at: '2026-11-03T23:00:00Z', published_at: null, ...over });
  it('parses and shifts months', () => {
    expect(parseMonth('2026-11', new Date('2026-01-01T12:00:00Z'), 'America/New_York')).toBe('2026-11');
    expect(parseMonth('2026-13', new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe('2026-01');
    expect(parseMonth(null, new Date('2026-02-01T02:00:00Z'), 'America/New_York')).toBe('2026-01');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
  it('lays out whole Sunday-first weeks and places posts on their day in the zone', () => {
    const grid = buildMonthGrid('2026-11', 'America/New_York', [
      post({}),
      post({ id: U2, status: 'published', scheduled_at: '2026-11-04T01:00:00Z', published_at: '2026-11-30T03:00:00Z' }),
      post({ status: 'archived' }),
    ]);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0]![0]!.date).toBe('2026-11-01'); // Nov 1 2026 is a Sunday
    expect(grid).toHaveLength(5);
    const cells = grid.flat();
    expect(cells.find((c) => c.date === '2026-11-03')!.posts).toHaveLength(1);
    expect(cells.find((c) => c.date === '2026-11-29')!.posts.map((p) => p.post.id)).toEqual([U2]); // published uses published_at, 03:00Z is Nov 29 ET
    expect(cells.flatMap((c) => c.posts)).toHaveLength(2); // archived left off
  });
  it('shows adjacent-month days as out of month', () => {
    const grid = buildMonthGrid('2026-10', 'America/New_York', []);
    expect(grid[0]![0]!.inMonth).toBe(false);
    expect(grid[0]![4]!.date).toBe('2026-10-01');
    expect(grid[0]![4]!.inMonth).toBe(true);
  });
  it('dayKey follows the zone', () => expect(dayKey('2026-11-04T03:00:00Z', 'America/Los_Angeles')).toBe('2026-11-03'));
});

describe('insights', () => {
  const posts: { id: string; insights: Record<string, number> | null }[] = [
    { id: 'a', insights: { reach: 100, likes: 5 } },
    { id: 'b', insights: { reach: 300 } },
    { id: 'c', insights: null },
  ];
  it('lists keys, totals and sorts with missing last', () => {
    expect(insightKeys(posts)).toEqual(['likes', 'reach']);
    expect(insightTotals(posts)).toEqual({ reach: 400, likes: 5 });
    expect(sortByMetric(posts, 'reach').map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(sortByMetric(posts, 'likes').map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(sortByMetric(posts, null).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('facebook insights', () => {
  type P = { id: string; insights: Record<string, number> | null; fb_insights: Record<string, number> | null };
  const posts: P[] = [
    { id: 'a', insights: { reach: 100 }, fb_insights: { reach: 40, clicks: 3 } },
    { id: 'b', insights: { reach: 300 }, fb_insights: null },
    { id: 'c', insights: null, fb_insights: { reach: 90 } },
  ];
  it('keeps Instagram and Facebook metrics apart', () => {
    expect(metricsOf(posts[0]!, 'facebook')).toEqual({ reach: 40, clicks: 3 });
    expect(metricsOf(posts[0]!)).toEqual({ reach: 100 });
    expect(insightKeys(posts, 'facebook')).toEqual(['clicks', 'reach']);
    expect(insightKeys(posts)).toEqual(['reach']);
    expect(insightTotals(posts, 'facebook')).toEqual({ reach: 130, clicks: 3 });
    expect(insightTotals(posts)).toEqual({ reach: 400 });
    expect(sortByMetric(posts, 'reach', 'facebook').map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });
  it('reads the sort parameter for either channel and ignores unknown columns', () => {
    expect(parseInsightSort('reach', ['reach'], ['clicks'])).toEqual({ channel: 'instagram', key: 'reach' });
    expect(parseInsightSort('fb:clicks', ['reach'], ['clicks'])).toEqual({ channel: 'facebook', key: 'clicks' });
    expect(parseInsightSort('clicks', ['reach'], ['clicks'])).toBeNull();
    expect(parseInsightSort('fb:reach', ['reach'], ['clicks'])).toBeNull();
    expect(parseInsightSort(null, [], [])).toBeNull();
    expect(insightSortParam('facebook', 'clicks')).toBe('fb:clicks');
    expect(insightSortParam('instagram', 'reach')).toBe('reach');
  });
});

describe('channel checkbox parsing', () => {
  it('accepts a non-empty known subset', () => {
    expect(parseChannels(['facebook'])).toEqual({ ok: true, value: ['facebook'] });
    expect(parseChannels(['facebook', 'instagram', 'facebook'])).toEqual({ ok: true, value: ['instagram', 'facebook'] });
  });
  it('rejects empty and unknown', () => {
    expect(parseChannels([]).ok).toBe(false);
    expect(parseChannels(['instagram', 'x']).ok).toBe(false);
    expect(parseChannels([], 'Custom.')).toEqual({ ok: false, errors: ['Custom.'] });
  });
});

describe('formatBytes', () => it('formats', () => {
  expect(formatBytes(null)).toBe('unknown size');
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(2048)).toBe('2 KB');
  expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
}));
