import { describe, expect, it } from 'vitest';
import { publisherCanMove, canTransition } from '../social/status';
import { supabaseStore } from './social-publisher-store';

const ENV = { SUPABASE_URL: 'https://p.supabase.co/', SUPABASE_SECRET_KEY: 'secret-key' };

function fakeFetch(respond: (url: URL, init: RequestInit) => unknown) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    return new Response(JSON.stringify(respond(url, init ?? {})), { status: 200 });
  }) as typeof fetch;
  return { f, calls };
}

describe('supabaseStore', () => {
  it('updatePost sends a conditional PATCH (id + status + row version) and reports the new version or no match', async () => {
    const hit = fakeFetch(() => [{ updated_at: '2026-11-02T18:00:00.123456+00:00' }]);
    const r = await supabaseStore(ENV, hit.f).updatePost('p1', { status: ['publishing'], updated_at: '2026-11-02T17:59:00.5+00:00' }, { last_error: null });
    expect(r).toEqual({ updated_at: '2026-11-02T18:00:00.123456+00:00' });
    const { url, init } = hit.calls[0]!;
    expect(init.method).toBe('PATCH');
    expect(url.pathname).toBe('/rest/v1/social_posts');
    expect(url.searchParams.get('id')).toBe('eq.p1');
    expect(url.searchParams.get('status')).toBe('in.(publishing)');
    expect(url.searchParams.get('updated_at')).toBe('eq.2026-11-02T17:59:00.5+00:00');
    expect(url.search).toContain('%2B00%3A00'); // the "+" is encoded, not read as a space
    expect((init.headers as Record<string, string>).apikey).toBe('secret-key');

    const miss = fakeFetch(() => []);
    expect(await supabaseStore(ENV, miss.f).updatePost('p1', { status: 'scheduled' }, { status: 'publishing' })).toBe('nomatch');
    expect(miss.calls[0]!.url.searchParams.get('status')).toBe('eq.scheduled');
  });

  it('loadDuePosts asks for scheduled-and-due or publishing, oldest first', async () => {
    const t = fakeFetch(() => []);
    await supabaseStore(ENV, t.f).loadDuePosts(new Date('2026-11-02T18:00:00Z'), 20);
    const u = t.calls[0]!.url;
    expect(u.searchParams.get('or')).toBe('(and(status.eq.scheduled,scheduled_at.lte.2026-11-02T18:00:00.000Z),status.eq.publishing)');
    expect(u.searchParams.get('order')).toBe('scheduled_at.asc');
    // the location tag's place id comes along (social_locations via location_key)
    expect(u.searchParams.get('select')).toBe('*,location:social_locations(fb_place_id)');
  });

  it('loadPublishedSince includes posts published to either channel', async () => {
    const t = fakeFetch(() => []);
    await supabaseStore(ENV, t.f).loadPublishedSince(new Date('2026-10-01T00:00:00Z'), 60);
    const u = t.calls[0]!.url;
    expect(u.searchParams.get('status')).toBe('eq.published');
    expect(u.searchParams.get('or')).toBe('(ig_media_id.not.is.null,fb_post_id.not.is.null)');
  });

  it('loadMedia returns ordered media per post', async () => {
    const m = { kind: 'image', mime: 'image/jpeg', public_url: 'https://x/i.jpg', width: 1, height: 1, duration_s: null };
    const t = fakeFetch(() => [
      { post_id: 'a', position: 0, media: m },
      { post_id: 'a', position: 1, media: { ...m, public_url: 'https://x/j.jpg' } },
    ]);
    const out = await supabaseStore(ENV, t.f).loadMedia(['a']);
    expect(out!.get('a')!.map((x) => x.public_url)).toEqual(['https://x/i.jpg', 'https://x/j.jpg']);
    expect(t.calls[0]!.url.searchParams.get('order')).toBe('position.asc');
    expect(t.calls[0]!.url.searchParams.get('select')).toContain('alt_text');
  });

  it('saveAuth upserts the single social_auth row', async () => {
    const t = fakeFetch(() => ({}));
    expect(await supabaseStore(ENV, t.f).saveAuth({ access_token: 'x'.repeat(30), expires_at: null, refreshed_at: 'now' })).toBe(true);
    expect(t.calls[0]!.url.searchParams.get('on_conflict')).toBe('id');
    expect(JSON.parse(String(t.calls[0]!.init.body)).id).toBe(true);
  });
});

describe('publisher status moves', () => {
  it('allows the publisher-only moves without opening them to the owner UI', () => {
    expect(publisherCanMove('scheduled', 'review')).toBe(true);
    expect(publisherCanMove('publishing', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'review')).toBe(false);
    expect(canTransition('publishing', 'scheduled')).toBe(false);
    expect(publisherCanMove('published', 'scheduled')).toBe(false);
  });
});
