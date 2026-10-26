import { describe, expect, it } from 'vitest';
import { captionNumbers, checksPassed, countHashtags, creditClaims, officialWording, runChecks, untracedNumbers, type MediaForCheck, type PostForCheck } from './checks';
import { duePosts, isValidSlot, nextFreeSlot, upcomingSlots, zonedToUtc } from './schedule';
import { canTransition, statusOnSchedule } from './status';

const reel: MediaForCheck = { kind: 'video', mime: 'video/mp4', width: 1080, height: 1920, duration_s: 20 };
const jpg: MediaForCheck = { kind: 'image', mime: 'image/jpeg', width: 1080, height: 1350, duration_s: null };
const post = (over: Partial<PostForCheck> = {}): PostForCheck => ({ type: 'reel', caption: 'See your payback.', data_refs: [], numbers_confirmed: false, media: [reel], ...over });
const failed = (p: PostForCheck) => runChecks(p).filter((r) => !r.ok).map((r) => r.key);

describe('rule 2: federal credit', () => {
  it('flags any sentence presenting the credit as available', () => {
    expect(creditClaims('Get the 30% federal tax credit today!')).toHaveLength(1);
    expect(creditClaims('Claim your solar tax credit.')).toHaveLength(1);
    expect(creditClaims('Use the ITC to cut costs.')).toHaveLength(1);
  });
  it('allows sentences that say it is gone', () => {
    expect(creditClaims('The federal tax credit ended for 2026 installs.')).toEqual([]);
    expect(creditClaims('Solar without the tax credit: here is the real math. The 25D credit is $0 now.')).toEqual([]);
  });
});

describe('rule 5: official wording', () => {
  it('flags official/government phrasing', () => {
    expect(officialWording('The official FPL calculator')).toEqual(['official']);
    expect(officialWording('A government-approved program, see energy.gov')).toEqual(['government-approved', '.gov']);
    expect(officialWording('Independent calculator')).toEqual([]);
  });
});

describe('rule 1: numbers trace to data', () => {
  it('extracts reader-visible numbers, skipping years, hashtags, handles, URLs and NEM 3.0', () => {
    expect(captionNumbers('In 2026 a $24,000 system pays back in 9–12 years (NEM 3.0) #solar2026 @fpl rayvalue.com/calculator/florida 35%')).toEqual(['24000', '9', '12', '35']);
  });
  it('matches against data_refs values, including ranges', () => {
    const refs = [{ table: 'utilities', id: 'fpl', field: 'payback_years', value: '9–12 years' }];
    expect(untracedNumbers('Payback 9 to 12 years, maybe 15.', refs)).toEqual(['15']);
  });
  it('blocks untraced numbers unless the owner confirmed them', () => {
    expect(failed(post({ caption: 'Save $40 a month' }))).toEqual(['numbers_traced']);
    expect(failed(post({ caption: 'Save $40 a month', numbers_confirmed: true }))).toEqual([]);
  });
});

describe('limits and media', () => {
  it('counts hashtags and enforces the cap', () => {
    expect(countHashtags('#a #b c#d &#39;')).toBe(2);
    expect(failed(post({ caption: Array.from({ length: 31 }, (_, i) => `#t${'x'.repeat(i)}`).join(' ') }))).toContain('hashtags');
  });
  it('checks media count, format, duration and photo aspect', () => {
    expect(failed(post({ media: [] }))).toEqual(['media_count']);
    expect(failed(post({ type: 'image', media: [{ ...jpg, mime: 'video/mp4' }] }))).toContain('media_format');
    expect(failed(post({ media: [{ ...reel, duration_s: 2 }] }))).toEqual(['duration_0']);
    expect(failed(post({ media: [{ ...reel, duration_s: null }] }))).toEqual(['duration_0']);
    expect(failed(post({ type: 'image', media: [{ ...jpg, width: 1000, height: 2000 }] }))).toEqual(['aspect_0']);
    expect(failed(post({ type: 'carousel', media: [jpg, jpg] }))).toEqual([]);
    expect(failed(post({ type: 'carousel', media: [jpg] }))).toEqual(['media_count']);
  });
  it('treats a non-9:16 Reel as a warning only', () => {
    const r = runChecks(post({ media: [{ ...reel, width: 1080, height: 1080 }] }));
    expect(r.find((c) => c.key === 'aspect_0')).toMatchObject({ ok: false, level: 'warn' });
    expect(checksPassed(r)).toBe(true);
  });
});

