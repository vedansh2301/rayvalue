import { describe, expect, it } from 'vitest';
import type { SocialPost, SocialSettings } from '../social/types';
import { currentToken, MAX_POSTS_PER_RUN, runInsightsSync, runPublisher, runTokenRefresh, type SocialEnv } from './social-publisher';
import type { AuthRow, PostMedia, PostWhere, PublisherStore, UpdateResult } from './social-publisher-store';

const NOW = new Date('2026-11-02T18:00:00Z');
const ENV_TOKEN = 'IGAAenvtoken0123456789abcdefghijklmnopqrstuv';
const DB_TOKEN = 'IGAAdbtoken00123456789abcdefghijklmnopqrstuv';
const ENV: SocialEnv = { IG_USER_ID: '178', IG_ACCESS_TOKEN: ENV_TOKEN, OWNER_EMAIL: 'owner@example.com', RESEND_API_KEY: 'r', EMAIL_FROM: 'RayValue <a@rayvalue.com>', SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SECRET_KEY: 'k' };

const jpg: PostMedia = { kind: 'image', mime: 'image/jpeg', public_url: 'https://x.supabase.co/i.jpg', width: 1080, height: 1350, duration_s: null };
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
  channels: ['instagram'],
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
  updated_at: 'v0',
  ...over,
});

const settings = (over: Partial<SocialSettings> = {}): SocialSettings => ({ auto_publish: true, paused: false, timezone: 'America/New_York', notify_email: true, slots: [], default_channels: ['instagram'], updated_at: 'x', ...over });

interface Events {
  post_id: string | null;
  event: string;
  detail?: Record<string, unknown>;
}

function memoryStore(init: { posts: SocialPost[]; media?: Record<string, PostMedia[]>; settings?: SocialSettings; auth?: AuthRow | null }) {
  const posts = new Map(init.posts.map((p) => [p.id, { ...p }]));
  const events: Events[] = [];
  let version = 0;
  const state = { auth: init.auth ?? null };
  const store: PublisherStore = {
    async loadSettings() {
      return init.settings ?? settings();
    },
    async loadDuePosts(now) {
      return [...posts.values()].filter((p) => p.status === 'publishing' || (p.status === 'scheduled' && p.scheduled_at !== null && new Date(p.scheduled_at) <= now)).map((p) => ({ ...p }));
    },
    async loadMedia(ids) {
      return new Map(ids.map((id) => [id, init.media?.[id] ?? [jpg]]));
    },
    async updatePost(id, where: PostWhere, patch): Promise<UpdateResult> {
      const p = posts.get(id);
      if (!p) return 'nomatch';
      const st = where.status === undefined ? null : Array.isArray(where.status) ? where.status : [where.status];
      if (st && !st.includes(p.status)) return 'nomatch';
      if (where.updated_at !== undefined && where.updated_at !== p.updated_at) return 'nomatch';
      Object.assign(p, patch, { updated_at: `v${++version}` });
      return { updated_at: p.updated_at };
    },
    async logEvent(post_id, event, detail) {
      events.push({ post_id, event, detail });
    },
    async loadAuth() {
      return state.auth;
    },
    async saveAuth(row) {
      state.auth = row;
      return true;
    },
    async loadPublishedSince(since) {
      return [...posts.values()].filter((p) => p.status === 'published' && p.published_at && new Date(p.published_at) >= since).map((p) => ({ ...p }));
    },
  };
  return { store, posts, events, state };
}

interface Ig {
  /** container id -> status_code returned by GET */
  statuses: Record<string, string>;
  failCreate?: { status: number; message?: string } | null;
  failPublish?: { status: number; message?: string } | null;
  refresh?: { status?: number; json: unknown };
  insights?: Record<string, number>;
}

