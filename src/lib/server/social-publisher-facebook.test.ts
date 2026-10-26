import { describe, expect, it } from 'vitest';
import type { SocialPost, SocialSettings } from '../social/types';
import { runInsightsSync, runPublisher, type SocialEnv } from './social-publisher';
import type { PostMedia, PostWhere, PublisherStore, UpdateResult } from './social-publisher-store';

const NOW = new Date('2026-11-02T18:00:00Z');
const IG_TOKEN = 'IGAAenvtoken0123456789abcdefghijklmnopqrstuv';
const FB_TOKEN = 'EAAfbpagetoken0123456789abcdefghijklmnopqrstuvwxyz';
const ENV: SocialEnv = {
  IG_USER_ID: '178',
  IG_ACCESS_TOKEN: IG_TOKEN,
  FB_PAGE_ID: 'PAGE',
  FB_PAGE_TOKEN: FB_TOKEN,
  OWNER_EMAIL: 'owner@example.com',
  RESEND_API_KEY: 'r',
  EMAIL_FROM: 'RayValue <a@rayvalue.com>',
  SUPABASE_URL: 'https://p.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
};
const ENV_NO_FB: SocialEnv = { ...ENV, FB_PAGE_ID: undefined, FB_PAGE_TOKEN: undefined };

const jpg = (n = 1): PostMedia => ({ kind: 'image', mime: 'image/jpeg', public_url: `https://x.supabase.co/i${n}.jpg`, width: 1080, height: 1350, duration_s: null });
const mp4: PostMedia = { kind: 'video', mime: 'video/mp4', public_url: 'https://x.supabase.co/v.mp4', width: 1080, height: 1920, duration_s: 20 };

const mkPost = (over: Partial<SocialPost> = {}): SocialPost => ({
  id: 'p1',
  type: 'image',
  status: 'scheduled',
  title: 'Test post',
  caption: 'See your payback.',
  origin: 'upload',
  template_key: null,
  data_refs: [],
  numbers_confirmed: false,
  share_to_feed: true,
  thumb_offset_ms: null,
  scheduled_at: '2026-11-02T17:00:00Z',
  checks: [],
  checks_passed: true,
  ig_container_id: null,
  ig_media_id: null,
  ig_permalink: null,
  published_at: null,
  attempts: 0,
  last_error: null,
  insights: null,
  insights_at: null,
  channels: ['facebook'],
  fb_post_id: null,
  fb_video_id: null,
  fb_permalink: null,
  fb_published_at: null,
  fb_attempts: 0,
  fb_last_error: null,
  fb_insights: null,
  fb_insights_at: null,
  location_key: null,
  created_at: '2026-10-30T00:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
  ...over,
});

const settings = (over: Partial<SocialSettings> = {}): SocialSettings => ({ auto_publish: true, paused: false, timezone: 'America/New_York', notify_email: true, slots: [], default_channels: ['instagram', 'facebook'], updated_at: 'x', ...over });

interface Ev {
  post_id: string | null;
  event: string;
  detail?: Record<string, unknown>;
}

function memoryStore(init: { posts: SocialPost[]; media?: Record<string, PostMedia[]> }) {
  const posts = new Map(init.posts.map((p) => [p.id, { ...p }]));
  const events: Ev[] = [];
  let version = 0;
  const store: PublisherStore = {
    async loadSettings() {
      return settings();
    },
    async loadDuePosts(now) {
      return [...posts.values()].filter((p) => p.status === 'publishing' || (p.status === 'scheduled' && p.scheduled_at !== null && new Date(p.scheduled_at) <= now)).map((p) => ({ ...p }));
    },
    async loadMedia(ids) {
      return new Map(ids.map((id) => [id, init.media?.[id] ?? [jpg()]]));
    },
    async updatePost(id, where: PostWhere, patch): Promise<UpdateResult> {
      const p = posts.get(id);
      if (!p) return 'nomatch';
      const st = where.status === undefined ? null : Array.isArray(where.status) ? where.status : [where.status];
      if (st && !st.includes(p.status)) return 'nomatch';
      if (where.updated_at !== undefined && where.updated_at !== p.updated_at) return 'nomatch';
      // mirror the database constraint: 'published' needs the id of every channel
      const next = { ...p, ...patch };
      if (next.status === 'published') {
        if (next.channels.includes('instagram') && !next.ig_media_id) throw new Error('constraint: published without ig_media_id');
        if (next.channels.includes('facebook') && !next.fb_post_id) throw new Error('constraint: published without fb_post_id');
      }
      Object.assign(p, patch, { updated_at: `2026-11-02T18:00:0${++version % 10}Z` });
      return { updated_at: p.updated_at };
    },
    async logEvent(post_id, event, detail) {
      events.push({ post_id, event, detail });
    },
    async loadAuth() {
      return null;
    },
    async saveAuth() {
      return true;
    },
    async loadPublishedSince(since) {
      return [...posts.values()].filter((p) => p.status === 'published' && p.published_at && new Date(p.published_at) >= since).map((p) => ({ ...p }));
    },
  };
  return { store, posts, events };
}

