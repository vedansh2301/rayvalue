import { describe, expect, it } from 'vitest';
import { createFacebookClient, isPlaceRejection, FbError } from './facebook';
import { parsePostForm } from './forms';
import { carouselParentParams, containerParams, createInstagramClient, IgError, isLocationRejection } from './instagram';
import { isLocationKey, locationKeyForTarget } from './locations';

interface Call {
  method: string;
  url: URL;
  form: Record<string, string>;
}
function fake(respond: (c: Call, n: number) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', url: new URL(String(input)), form: Object.fromEntries(new URLSearchParams(String(init?.body ?? ''))) };
    calls.push(c);
    const r = respond(c, calls.length);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}
const INVALID_LOCATION = { status: 400, json: { error: { message: 'Invalid parameter', code: 100, error_subcode: 2207019 } } };

// Rows as seeded by supabase/migrations/0017_social_locations.sql (ids are not needed by the mapping, only their presence).
const ROWS = [
  { key: 'miami-fl', targets: ['fpl'], fb_place_id: '1' },
  { key: 'orlando-fl', targets: ['duke-energy-florida'], fb_place_id: '2' },
  { key: 'tampa-fl', targets: ['teco'], fb_place_id: '3' },
  { key: 'florida', targets: ['fl'], fb_place_id: '4' },
  { key: 'san-francisco-ca', targets: ['pge'], fb_place_id: '5' },
  { key: 'los-angeles-ca', targets: ['sce'], fb_place_id: '6' },
  { key: 'san-diego-ca', targets: ['sdge'], fb_place_id: '7' },
  { key: 'california', targets: ['ca'], fb_place_id: '8' },
];

describe('generator target -> location', () => {
  it('maps every utility and state target to its row', () => {
    const got = Object.fromEntries(['fpl', 'duke-energy-florida', 'teco', 'fl', 'pge', 'sce', 'sdge', 'ca'].map((t) => [t, locationKeyForTarget(ROWS, t)]));
    expect(got).toEqual({
      fpl: 'miami-fl',
      'duke-energy-florida': 'orlando-fl',
      teco: 'tampa-fl',
      fl: 'florida',
      pge: 'san-francisco-ca',
      sce: 'los-angeles-ca',
      sdge: 'san-diego-ca',
      ca: 'california',
    });
  });
  it('is null for an unknown or empty target and for a row without a verified place id', () => {
    expect(locationKeyForTarget(ROWS, 'none')).toBeNull();
    expect(locationKeyForTarget(ROWS, '')).toBeNull();
    expect(locationKeyForTarget([{ key: 'miami-fl', targets: ['fpl'], fb_place_id: null }], 'fpl')).toBeNull();
    expect(locationKeyForTarget([], 'fpl')).toBeNull();
  });
  it('takes the first row by key when a target is listed twice', () => {
    expect(locationKeyForTarget([{ key: 'b', targets: ['x'], fb_place_id: '2' }, { key: 'a', targets: ['x'], fb_place_id: '1' }], 'x')).toBe('a');
  });
  it('validates key format', () => {
    expect(isLocationKey('san-diego-ca')).toBe(true);
    expect(isLocationKey('Miami FL')).toBe(false);
    expect(isLocationKey('a,b')).toBe(false);
    expect(isLocationKey('-x')).toBe(false);
  });
});