/** Fake Instagram + Resend. */
function fakeNet(ig: Ig = { statuses: {} }) {
  const calls: { method: string; url: URL; auth: string | null; form: Record<string, string> }[] = [];
  const emails: { subject: string; text: string }[] = [];
  let containers = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')));
    if (url.host === 'api.resend.com') {
      emails.push(JSON.parse(String(init?.body)));
      return json({ id: 'e' });
    }
    calls.push({ method: init?.method ?? 'GET', url, auth: headers.Authorization ?? null, form });
    const path = url.pathname;
    if (path === '/refresh_access_token') return json(ig.refresh?.json ?? { access_token: 'IGAAnewtoken0123456789abcdefghijklmnopqrstu', expires_in: 5184000 }, ig.refresh?.status ?? 200);
    if (init?.method === 'POST' && path.endsWith('/media')) {
      if (ig.failCreate) return json({ error: { message: ig.failCreate.message ?? 'Bad media', code: ig.failCreate.status >= 500 ? 2 : 9004 } }, ig.failCreate.status);
      const id = `C${++containers}`;
      ig.statuses[id] ??= 'FINISHED';
      return json({ id });
    }
    if (init?.method === 'POST' && path.endsWith('/media_publish')) {
      if (ig.failPublish) return json({ error: { message: ig.failPublish.message ?? 'Publish failed', code: 1 } }, ig.failPublish.status);
      return json({ id: `M-${form.creation_id}` });
    }
    if (path.endsWith('/insights')) return json({ data: Object.entries(ig.insights ?? { views: 10, reach: 5 }).map(([name, value]) => ({ name, values: [{ value }] })) });
    if (url.searchParams.get('fields')?.startsWith('status_code')) return json({ status_code: ig.statuses[path.split('/').pop()!] ?? 'IN_PROGRESS' });
    if (url.searchParams.get('fields') === 'permalink') return json({ permalink: `https://www.instagram.com/p/${path.split('/').pop()}/`, id: 'x' });
    return json({ error: { message: 'unexpected' } }, 404);
  }) as typeof fetch;
  const posts = () => calls.filter((c) => c.method === 'POST');
  return { f, calls, emails, ig, containersCreated: () => posts().filter((c) => c.url.pathname.endsWith('/media')).length, publishCalls: () => posts().filter((c) => c.url.pathname.endsWith('/media_publish')).length };
}

const deps = (store: PublisherStore) => ({ store, sleep: async () => {}, nowMs: () => 0 });
const run = (env: SocialEnv, net: ReturnType<typeof fakeNet>, store: PublisherStore) => runPublisher(env, net.f, NOW, deps(store));