interface Net {
  /** Reel status per video id. */
  reel: Record<string, { video_status: string; publish_status?: string }>;
  photoFail?: { status: number; message?: string; code?: number } | null;
  feedFail?: { status: number; message?: string } | null;
  startFail?: { status: number; message?: string } | null;
  finishFail?: { status: number } | null;
  igStatus?: Record<string, string>;
  /** Instagram refuses any container with location_id (code 100 / 2207019). */
  igRejectLocation?: boolean;
  /** Facebook refuses any publish call with place (code 100). */
  fbRejectPlace?: boolean;
}

interface Call {
  host: string;
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  form: Record<string, string>;
}

/** Fake Instagram, Facebook (graph + rupload) and Resend. */
function fakeNet(cfg: Net = { reel: {} }) {
  const calls: Call[] = [];
  const emails: { subject: string; text: string }[] = [];
  let containers = 0;
  let photos = 0;
  let videos = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const err = (status: number, message: string, code = status >= 500 ? 2 : 100) => json({ error: { message, code } }, status);
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')));
    if (url.host === 'api.resend.com') {
      emails.push(JSON.parse(String(init?.body)));
      return json({ id: 'e' });
    }
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    calls.push({ host: url.host, method, path, query: url.searchParams, headers, form });

    if (url.host === 'graph.instagram.com') {
      if (method === 'POST' && path.endsWith('/media')) {
        if (cfg.igRejectLocation && form.location_id) return json({ error: { message: 'Invalid parameter', code: 100, error_subcode: 2207019 } }, 400);
        const id = `C${++containers}`;
        cfg.igStatus ??= {};
        cfg.igStatus[id] ??= 'FINISHED';
        return json({ id });
      }
      if (method === 'POST' && path.endsWith('/media_publish')) return json({ id: `M-${form.creation_id}` });
      if (path.endsWith('/insights')) return json({ data: [{ name: 'views', values: [{ value: 10 }] }] });
      if (url.searchParams.get('fields')?.startsWith('status_code')) return json({ status_code: cfg.igStatus?.[path.split('/').pop()!] ?? 'IN_PROGRESS' });
      if (url.searchParams.get('fields') === 'permalink') return json({ permalink: `https://www.instagram.com/p/${path.split('/').pop()}/` });
      return err(404, 'unexpected');
    }

    if (url.host === 'rupload.facebook.com') return json({ success: true });

    if (url.host === 'graph.facebook.com') {
      if (cfg.fbRejectPlace && method === 'POST' && form.place) return err(400, 'Invalid place', 100);
      if (method === 'POST' && path === '/v26.0/PAGE/photos') {
        if (cfg.photoFail) return err(cfg.photoFail.status, cfg.photoFail.message ?? 'Bad photo', cfg.photoFail.code);
        const id = `PH${++photos}`;
        return form.published === 'false' ? json({ id }) : json({ id, post_id: `PAGE_${id}` });
      }
      if (method === 'POST' && path === '/v26.0/PAGE/feed') return cfg.feedFail ? err(cfg.feedFail.status, cfg.feedFail.message ?? 'Bad feed') : json({ id: 'PAGE_FEED1' });
      if (method === 'POST' && path === '/v26.0/PAGE/video_reels') {
        if (form.upload_phase === 'start') return cfg.startFail ? err(cfg.startFail.status, cfg.startFail.message ?? 'Cannot start') : json({ video_id: `V${++videos}`, upload_url: 'https://rupload.facebook.com/x' });
        return cfg.finishFail ? err(cfg.finishFail.status, 'finish failed') : json({ success: true });
      }
      if (method === 'GET' && url.searchParams.get('fields') === 'status') {
        const s = cfg.reel[path.split('/').pop()!];
        return s ? json({ status: { video_status: s.video_status, publishing_phase: { publish_status: s.publish_status ?? 'draft' } }, id: 'x' }) : err(404, 'no such video');
      }
      if (method === 'GET' && url.searchParams.get('fields') === 'permalink_url') {
        const id = path.split('/').pop()!;
        return json({ permalink_url: id.startsWith('V') ? `/reel/${id}/` : `https://www.facebook.com/PAGE/posts/${id}` });
      }
      if (path.endsWith('/video_insights')) return json({ data: [{ name: 'blue_reels_play_count', values: [{ value: 42 }] }, { name: 'post_video_avg_time_watched', values: [{ value: 7000 }] }] });
      if (path.endsWith('/insights')) return json({ data: [{ name: 'post_media_view', values: [{ value: 90 }] }, { name: 'post_reactions_by_type_total', values: [{ value: { like: 4, love: 2 } }] }] });
    }
    return err(404, 'unexpected');
  }) as typeof fetch;
  const fbPosts = () => calls.filter((c) => c.host.endsWith('facebook.com') && c.method === 'POST');
  const igPosts = () => calls.filter((c) => c.host === 'graph.instagram.com' && c.method === 'POST');
  return { f, calls, emails, cfg, fbPosts, igPosts };
}