describe('Instagram container params with a location and alt text', () => {
  const base = { caption: 'Hi', share_to_feed: true, thumb_offset_ms: null };
  const img = { kind: 'image' as const, public_url: 'https://x/i.jpg', alt_text: 'A chart of payback years' };
  const vid = { kind: 'video' as const, public_url: 'https://x/v.mp4', alt_text: 'ignored for video' };

  it('image: location_id and alt_text', () => {
    expect(containerParams({ ...base, type: 'image' }, [img], { locationId: '110148382341970' })).toEqual([{ image_url: img.public_url, caption: 'Hi', alt_text: img.alt_text, location_id: '110148382341970' }]);
  });
  it('reel: location_id, never alt_text', () => {
    const [p] = containerParams({ ...base, type: 'reel' }, [vid], { locationId: '9' });
    expect(p).toMatchObject({ media_type: 'REELS', location_id: '9' });
    expect(p).not.toHaveProperty('alt_text');
  });
  it('story: neither', () => {
    expect(containerParams({ ...base, type: 'story' }, [img], { locationId: '9' })).toEqual([{ media_type: 'STORIES', image_url: img.public_url }]);
  });
  it('carousel: alt_text on image children only, location only on the parent', () => {
    const kids = containerParams({ ...base, type: 'carousel' }, [img, vid], { locationId: '9' });
    expect(kids).toEqual([
      { is_carousel_item: 'true', image_url: img.public_url, alt_text: img.alt_text },
      { is_carousel_item: 'true', media_type: 'VIDEO', video_url: vid.public_url },
    ]);
    expect(carouselParentParams(base, ['A', 'B'], '9')).toEqual({ media_type: 'CAROUSEL', children: 'A,B', caption: 'Hi', location_id: '9' });
  });
  it('no location and no alt text: unchanged params', () => {
    expect(containerParams({ ...base, type: 'image' }, [{ kind: 'image', public_url: 'u', alt_text: null }])).toEqual([{ image_url: 'u', caption: 'Hi' }]);
    expect(carouselParentParams(base, ['A'], null)).toEqual({ media_type: 'CAROUSEL', children: 'A', caption: 'Hi' });
  });

  it('createContainer retries once without location_id when Instagram refuses it, and reports it', async () => {
    const t = fake((c, n) => (n === 1 ? INVALID_LOCATION : { json: { id: 'C2' } }));
    const rejected: string[] = [];
    const ig = createInstagramClient({ token: 'IGAAtoken0123456789abcdefghijklmnopqrstuvwxyz', userId: '178', fetch: t.f });
    expect(await ig.createContainer({ ...base, type: 'image' }, [img], { locationId: '1', onLocationRejected: (m) => void rejected.push(m) })).toBe('C2');
    expect(t.calls.map((c) => c.form.location_id ?? null)).toEqual(['1', null]);
    expect(t.calls[1]!.form.alt_text).toBe(img.alt_text);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatch(/2207019/);
  });
  it('carousel: only the parent is re-created without the location', async () => {
    let n = 0;
    const t = fake((c) => {
      if (c.form.media_type === 'CAROUSEL' && c.form.location_id) return INVALID_LOCATION;
      return { json: { id: `K${++n}` } };
    });
    const ig = createInstagramClient({ token: 'IGAAtoken0123456789abcdefghijklmnopqrstuvwxyz', userId: '178', fetch: t.f, sleep: async () => {} });
    expect(await ig.createContainer({ ...base, type: 'carousel' }, [img, img], { locationId: '1' })).toBe('K3');
    expect(t.calls.map((c) => c.form.media_type ?? 'child')).toEqual(['child', 'child', 'CAROUSEL', 'CAROUSEL']);
    expect(t.calls[3]!.form.location_id).toBeUndefined();
  });
  it('does not retry without a location, or on a transient error', async () => {
    const a = fake(() => INVALID_LOCATION);
    const ig = createInstagramClient({ token: 'IGAAtoken0123456789abcdefghijklmnopqrstuvwxyz', userId: '178', fetch: a.f });
    await expect(ig.createContainer({ ...base, type: 'image' }, [img])).rejects.toThrow(IgError);
    expect(a.calls).toHaveLength(1);
    const b = fake(() => ({ status: 500, json: { error: { message: 'down', code: 2 } } }));
    const ig2 = createInstagramClient({ token: 'IGAAtoken0123456789abcdefghijklmnopqrstuvwxyz', userId: '178', fetch: b.f });
    await expect(ig2.createContainer({ ...base, type: 'image' }, [img], { locationId: '1' })).rejects.toThrow(IgError);
    expect(b.calls).toHaveLength(1);
  });
  it('isLocationRejection: invalid-location subcode or bad parameter, not rate limits', () => {
    expect(isLocationRejection(new IgError('x', 400, 100, 2207019))).toBe(true);
    expect(isLocationRejection(new IgError('x', 400, 100))).toBe(true);
    expect(isLocationRejection(new IgError('x', 400, 4))).toBe(false);
    expect(isLocationRejection(new Error('x'))).toBe(false);
  });
});