describe('runPublisher', () => {
  it('does nothing while paused', async () => {
    const m = memoryStore({ posts: [mkPost()], settings: settings({ paused: true }) });
    const net = fakeNet();
    expect(await run(ENV, net, m.store)).toMatchObject({ ok: true, paused: true });
    expect(net.calls).toHaveLength(0);
    expect(m.posts.get('p1')!.status).toBe('scheduled');
  });

  it('publishes a due post end to end and emails the permalink', async () => {
    const m = memoryStore({ posts: [mkPost()] });
    const net = fakeNet();
    const out = await run(ENV, net, m.store);
    expect(out).toMatchObject({ ok: true, published: 1 });
    const p = m.posts.get('p1')!;
    expect(p).toMatchObject({ status: 'published', ig_media_id: 'M-C1', ig_permalink: 'https://www.instagram.com/p/M-C1/', ig_container_id: 'C1' });
    expect(p.published_at).toBe(NOW.toISOString());
    expect(m.events.map((e) => e.event)).toEqual(['container_created', 'published']);
    expect(net.emails).toHaveLength(1);
    expect(net.emails[0]!.text).toContain('https://www.instagram.com/p/M-C1/');
    // all Instagram calls carried the env token (no social_auth row) in the header
    expect(net.calls.every((c) => c.auth === `Bearer ${ENV_TOKEN}`)).toBe(true);
  });

  it('skips the success email when notify_email is off', async () => {
    const m = memoryStore({ posts: [mkPost()], settings: settings({ notify_email: false }) });
    const net = fakeNet();
    await run(ENV, net, m.store);
    expect(m.posts.get('p1')!.status).toBe('published');
    expect(net.emails).toHaveLength(0);
  });

  it('ignores posts that are not due yet and handles at most MAX_POSTS_PER_RUN per run, oldest first', async () => {
    const posts = Array.from({ length: 7 }, (_, i) => mkPost({ id: `p${i}`, scheduled_at: `2026-11-02T1${i}:00:00Z` }));
    posts.push(mkPost({ id: 'future', scheduled_at: '2026-11-03T00:00:00Z' }));
    const m = memoryStore({ posts });
    const net = fakeNet();
    await run(ENV, net, m.store);
    expect(net.containersCreated()).toBe(MAX_POSTS_PER_RUN);
    expect(posts.slice(0, MAX_POSTS_PER_RUN).every((p) => m.posts.get(p.id)!.status === 'published')).toBe(true);
    expect(m.posts.get(`p${MAX_POSTS_PER_RUN}`)!.status).toBe('scheduled');
    expect(m.posts.get('future')!.status).toBe('scheduled');
  });

  it('leaves an IN_PROGRESS container as publishing, and the next run finishes it without a second container', async () => {
    const m = memoryStore({ posts: [mkPost({ type: 'reel' })], media: { p1: [mp4] } });
    const net = fakeNet({ statuses: { C1: 'IN_PROGRESS' } });
    const first = await run(ENV, net, m.store);
    expect(first.waiting).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'publishing', ig_container_id: 'C1', ig_media_id: null });
    expect(net.publishCalls()).toBe(0);

    net.ig.statuses.C1 = 'FINISHED';
    const second = await run(ENV, net, m.store);
    expect(second.published).toBe(1);
    expect(net.containersCreated()).toBe(1);
    expect(net.publishCalls()).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'published', ig_media_id: 'M-C1' });
  });

  it('polls within the run: IN_PROGRESS then FINISHED publishes in the same run', async () => {
    const m = memoryStore({ posts: [mkPost({ type: 'reel' })], media: { p1: [mp4] } });
    const net = fakeNet({ statuses: { C1: 'IN_PROGRESS' } });
    let sleeps = 0;
    const out = await runPublisher(ENV, net.f, NOW, {
      store: m.store,
      nowMs: () => 0,
      sleep: async () => {
        if (++sleeps === 2) net.ig.statuses.C1 = 'FINISHED';
      },
    });
    expect(out.published).toBe(1);
    expect(sleeps).toBe(2);
  });

  it('stops polling when the time budget is used up', async () => {
    const m = memoryStore({ posts: [mkPost({ type: 'reel' })], media: { p1: [mp4] } });
    const net = fakeNet({ statuses: { C1: 'IN_PROGRESS' } });
    let t = 0;
    const out = await runPublisher(ENV, net.f, NOW, { store: m.store, nowMs: () => (t += 20_000), sleep: async () => {} });
    expect(out.waiting).toBe(1);
    expect(m.posts.get('p1')!.status).toBe('publishing');
  });

  it('moves a post whose checks fail to review, never publishes it, and emails the owner', async () => {
    const m = memoryStore({ posts: [mkPost({ caption: 'Get the 30% federal tax credit today!' })] });
    const net = fakeNet();
    const out = await run(ENV, net, m.store);
    expect(out.sentToReview).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'review', checks_passed: false });
    expect(net.calls).toHaveLength(0);
    expect(m.events.map((e) => e.event)).toEqual(['checks_failed']);
    expect(net.emails).toHaveLength(1);
    expect(net.emails[0]!.subject).toMatch(/held for review/);
  });

  it('retries after a processing ERROR: back to scheduled in 15 minutes with the container cleared', async () => {
    const m = memoryStore({ posts: [mkPost()] });
    const net = fakeNet({ statuses: { C1: 'ERROR' } });
    const out = await run(ENV, net, m.store);
    expect(out.retried).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'scheduled', attempts: 1, ig_container_id: null, scheduled_at: new Date(NOW.getTime() + 15 * 60_000).toISOString() });
    expect(m.posts.get('p1')!.last_error).toMatch(/could not process/);
    expect(net.emails).toHaveLength(0);
  });

  it('gives up as failed (with an email) once attempts reach the maximum', async () => {
    const m = memoryStore({ posts: [mkPost({ attempts: 2 })] });
    const net = fakeNet({ statuses: { C1: 'EXPIRED' } });
    const out = await run(ENV, net, m.store);
    expect(out.failed).toBe(1);
    expect(m.posts.get('p1')).toMatchObject({ status: 'failed', attempts: 3 });
    expect(net.emails.map((e) => e.subject)).toEqual([expect.stringMatching(/post failed/)]);
  });

  it('treats an API failure creating the container like any other failed attempt', async () => {
    const m = memoryStore({ posts: [mkPost()] });
    const net = fakeNet({ statuses: {}, failCreate: { status: 400, message: 'Media URL not reachable' } });
    await run(ENV, net, m.store);
    expect(m.posts.get('p1')).toMatchObject({ status: 'scheduled', attempts: 1 });
    expect(m.posts.get('p1')!.last_error).toContain('Media URL not reachable');
  });

  it('never calls media_publish for a post that already has ig_media_id', async () => {
    const m = memoryStore({ posts: [mkPost({ status: 'publishing', ig_container_id: 'C9', ig_media_id: 'M9' })] });
    const net = fakeNet({ statuses: { C9: 'FINISHED' } });
    await run(ENV, net, m.store);
    expect(net.publishCalls()).toBe(0);
    expect(m.posts.get('p1')).toMatchObject({ status: 'published', ig_media_id: 'M9' });
  });

  it('two overlapping runs publish a FINISHED container once', async () => {
    const m = memoryStore({ posts: [mkPost({ status: 'publishing', ig_container_id: 'C9', updated_at: 'v0' })] });
    const net = fakeNet({ statuses: { C9: 'FINISHED' } });
    await Promise.all([run(ENV, net, m.store), run(ENV, net, m.store)]);
    expect(net.publishCalls()).toBe(1);
    expect(m.posts.get('p1')!.status).toBe('published');
  });

  it('two overlapping runs create one container for a scheduled post', async () => {
    const m = memoryStore({ posts: [mkPost()] });
    const net = fakeNet();
    await Promise.all([run(ENV, net, m.store), run(ENV, net, m.store)]);
    expect(net.containersCreated()).toBe(1);
    expect(net.publishCalls()).toBe(1);
  });

  it('does not open a second container after an ambiguous media_publish failure', async () => {
    const m = memoryStore({ posts: [mkPost()] });
    const net = fakeNet({ statuses: {}, failPublish: { status: 500 } });
    await run(ENV, net, m.store);
    expect(m.posts.get('p1')).toMatchObject({ status: 'publishing', attempts: 1, ig_container_id: 'C1' });
    await run(ENV, net, m.store); // still FINISHED: tries media_publish again on the same container
    expect(net.containersCreated()).toBe(1);
  });

  it('fails (no retry) a container Instagram reports as already PUBLISHED without a recorded media id', async () => {
    const m = memoryStore({ posts: [mkPost({ status: 'publishing', ig_container_id: 'C9' })] });
    const net = fakeNet({ statuses: { C9: 'PUBLISHED' } });
    await run(ENV, net, m.store);
    expect(m.posts.get('p1')!.status).toBe('failed');
    expect(net.publishCalls()).toBe(0);
  });

  it('retries a publishing post that was claimed but never got a container, once the claim is stale', async () => {
    const stale = mkPost({ status: 'publishing', updated_at: '2026-11-02T17:00:00Z' });
    const m = memoryStore({ posts: [stale] });
    const net = fakeNet();
    await run(ENV, net, m.store);
    expect(m.posts.get('p1')).toMatchObject({ status: 'scheduled', attempts: 1 });
    const fresh = memoryStore({ posts: [mkPost({ status: 'publishing', updated_at: '2026-11-02T17:55:00Z' })] });
    await run(ENV, net, fresh.store);
    expect(fresh.posts.get('p1')!.status).toBe('publishing');
  });

  it('dry run: no Instagram POSTs, posts are not moved, an event says what would happen', async () => {
    const m = memoryStore({ posts: [mkPost()] });
    const net = fakeNet();
    const out = await run({ ...ENV, SOCIAL_DRY_RUN: '1' }, net, m.store);
    expect(out.dryRun).toBe(true);
    expect(net.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(m.posts.get('p1')).toMatchObject({ status: 'scheduled', attempts: 0, ig_container_id: null });
    expect(m.events).toEqual([{ post_id: 'p1', event: 'dry_run', detail: expect.objectContaining({ would: 'create_container_and_publish' }) }]);
    expect(net.emails).toHaveLength(0);
  });

  it('dry run does not call media_publish for a finished container either', async () => {
    const m = memoryStore({ posts: [mkPost({ status: 'publishing', ig_container_id: 'C9' })] });
    const net = fakeNet({ statuses: { C9: 'FINISHED' } });
    await run({ ...ENV, SOCIAL_DRY_RUN: '1' }, net, m.store);
    expect(net.publishCalls()).toBe(0);
    expect(m.posts.get('p1')!.status).toBe('publishing');
  });

  it('never leaks the token into last_error, events or emails', async () => {
    const leak = `Invalid token ${ENV_TOKEN} access_token=${ENV_TOKEN}`;
    const m = memoryStore({ posts: [mkPost({ attempts: 2 })] });
    const net = fakeNet({ statuses: {}, failCreate: { status: 400, message: leak } });
    await run(ENV, net, m.store);
    const everything = JSON.stringify([m.posts.get('p1'), m.events, net.emails]);
    expect(everything).not.toContain(ENV_TOKEN);
    expect(m.posts.get('p1')!.status).toBe('failed');
  });

  it('uses the stored token over the env token', async () => {
    const m = memoryStore({ posts: [mkPost()], auth: { access_token: DB_TOKEN, expires_at: null, refreshed_at: '2026-10-30T00:00:00Z' } });
    const net = fakeNet();
    await run(ENV, net, m.store);
    expect(net.calls.every((c) => c.auth === `Bearer ${DB_TOKEN}`)).toBe(true);
  });

  it('reports an error and touches nothing when there is no token', async () => {
    const m = memoryStore({ posts: [mkPost()] });
    const net = fakeNet();
    const out = await run({ ...ENV, IG_ACCESS_TOKEN: undefined }, net, m.store);
    expect(out.ok).toBe(false);
    expect(m.posts.get('p1')!.status).toBe('scheduled');
  });
});