const deps = (store: PublisherStore) => ({ store, sleep: async () => {}, nowMs: () => 0 });
const run = (env: SocialEnv, net: ReturnType<typeof fakeNet>, store: PublisherStore, at = NOW) => runPublisher(env, net.f, at, deps(store));

describe('Facebook photo posts', () => {
  it('publishes a single photo to the Page, records the id and permalink, and emails the link', async () => {
    const m = memoryStore({ posts: [mkPost()] });
    const net = fakeNet();
    const out = await run(ENV, net, m.store);
    expect(out).toMatchObject({ ok: true, published: 1 });
    expect(m.posts.get('p1')).toMatchObject({ status: 'published', fb_post_id: 'PAGE_PH1', fb_permalink: 'https://www.facebook.com/PAGE/posts/PAGE_PH1', ig_media_id: null });
    expect(m.posts.get('p1')!.fb_published_at).toBe(NOW.toISOString());
    const post = net.fbPosts()[0]!;
    expect(post.path).toBe('/v26.0/PAGE/photos');
    expect(post.form).toMatchObject({ url: 'https://x.supabase.co/i1.jpg', caption: 'See your payback.', message: 'See your payback.', published: 'true' });
    expect(post.headers.Authorization).toBe(`OAuth ${FB_TOKEN}`);
    expect(net.igPosts()).toHaveLength(0);
    expect(net.emails[0]!.text).toContain('Facebook: https://www.facebook.com/PAGE/posts/PAGE_PH1');
  });

  it('publishes a carousel as a multi-photo post: unpublished uploads, then one feed post with attached_media', async () => {
    const m = memoryStore({ posts: [mkPost({ type: 'carousel' })], media: { p1: [jpg(1), jpg(2), jpg(3)] } });
    const net = fakeNet();
    await run(ENV, net, m.store);
    const posts = net.fbPosts();
    expect(posts.map((c) => c.path.split('/').pop())).toEqual(['photos', 'photos', 'photos', 'feed']);
    expect(posts.slice(0, 3).every((c) => c.form.published === 'false')).toBe(true);
    expect(posts[3]!.form).toMatchObject({
      message: 'See your payback.',
      'attached_media[0]': JSON.stringify({ media_fbid: 'PH1' }),
      'attached_media[1]': JSON.stringify({ media_fbid: 'PH2' }),
      'attached_media[2]': JSON.stringify({ media_fbid: 'PH3' }),
    });
    expect(m.posts.get('p1')).toMatchObject({ status: 'published', fb_post_id: 'PAGE_FEED1' });
  });

  it('a carousel with a video never goes to Facebook (final checks send it to review)', async () => {
    const m = memoryStore({ posts: [mkPost({ type: 'carousel' })], media: { p1: [jpg(1), mp4] } });
    const net = fakeNet();
    await run(ENV, net, m.store);
    expect(m.posts.get('p1')!.status).toBe('review');
    expect(net.calls.filter((c) => c.host !== 'api.resend.com')).toHaveLength(0);
  });

  it('a story that includes Facebook is held in review and nothing is published', async () => {
    const m = memoryStore({ posts: [mkPost({ type: 'story', channels: ['instagram', 'facebook'] })] });
    const net = fakeNet();
    await run(ENV, net, m.store);
    expect(m.posts.get('p1')!.status).toBe('review');
    expect(net.fbPosts()).toHaveLength(0);
    expect(net.igPosts()).toHaveLength(0);
  });
});