describe('Facebook place', () => {
  const mk = (respond: Parameters<typeof fake>[0]) => {
    const t = fake(respond);
    return { ...t, fb: createFacebookClient({ token: 'EAAfbpagetoken0123456789abcdefghijklmnopqrstuvwxyz', pageId: 'PAGE', fetch: t.f }) };
  };
  it('photo, multi-photo feed post and Reel finish carry place; the unpublished uploads do not', async () => {
    let n = 0;
    const { fb, calls } = mk((c) => (c.url.pathname.endsWith('/feed') ? { json: { id: 'PAGE_FEED' } } : c.url.pathname.endsWith('/video_reels') ? { json: { success: true } } : { json: { id: `P${++n}`, post_id: `PAGE_P${n}` } }));
    await fb.publishPhoto('u', 'c', { place: '42' });
    await fb.publishMultiPhoto(['u1', 'u2'], 'c', { place: '42' });
    await fb.finishReel('V1', 'd', { place: '42' });
    expect(calls.map((c) => [c.url.pathname.split('/').pop(), c.form.published ?? '', c.form.place ?? null])).toEqual([
      ['photos', 'true', '42'],
      ['photos', 'false', null],
      ['photos', 'false', null],
      ['feed', '', '42'],
      ['video_reels', '', '42'],
    ]);
  });
  it('no place given: no place param', async () => {
    const { fb, calls } = mk(() => ({ json: { id: '1', post_id: 'PAGE_1' } }));
    await fb.publishPhoto('u', 'c');
    expect(calls[0]!.form).not.toHaveProperty('place');
  });
  it('a clean refusal of the place repeats the call once without it', async () => {
    const rejected: string[] = [];
    const { fb, calls } = mk((c) => (c.form.place ? { status: 400, json: { error: { message: 'Invalid place', code: 100 } } } : { json: { id: '1', post_id: 'PAGE_1' } }));
    expect((await fb.publishPhoto('u', 'c', { place: '42', onPlaceRejected: (m) => void rejected.push(m) })).postId).toBe('PAGE_1');
    expect(calls.map((c) => c.form.place ?? null)).toEqual(['42', null]);
    expect(rejected).toHaveLength(1);
  });
  it('an ambiguous failure (5xx / timeout) is never repeated', async () => {
    const { fb, calls } = mk(() => ({ status: 500, json: { error: { message: 'down', code: 1 } } }));
    await expect(fb.publishPhoto('u', 'c', { place: '42' })).rejects.toThrow(FbError);
    expect(calls).toHaveLength(1);
    expect(isPlaceRejection(new FbError('x', 400, 100))).toBe(true);
    expect(isPlaceRejection(new FbError('x', 0, 100))).toBe(false);
  });
});

describe('editor form: location_key', () => {
  const form = (extra: [string, string][]) => new URLSearchParams([['action', 'save'], ['type', 'image'], ['channels', 'instagram'], ...extra]);
  it('empty or missing = no location', () => {
    const a = parsePostForm(form([['location_key', '']]));
    const b = parsePostForm(form([]));
    expect(a.ok && a.value.location_key).toBeNull();
    expect(b.ok && b.value.location_key).toBeNull();
  });
  it('a key is kept', () => {
    const r = parsePostForm(form([['location_key', 'miami-fl']]));
    expect(r.ok && r.value.location_key).toBe('miami-fl');
  });
  it('a malformed key is an error', () => {
    const r = parsePostForm(form([['location_key', 'eq.miami']]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('Choose a location from the list.');
  });
});