describe('token', () => {
  it('currentToken prefers the social_auth row and falls back to the env var', async () => {
    const withRow = memoryStore({ posts: [], auth: { access_token: DB_TOKEN, expires_at: null, refreshed_at: 'x' } });
    expect(await currentToken(ENV, withRow.store)).toMatchObject({ token: DB_TOKEN, source: 'db' });
    const none = memoryStore({ posts: [] });
    expect(await currentToken(ENV, none.store)).toMatchObject({ token: ENV_TOKEN, source: 'env' });
    expect(await currentToken({ ...ENV, IG_ACCESS_TOKEN: undefined }, none.store)).toBeNull();
  });

  it('does not refresh a stored token younger than 24 hours', async () => {
    const m = memoryStore({ posts: [], auth: { access_token: DB_TOKEN, expires_at: '2026-12-20T00:00:00Z', refreshed_at: '2026-11-02T10:00:00Z' } });
    const net = fakeNet();
    expect(await runTokenRefresh(ENV, net.f, NOW, deps(m.store))).toMatchObject({ skipped: expect.stringMatching(/24h/) });
    expect(net.calls).toHaveLength(0);
  });

  it('refreshes a token 24h+ old and stores the new token and expiry', async () => {
    const m = memoryStore({ posts: [], auth: { access_token: DB_TOKEN, expires_at: '2026-12-01T00:00:00Z', refreshed_at: '2026-11-01T17:00:00Z' } });
    const net = fakeNet();
    expect(await runTokenRefresh(ENV, net.f, NOW, deps(m.store))).toMatchObject({ refreshed: true, source: 'db' });
    expect(net.calls[0]!.url.searchParams.get('access_token')).toBe(DB_TOKEN);
    expect(m.state.auth).toEqual({ access_token: 'IGAAnewtoken0123456789abcdefghijklmnopqrstu', expires_at: new Date(NOW.getTime() + 5184000 * 1000).toISOString(), refreshed_at: NOW.toISOString() });
  });

  it('bootstraps from the env token when no row exists', async () => {
    const m = memoryStore({ posts: [] });
    const net = fakeNet();
    expect(await runTokenRefresh(ENV, net.f, NOW, deps(m.store))).toMatchObject({ refreshed: true, source: 'env' });
    expect(m.state.auth?.access_token).toContain('IGAAnewtoken');
  });

  const failing = { refresh: { status: 400, json: { error: { message: 'Cannot refresh', code: 10 } } }, statuses: {} };
  it('emails the owner when refresh fails and expiry is within 10 days or unknown', async () => {
    const soon = memoryStore({ posts: [], auth: { access_token: DB_TOKEN, expires_at: '2026-11-08T00:00:00Z', refreshed_at: '2026-10-01T00:00:00Z' } });
    const net1 = fakeNet(failing);
    expect(await runTokenRefresh(ENV, net1.f, NOW, deps(soon.store))).toMatchObject({ emailed: true });
    expect(net1.emails[0]!.text).toContain('IG_ACCESS_TOKEN');
    expect(JSON.stringify(net1.emails)).not.toContain(DB_TOKEN);

    const unknown = memoryStore({ posts: [] });
    const net2 = fakeNet(failing);
    expect(await runTokenRefresh(ENV, net2.f, NOW, deps(unknown.store))).toMatchObject({ emailed: true });
    expect(JSON.stringify(net2.emails)).not.toContain(ENV_TOKEN);
  });

  it('stays quiet when refresh fails but the token is good for more than 10 days', async () => {
    const m = memoryStore({ posts: [], auth: { access_token: DB_TOKEN, expires_at: '2026-12-20T00:00:00Z', refreshed_at: '2026-10-01T00:00:00Z' } });
    const net = fakeNet(failing);
    const out = await runTokenRefresh(ENV, net.f, NOW, deps(m.store));
    expect(out.error).toBeTruthy();
    expect(out.emailed).toBeUndefined();
    expect(net.emails).toHaveLength(0);
  });
});