describe('Facebook Reels', () => {
  const reelPost = (over: Partial<SocialPost> = {}) => mkPost({ type: 'reel', ...over });

  it('uploads the hosted file, finishes when the upload is complete, and publishes once Facebook says published', async () => {
    const m = memoryStore({ posts: [reelPost()], media: { p1: [mp4] } });
    const net = fakeNet({ reel: { V1: { video_status: 'uploading' } } });

    const first = await run(ENV, net, m.store);
    expect(first.waiting).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'publishing', fb_video_id: 'V1', fb_post_id: null });
    const upload = net.calls.find((c) => c.host === 'rupload.facebook.com')!;
    expect(upload.path).toBe('/video-upload/v26.0/V1');
    expect(upload.headers).toMatchObject({ file_url: mp4.public_url, Authorization: `OAuth ${FB_TOKEN}` });
    expect(net.fbPosts().some((c) => c.form.upload_phase === 'finish')).toBe(false);

    net.cfg.reel.V1 = { video_status: 'upload_complete' };
    await run(ENV, net, m.store);
    const finish = net.fbPosts().filter((c) => c.form.upload_phase === 'finish');
    expect(finish).toHaveLength(1);
    expect(finish[0]!.form).toMatchObject({ video_id: 'V1', video_state: 'PUBLISHED', description: 'See your payback.' });
    expect(m.posts.get('p1')!.status).toBe('publishing');

    net.cfg.reel.V1 = { video_status: 'ready', publish_status: 'published' };
    const third = await run(ENV, net, m.store);
    expect(third.published).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'published', fb_post_id: 'V1', fb_video_id: 'V1', fb_permalink: 'https://www.facebook.com/reel/V1/' });
    // one upload session for the whole life of the post
    expect(net.fbPosts().filter((c) => c.form.upload_phase === 'start')).toHaveLength(1);
    expect(net.fbPosts().filter((c) => c.form.upload_phase === 'finish')).toHaveLength(1);
  });

  it('never finishes a Reel that is already published', async () => {
    const m = memoryStore({ posts: [reelPost({ status: 'publishing', fb_video_id: 'V9' })], media: { p1: [mp4] } });
    const net = fakeNet({ reel: { V9: { video_status: 'ready', publish_status: 'published' } } });
    await run(ENV, net, m.store);
    expect(net.fbPosts()).toHaveLength(0);
    expect(m.posts.get('p1')).toMatchObject({ status: 'published', fb_post_id: 'V9' });
  });

  it('a Reel that fails processing is retried with a fresh upload (video id cleared, attempt counted)', async () => {
    const m = memoryStore({ posts: [reelPost({ status: 'publishing', fb_video_id: 'V9' })], media: { p1: [mp4] } });
    const net = fakeNet({ reel: { V9: { video_status: 'error' } } });
    const out = await run(ENV, net, m.store);
    expect(out.retried).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'scheduled', fb_attempts: 1, fb_video_id: null, scheduled_at: new Date(NOW.getTime() + 15 * 60_000).toISOString() });
    expect(m.posts.get('p1')!.fb_last_error).toMatch(/could not process the Reel/);
  });

  it('keeps waiting while Facebook is still processing, and gives up after an hour', async () => {
    const waiting = memoryStore({ posts: [reelPost({ status: 'publishing', fb_video_id: 'V9', updated_at: '2026-11-02T17:30:00Z' })], media: { p1: [mp4] } });
    const net = fakeNet({ reel: { V9: { video_status: 'processing' } } });
    expect((await run(ENV, net, waiting.store)).waiting).toBe(1);
    expect(waiting.posts.get('p1')!.status).toBe('publishing');

    const stuck = memoryStore({ posts: [reelPost({ status: 'publishing', fb_video_id: 'V9', updated_at: '2026-11-02T16:00:00Z' })], media: { p1: [mp4] } });
    expect((await run(ENV, net, stuck.store)).retried).toBe(1);
    expect(stuck.posts.get('p1')!.fb_last_error).toMatch(/in time/);
  });
});