describe('channels', () => {
  it('blocks Facebook Stories and empty channel lists', () => {
    expect(failed(post({ type: 'story', channels: ['instagram', 'facebook'] }))).toEqual(['channels']);
    expect(failed(post({ channels: [] }))).toEqual(['channels']);
    expect(failed(post({ channels: ['instagram', 'facebook'] }))).toEqual([]);
  });
});

describe('status', () => {
  it('allows only listed moves', () => {
    expect(canTransition('draft', 'scheduled')).toBe(true);
    expect(canTransition('published', 'scheduled')).toBe(false);
    expect(canTransition('publishing', 'draft')).toBe(false);
  });
  it('routes failing posts to review and passing ones by auto-publish', () => {
    expect(statusOnSchedule({ checksPassed: false, autoPublish: true, byOwner: true })).toBe('review');
    expect(statusOnSchedule({ checksPassed: true, autoPublish: true, byOwner: false })).toBe('scheduled');
    expect(statusOnSchedule({ checksPassed: true, autoPublish: false, byOwner: false })).toBe('review');
    expect(statusOnSchedule({ checksPassed: true, autoPublish: false, byOwner: true })).toBe('scheduled');
  });
});

describe('schedule', () => {
  const tz = 'America/New_York';
  it('converts wall-clock time to UTC across DST', () => {
    expect(zonedToUtc(2026, 7, 1, 18, 0, tz).toISOString()).toBe('2026-07-01T22:00:00.000Z'); // EDT
    expect(zonedToUtc(2026, 12, 1, 18, 0, tz).toISOString()).toBe('2026-12-01T23:00:00.000Z'); // EST
  });
  it('finds the next free slot of a type', () => {
    const slots = [{ dow: 1, time: '18:00', type: 'reel' as const }, { dow: 3, time: '18:00', type: 'reel' as const }, { dow: 2, time: '12:00', type: 'carousel' as const }];
    const from = new Date('2026-10-26T12:00:00Z'); // Monday 08:00 EDT
    expect(upcomingSlots(slots, 'reel', tz, from, 7).map((d) => d.toISOString())).toEqual(['2026-10-26T22:00:00.000Z', '2026-10-28T22:00:00.000Z']);
    expect(nextFreeSlot(slots, 'reel', tz, ['2026-10-26T22:00:00.000Z'], from)?.toISOString()).toBe('2026-10-28T22:00:00.000Z');
    expect(nextFreeSlot(slots, 'carousel', tz, [], from)?.toISOString()).toBe('2026-10-27T16:00:00.000Z');
  });
  it('validates slots', () => {
    expect(isValidSlot({ dow: 1, time: '18:00', type: 'reel' })).toBe(true);
    expect(isValidSlot({ dow: 7, time: '18:00', type: 'reel' })).toBe(false);
    expect(isValidSlot({ dow: 1, time: '25:00', type: 'reel' })).toBe(false);
  });
  it('picks due and in-flight posts oldest first', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    const posts = [
      { id: 'a', status: 'scheduled' as const, scheduled_at: '2026-10-26T13:00:00Z' },
      { id: 'b', status: 'scheduled' as const, scheduled_at: '2026-10-26T11:00:00Z' },
      { id: 'c', status: 'publishing' as const, scheduled_at: '2026-10-26T10:00:00Z' },
      { id: 'd', status: 'draft' as const, scheduled_at: '2026-10-26T09:00:00Z' },
    ];
    expect(duePosts(posts, now).map((p) => p.id)).toEqual(['c', 'b']);
  });
});