describe('runInsightsSync', () => {
  const published = (over: Partial<SocialPost>) => mkPost({ status: 'published', ig_media_id: 'M1', published_at: '2026-10-30T00:00:00Z', ...over });

  it('stores flat metric numbers and a timestamp for recently published posts only', async () => {
    const m = memoryStore({ posts: [published({ id: 'a' }), published({ id: 'old', published_at: '2026-09-01T00:00:00Z' })] });
    const net = fakeNet({ statuses: {}, insights: { views: 100, reach: 60 } });
    const out = await runInsightsSync(ENV, net.f, NOW, deps(m.store));
    expect(out).toMatchObject({ ok: true, checked: 1, updated: 1 });
    expect(m.posts.get('a')).toMatchObject({ insights: { views: 100, reach: 60 }, insights_at: NOW.toISOString() });
    expect(m.posts.get('old')!.insights).toBeNull();
    expect(net.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('skips stories older than 24 hours (Instagram only keeps their insights that long)', async () => {
    const m = memoryStore({ posts: [published({ id: 's', type: 'story' })] });
    const net = fakeNet();
    expect(await runInsightsSync(ENV, net.f, NOW, deps(m.store))).toMatchObject({ checked: 0, skipped: 1 });
    expect(net.calls).toHaveLength(0);
  });
});