describe('both channels', () => {
  const both = (over: Partial<SocialPost> = {}) => mkPost({ channels: ['instagram', 'facebook'], ...over });

  it('publishes to Instagram and Facebook, the post becomes published, and the email lists both permalinks', async () => {
    const m = memoryStore({ posts: [both()] });
    const net = fakeNet();
    const out = await run(ENV, net, m.store);
    expect(out.published).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'published', ig_media_id: 'M-C1', fb_post_id: 'PAGE_PH1' });
    expect(net.emails).toHaveLength(1);
    expect(net.emails[0]!.text).toContain('Instagram: https://www.instagram.com/p/M-C1/');
    expect(net.emails[0]!.text).toContain('Facebook: https://www.facebook.com/PAGE/posts/PAGE_PH1');
    expect(m.events.at(-1)).toMatchObject({ event: 'published', detail: { media_id: 'M-C1', facebook: { post_id: 'PAGE_PH1' } } });
  });

  it('never re-publishes a channel that already has its id', async () => {
    const m = memoryStore({ posts: [both({ ig_media_id: 'M1', ig_permalink: 'https://www.instagram.com/p/M1/' })] });
    const net = fakeNet();
    await run(ENV, net, m.store);
    expect(net.igPosts()).toHaveLength(0);
    expect(net.fbPosts()).toHaveLength(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'published', ig_media_id: 'M1', fb_post_id: 'PAGE_PH1' });

    const m2 = memoryStore({ posts: [both({ fb_post_id: 'PAGE_OLD', fb_permalink: 'https://www.facebook.com/x' })] });
    const net2 = fakeNet();
    await run(ENV, net2, m2.store);
    expect(net2.fbPosts()).toHaveLength(0);
    expect(net2.igPosts().length).toBeGreaterThan(0);
    expect(m2.posts.get('p1')).toMatchObject({ status: 'published', fb_post_id: 'PAGE_OLD', ig_media_id: 'M-C1' });
  });

  it('a post whose channels both already have ids is just marked published (no API writes)', async () => {
    const m = memoryStore({ posts: [both({ status: 'publishing', ig_media_id: 'M1', ig_permalink: 'x', fb_post_id: 'F1', fb_permalink: 'y' })] });
    const net = fakeNet();
    await run(ENV, net, m.store);
    expect(net.igPosts().length + net.fbPosts().length).toBe(0);
    expect(m.posts.get('p1')!.status).toBe('published');
  });

  it('Facebook fails but Instagram succeeds: Instagram is kept, the post goes back to scheduled for a retry of Facebook only', async () => {
    const m = memoryStore({ posts: [both()] });
    const net = fakeNet({ reel: {}, photoFail: { status: 400, message: 'Photo rejected' } });
    const out = await run(ENV, net, m.store);
    expect(out.retried).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({
      status: 'scheduled',
      ig_media_id: 'M-C1',
      fb_post_id: null,
      attempts: 0,
      fb_attempts: 1,
      scheduled_at: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
    });
    expect(m.posts.get('p1')!.fb_last_error).toContain('Photo rejected');
    expect(net.emails).toHaveLength(0);

    // next run: Facebook works now. Instagram must not be touched again.
    net.cfg.photoFail = null;
    const igBefore = net.igPosts().length;
    const later = new Date(NOW.getTime() + 16 * 60_000);
    const second = await run(ENV, net, m.store, later);
    expect(second.published).toBe(1);
    expect(net.igPosts()).toHaveLength(igBefore);
    expect(m.posts.get('p1')).toMatchObject({ status: 'published', ig_media_id: 'M-C1', fb_post_id: 'PAGE_PH1', fb_attempts: 1 });
    expect(net.emails[0]!.text).toContain('Instagram:');
    expect(net.emails[0]!.text).toContain('Facebook:');
  });

  it('Facebook runs out of attempts after Instagram succeeded: post is failed, Instagram ids kept, the email names Facebook', async () => {
    const m = memoryStore({ posts: [both({ fb_attempts: 2 })] });
    const net = fakeNet({ reel: {}, photoFail: { status: 400, message: 'Photo rejected' } });
    const out = await run(ENV, net, m.store);
    expect(out.failed).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'failed', ig_media_id: 'M-C1', fb_post_id: null, fb_attempts: 3, attempts: 0 });
    expect(net.emails).toHaveLength(1);
    expect(net.emails[0]!.subject).toMatch(/failed on Facebook/);
    expect(net.emails[0]!.text).toContain('Facebook failed: Facebook 400');
    expect(net.emails[0]!.text).toContain('did publish to: Instagram');
    expect(net.emails[0]!.text).not.toContain('Instagram failed');
  });

  it('Retry (failed -> scheduled with attempts reset) only retries the missing channel', async () => {
    const m = memoryStore({ posts: [both({ status: 'failed', ig_media_id: 'M1', ig_permalink: 'https://www.instagram.com/p/M1/', fb_attempts: 3, fb_last_error: 'x' })] });
    const net = fakeNet();
    // what the admin's Retry does
    await m.store.updatePost('p1', { status: 'failed' }, { status: 'scheduled', scheduled_at: NOW.toISOString(), attempts: 0, last_error: null, fb_attempts: 0, fb_last_error: null });
    const out = await run(ENV, net, m.store);
    expect(out.published).toBe(1);
    expect(net.igPosts()).toHaveLength(0);
    expect(net.fbPosts()).toHaveLength(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'published', ig_media_id: 'M1', fb_post_id: 'PAGE_PH1' });
  });

  it('Instagram fails for good while Facebook succeeds: failed, Facebook id kept', async () => {
    const m = memoryStore({ posts: [both({ attempts: 2 })] });
    const net = fakeNet({ reel: {}, igStatus: { C1: 'ERROR' } });
    const out = await run(ENV, net, m.store);
    expect(out.failed).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'failed', attempts: 3, fb_post_id: 'PAGE_PH1' });
    expect(net.emails[0]!.subject).toMatch(/failed on Instagram/);
    expect(net.emails[0]!.text).toContain('Instagram failed:');
  });

  it('a Facebook failure while an Instagram video is still processing: stays publishing, retried in place later without a second Instagram container', async () => {
    const m = memoryStore({ posts: [both({ type: 'reel' })], media: { p1: [mp4] } });
    const net = fakeNet({ reel: {}, startFail: { status: 400, message: 'Cannot start' }, igStatus: { C1: 'IN_PROGRESS' } });
    const first = await run(ENV, net, m.store);
    expect(first.waiting).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'publishing', ig_container_id: 'C1', fb_attempts: 1, scheduled_at: new Date(NOW.getTime() + 15 * 60_000).toISOString() });

    // too early: nothing restarts
    await run(ENV, net, m.store, new Date(NOW.getTime() + 5 * 60_000));
    expect(net.fbPosts().filter((c) => c.form.upload_phase === 'start')).toHaveLength(1);

    // later: Instagram finished, Facebook starts again in place
    net.cfg.startFail = null;
    net.cfg.igStatus!.C1 = 'FINISHED';
    net.cfg.reel.V1 = { video_status: 'uploading' };
    await run(ENV, net, m.store, new Date(NOW.getTime() + 16 * 60_000));
    expect(net.igPosts().filter((c) => c.path.endsWith('/media'))).toHaveLength(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'publishing', ig_media_id: 'M-C1', fb_video_id: 'V1' });
    expect(net.fbPosts().filter((c) => c.form.upload_phase === 'start')).toHaveLength(2);
  });

  it('an ambiguous Facebook publish failure (server error) is never retried automatically', async () => {
    const m = memoryStore({ posts: [mkPost()] });
    const net = fakeNet({ reel: {}, photoFail: { status: 500, message: 'Something went wrong' } });
    const out = await run(ENV, net, m.store);
    expect(out.failed).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'failed', fb_attempts: 3 });
    expect(m.posts.get('p1')!.fb_last_error).toMatch(/Check the Page/);
    expect(net.fbPosts()).toHaveLength(1);
  });
});

describe('Facebook not connected', () => {
  it('a post that includes Facebook goes to review and nothing is published to either channel', async () => {
    const m = memoryStore({ posts: [mkPost({ channels: ['instagram', 'facebook'] })] });
    const net = fakeNet();
    const out = await run(ENV_NO_FB, net, m.store);
    expect(out.sentToReview).toBe(1);
    expect(out.facebook).toMatch(/not connected/);
    expect(m.posts.get('p1')).toMatchObject({ status: 'review', fb_last_error: 'Facebook Page not connected' });
    expect(net.igPosts()).toHaveLength(0);
    expect(net.fbPosts()).toHaveLength(0);
    expect(m.events.map((e) => e.event)).toEqual(['facebook_not_connected']);
    expect(net.emails).toHaveLength(1);
    expect(net.emails[0]!.text).toContain('Facebook Page is not connected');
  });

  it('Instagram-only posts keep publishing, and the summary says Facebook is not connected', async () => {
    const m = memoryStore({ posts: [mkPost({ channels: ['instagram'] })] });
    const net = fakeNet();
    const out = await run(ENV_NO_FB, net, m.store);
    expect(out).toMatchObject({ ok: true, published: 1 });
    expect(out.facebook).toMatch(/FB_PAGE_ID/);
    expect(m.posts.get('p1')!.status).toBe('published');
  });

  it('only one of the two variables set still counts as not connected', async () => {
    const m = memoryStore({ posts: [mkPost()] });
    const net = fakeNet();
    await run({ ...ENV, FB_PAGE_TOKEN: undefined }, net, m.store);
    expect(m.posts.get('p1')!.status).toBe('review');
  });
});

describe('dry run', () => {
  it('writes nothing to Facebook or Instagram and only logs what would happen', async () => {
    const m = memoryStore({ posts: [mkPost({ channels: ['instagram', 'facebook'] })] });
    const net = fakeNet();
    await run({ ...ENV, SOCIAL_DRY_RUN: '1' }, net, m.store);
    expect(net.fbPosts()).toHaveLength(0);
    expect(net.igPosts()).toHaveLength(0);
    expect(m.posts.get('p1')!.status).toBe('scheduled');
    expect(m.events).toEqual([{ post_id: 'p1', event: 'dry_run', detail: expect.objectContaining({ would: 'create_container_and_publish', channels: ['instagram', 'facebook'] }) }]);
  });

  it('does not finish a Reel in dry run either', async () => {
    const m = memoryStore({ posts: [mkPost({ type: 'reel', status: 'publishing', fb_video_id: 'V9' })], media: { p1: [mp4] } });
    const net = fakeNet({ reel: { V9: { video_status: 'upload_complete' } } });
    await run({ ...ENV, SOCIAL_DRY_RUN: '1' }, net, m.store);
    expect(net.fbPosts()).toHaveLength(0);
    expect(m.events.map((e) => e.event)).toContain('dry_run');
  });
});

describe('secrets', () => {
  it('the Page token never reaches last_error, events, or emails', async () => {
    const leak = `Invalid token ${FB_TOKEN} access_token=${FB_TOKEN}`;
    const m = memoryStore({ posts: [mkPost({ fb_attempts: 2 })] });
    const net = fakeNet({ reel: {}, photoFail: { status: 400, message: leak } });
    await run(ENV, net, m.store);
    expect(m.posts.get('p1')!.status).toBe('failed');
    expect(JSON.stringify([m.posts.get('p1'), m.events, net.emails])).not.toContain(FB_TOKEN);
    expect(net.calls.every((c) => !c.query.has('access_token'))).toBe(true);
  });
});

describe('Facebook insights', () => {
  const published = (over: Partial<SocialPost>) => mkPost({ status: 'published', fb_post_id: 'PAGE_PH1', published_at: '2026-10-30T00:00:00Z', ...over });

  it('stores flat metric numbers for photo posts (reactions summed) and Reels (video_insights)', async () => {
    const m = memoryStore({ posts: [published({ id: 'a' }), published({ id: 'r', type: 'reel', fb_post_id: 'V1', fb_video_id: 'V1' }), published({ id: 'old', published_at: '2026-09-01T00:00:00Z' })] });
    const net = fakeNet();
    const out = await runInsightsSync(ENV, net.f, NOW, deps(m.store));
    expect(out).toMatchObject({ ok: true, checked: 2, updated: 2 });
    expect(m.posts.get('a')).toMatchObject({ fb_insights: { post_media_view: 90, post_reactions_total: 6 }, fb_insights_at: NOW.toISOString(), insights: null });
    expect(m.posts.get('r')).toMatchObject({ fb_insights: { blue_reels_play_count: 42, post_video_avg_time_watched: 7000 } });
    expect(m.posts.get('old')!.fb_insights).toBeNull();
    expect(net.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(net.calls.some((c) => c.path === '/v26.0/V1/video_insights' && c.query.get('period') === 'lifetime')).toBe(true);
    expect(net.calls.some((c) => c.path === '/v26.0/PAGE_PH1/insights' && c.query.get('metric')!.includes('post_media_view'))).toBe(true);
  });

  it('syncs both channels of one post independently', async () => {
    const m = memoryStore({ posts: [published({ id: 'b', channels: ['instagram', 'facebook'], ig_media_id: 'M1' })] });
    const net = fakeNet();
    const out = await runInsightsSync(ENV, net.f, NOW, deps(m.store));
    expect(out).toMatchObject({ ok: true, checked: 2, updated: 2 });
    expect(m.posts.get('b')).toMatchObject({ insights: { views: 10 }, fb_insights: { post_media_view: 90 } });
  });

  it('skips Facebook cleanly when the Page is not connected', async () => {
    const m = memoryStore({ posts: [published({ id: 'a' })] });
    const net = fakeNet();
    const out = await runInsightsSync(ENV_NO_FB, net.f, NOW, deps(m.store));
    expect(out.ok).toBe(true);
    expect(out.facebook).toMatch(/not connected/);
    expect(net.calls).toHaveLength(0);
  });

  it('reports a rejected Page token without leaking it', async () => {
    const m = memoryStore({ posts: [published({ id: 'a' })] });
    const bad = (async () => new Response(JSON.stringify({ error: { message: `bad ${FB_TOKEN}`, code: 190 } }), { status: 400 })) as typeof fetch;
    const out = await runInsightsSync(ENV, bad, NOW, deps(m.store));
    expect(out).toMatchObject({ ok: false, error: 'Facebook rejected the Page token' });
  });
});

describe('location tags', () => {
  const MIAMI = '110148382341970';
  const tagged = (over: Partial<SocialPost> = {}) => Object.assign(mkPost({ location_key: 'miami-fl', ...over }), { location: { fb_place_id: MIAMI } });

  it('passes location_id on the Instagram container and place on the Facebook photo', async () => {
    const m = memoryStore({ posts: [tagged({ channels: ['instagram', 'facebook'] })], media: { p1: [{ ...jpg(), alt_text: 'Payback chart' }] } });
    const net = fakeNet();
    expect(await run(ENV, net, m.store)).toMatchObject({ ok: true, published: 1 });
    const container = net.igPosts().find((c) => c.path.endsWith('/media'))!;
    expect(container.form).toMatchObject({ location_id: MIAMI, alt_text: 'Payback chart' });
    expect(net.fbPosts().find((c) => c.path.endsWith('/photos'))!.form.place).toBe(MIAMI);
    expect(m.events.some((e) => e.event === 'location_dropped')).toBe(false);
  });

  it('carousel: location on the Instagram parent and the Facebook feed post only', async () => {
    const m = memoryStore({ posts: [tagged({ type: 'carousel', channels: ['instagram', 'facebook'] })], media: { p1: [jpg(1), jpg(2)] } });
    const net = fakeNet();
    await run(ENV, net, m.store);
    const ig = net.igPosts().filter((c) => c.path.endsWith('/media'));
    expect(ig.map((c) => c.form.location_id ?? null)).toEqual([null, null, MIAMI]);
    const fb = net.fbPosts();
    expect(fb.map((c) => c.form.place ?? null)).toEqual([null, null, MIAMI]);
  });

  it('Facebook Reel: place on the finish call', async () => {
    const m = memoryStore({ posts: [tagged({ type: 'reel' })], media: { p1: [mp4] } });
    const net = fakeNet({ reel: { V1: { video_status: 'ready' } } });
    await run(ENV, net, m.store);
    const finish = net.fbPosts().find((c) => c.form.upload_phase === 'finish')!;
    expect(finish.form.place).toBe(MIAMI);
    expect(net.fbPosts().find((c) => c.form.upload_phase === 'start')!.form.place).toBeUndefined();
  });

  it('no location: no location_id and no place', async () => {
    const m = memoryStore({ posts: [mkPost({ channels: ['instagram', 'facebook'] })] });
    const net = fakeNet();
    await run(ENV, net, m.store);
    expect([...net.igPosts(), ...net.fbPosts()].some((c) => 'location_id' in c.form || 'place' in c.form)).toBe(false);
  });

  it('a location key whose row has no verified place id is not sent', async () => {
    const m = memoryStore({ posts: [Object.assign(mkPost({ location_key: 'x', channels: ['instagram'] }), { location: { fb_place_id: null } })] });
    const net = fakeNet();
    await run(ENV, net, m.store);
    expect(net.igPosts().some((c) => 'location_id' in c.form)).toBe(false);
  });

  it('Instagram refuses the location: container made again without it, post still publishes, event logged', async () => {
    const m = memoryStore({ posts: [tagged({ channels: ['instagram'] })] });
    const net = fakeNet({ reel: {}, igRejectLocation: true });
    expect(await run(ENV, net, m.store)).toMatchObject({ ok: true, published: 1, failed: 0, retried: 0 });
    const media = net.igPosts().filter((c) => c.path.endsWith('/media'));
    expect(media.map((c) => c.form.location_id ?? null)).toEqual([MIAMI, null]);
    expect(m.posts.get('p1')).toMatchObject({ status: 'published', attempts: 0, last_error: null });
    const ev = m.events.find((e) => e.event === 'location_dropped')!;
    expect(ev.detail).toMatchObject({ channel: 'instagram', location_key: 'miami-fl', place_id: MIAMI });
    expect(JSON.stringify(m.events)).not.toContain(IG_TOKEN);
  });

  it('Facebook refuses the place: photo posted without it, event logged', async () => {
    const m = memoryStore({ posts: [tagged()] });
    const net = fakeNet({ reel: {}, fbRejectPlace: true });
    expect(await run(ENV, net, m.store)).toMatchObject({ ok: true, published: 1 });
    expect(net.fbPosts().map((c) => c.form.place ?? null)).toEqual([MIAMI, null]);
    expect(m.events.find((e) => e.event === 'location_dropped')!.detail).toMatchObject({ channel: 'facebook' });
  });

  it('dry run records the location it would send', async () => {
    const m = memoryStore({ posts: [tagged({ channels: ['instagram'] })] });
    const net = fakeNet();
    await run({ ...ENV, SOCIAL_DRY_RUN: '1' }, net, m.store);
    expect(m.events.find((e) => e.event === 'dry_run')!.detail).toMatchObject({ location: MIAMI });
    expect(net.igPosts()).toHaveLength(0);
  });
});
