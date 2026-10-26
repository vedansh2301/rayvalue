/**
 * Social publisher (SERVER ONLY): Instagram and a Facebook Page. Three jobs, each called by a cronGuard-protected route
 * that GitHub Actions hits (see .github/workflows/social-cron.yml): runPublisher (every 15 min), runTokenRefresh and
 * runInsightsSync (daily).
 *
 * A post lists its channels (social_posts.channels). Each channel keeps its own result (ig_* / fb_* columns, own
 * attempts and last_error); the post is 'published' only when every channel has its id, and 'failed' (with the ids
 * that did publish kept) when a channel runs out of attempts. A retry therefore only ever re-runs the missing channel.
 *
 * Safety rules the code enforces:
 * - Nothing goes out while social_settings.paused. Checks are re-run right before publishing; a failing post goes
 *   to "review" (never published) with an event row and an owner email. A post that includes Facebook while the Page
 *   is not connected (FB_PAGE_ID / FB_PAGE_TOKEN) also goes to "review" and nothing is published to either channel.
 * - Every status change is a conditional update (filter on the current status; media_publish also on the row
 *   version), so two overlapping runs cannot both create a container or both call media_publish for one post.
 * - A channel that already has its id (ig_media_id / fb_post_id) is never published again.
 * - If Instagram's media_publish fails in a way that could still have succeeded (timeout, 5xx) the post is NOT retried
 *   with a new container; it stays "publishing" and the next run reads the container status. A Facebook photo or
 *   multi-photo publish has no such container, so an ambiguous failure there is never retried automatically: the
 *   channel fails and the owner checks the Page first. A Facebook Reel is one video id; finishing it twice is harmless.
 * - Location tags (social_posts.location_key -> social_locations.fb_place_id) are best effort: Instagram gets
 *   `location_id` (image, Reel, carousel parent), Facebook `place` (photo, multi-photo, Reel). If either refuses the
 *   place, that call is made once more without it and a `location_dropped` event is logged; the post never fails
 *   because of its location.
 * - SOCIAL_DRY_RUN=1: every Instagram and Facebook write is blocked (also inside the clients); posts are not moved,
 *   an event row records what would have happened.
 * Secrets: tokens come from social_auth / IG_ACCESS_TOKEN and FB_PAGE_TOKEN, are sent only to the Meta hosts, and never
 * appear in events, emails, last_error or logs.
 */
import { runChecks, checksPassed } from '../social/checks';
import { createFacebookClient, FbError, facebookUnsupported, type FacebookClient } from '../social/facebook';
import { createInstagramClient, IgError, scrub, type InstagramClient } from '../social/instagram';
import { duePosts } from '../social/schedule';
import { MAX_ATTEMPTS, publisherCanMove } from '../social/status';
import type { Channel, SocialPost } from '../social/types';
import type { AdminEnv } from './admin-db';
import { sendEmail, type EmailEnv } from './email';
import { supabaseStore, type DuePost, type PostMedia, type PostWhere, type PublisherStore, type UpdateResult } from './social-publisher-store';

export interface SocialEnv extends AdminEnv, EmailEnv {
  IG_USER_ID?: string;
  /** Bootstrap token; once social_auth has a row, that row wins. */
  IG_ACCESS_TOKEN?: string;
  /** Facebook Page id and a non-expiring Page token from a Business Manager system user. Both unset = Facebook not connected. */
  FB_PAGE_ID?: string;
  FB_PAGE_TOKEN?: string;
  OWNER_EMAIL?: string;
  /** "1" = never write to Instagram or Facebook. */
  SOCIAL_DRY_RUN?: string;
  SITE_URL?: string;
}

/** The env the publisher reads (process.env only; never import.meta.env). */
export const socialEnv = (): SocialEnv => ({
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  OWNER_EMAIL: process.env.OWNER_EMAIL,
  IG_USER_ID: process.env.IG_USER_ID,
  IG_ACCESS_TOKEN: process.env.IG_ACCESS_TOKEN,
  FB_PAGE_ID: process.env.FB_PAGE_ID,
  FB_PAGE_TOKEN: process.env.FB_PAGE_TOKEN,
  SOCIAL_DRY_RUN: process.env.SOCIAL_DRY_RUN,
  SITE_URL: process.env.SITE_URL,
});

export interface PublisherDeps {
  store?: PublisherStore;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds clock for the polling budget (tests inject a fake). */
  nowMs?: () => number;
}

/** Kept small: starting a carousel (one container per photo) plus Reel uploads for 5 posts overran the 60 s route limit (2026-10-26). The rest wait for the next run. */
export const MAX_POSTS_PER_RUN = 2;
/** Total time one run may spend polling container status (the route allows 60s). */
export const POLL_BUDGET_MS = 45_000;
export const POLL_INTERVAL_MS = 10_000;
/** Hard cap on polling rounds regardless of the clock. */
export const MAX_POLL_ROUNDS = Math.floor(POLL_BUDGET_MS / POLL_INTERVAL_MS);
export const RETRY_DELAY_MS = 15 * 60_000;
/** A 'publishing' post with no container this long after its last change was interrupted. */
export const STALE_CLAIM_MS = 10 * 60_000;
/** A Facebook Reel that has not finished uploading / processing this long after its last change is given up on. */
export const FB_REEL_STALL_MS = 60 * 60_000;
export const TOKEN_MIN_AGE_MS = 24 * 3_600_000;
export const TOKEN_WARN_DAYS = 10;
export const INSIGHTS_DAYS = 30;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const isDryRun = (env: SocialEnv) => env.SOCIAL_DRY_RUN === '1';
const adminLink = (env: SocialEnv) => `${(env.SITE_URL || 'https://rayvalue.com').replace(/\/+$/, '')}/admin/social`;
const errText = (e: unknown, token?: string) => scrub(e instanceof IgError || e instanceof FbError ? e.message : e instanceof Error ? `Unexpected error (${e.name}).` : 'Unexpected error.', token).slice(0, 300);

/** Plain owner email; skipped silently when email or OWNER_EMAIL is not configured. */
async function notifyOwner(env: SocialEnv, fetchImpl: typeof fetch, subject: string, lines: string[]): Promise<void> {
  if (!env.OWNER_EMAIL) return;
  await sendEmail(env, { to: env.OWNER_EMAIL, subject, text: [...lines, '', `Social admin: ${adminLink(env)}`].join('\n') }, fetchImpl);
}

// ---------------------------------------------------------------------------------------------------- token

export interface CurrentToken {
  token: string;
  source: 'db' | 'env';
  expires_at: string | null;
  refreshed_at: string | null;
}

/** social_auth.access_token if a row exists, else the IG_ACCESS_TOKEN bootstrap. null when neither exists. */
export async function currentToken(env: SocialEnv, store: PublisherStore): Promise<CurrentToken | null> {
  const row = await store.loadAuth();
  if (row?.access_token) return { token: row.access_token, source: 'db', expires_at: row.expires_at, refreshed_at: row.refreshed_at };
  return env.IG_ACCESS_TOKEN ? { token: env.IG_ACCESS_TOKEN, source: 'env', expires_at: null, refreshed_at: null } : null;
}

export interface TokenOutcome {
  refreshed?: boolean;
  skipped?: string;
  error?: string;
  source?: 'db' | 'env';
  emailed?: boolean;
}

export async function runTokenRefresh(env: SocialEnv, fetchImpl: typeof fetch, now = new Date(), deps: PublisherDeps = {}): Promise<TokenOutcome> {
  const store = deps.store ?? supabaseStore(env, fetchImpl);
  const cur = await currentToken(env, store);
  if (!cur) return { skipped: 'no token configured' };
  if (cur.source === 'db' && cur.refreshed_at && now.getTime() - new Date(cur.refreshed_at).getTime() < TOKEN_MIN_AGE_MS) return { skipped: 'token refreshed less than 24h ago', source: 'db' };

  const client = createInstagramClient({ token: cur.token, userId: env.IG_USER_ID ?? '', fetch: fetchImpl });
  try {
    const next = await client.refreshToken();
    const expires = next.expiresInSeconds !== null ? new Date(now.getTime() + next.expiresInSeconds * 1000).toISOString() : null;
    const saved = await store.saveAuth({ access_token: next.accessToken, expires_at: expires, refreshed_at: now.toISOString() });
    if (!saved) {
      // The old token is still valid for now; say so rather than silently losing the new one.
      await store.logEvent(null, 'token_save_failed');
      await notifyOwner(env, fetchImpl, 'RayValue Instagram: token refreshed but not saved', ['Instagram refreshed the access token but it could not be stored. The old token still works for now; the next daily run will try again.']);
      return { error: 'could not store the refreshed token', source: cur.source, emailed: true };
    }
    await store.logEvent(null, 'token_refreshed', { source: cur.source, expires_at: expires });
    return { refreshed: true, source: cur.source };
  } catch (e) {
    const msg = errText(e, cur.token);
    const daysLeft = cur.expires_at ? (new Date(cur.expires_at).getTime() - now.getTime()) / 86_400_000 : null;
    await store.logEvent(null, 'token_refresh_failed', { error: msg, days_left: daysLeft === null ? null : Math.floor(daysLeft) });
    if (daysLeft !== null && daysLeft > TOKEN_WARN_DAYS) return { error: msg, source: cur.source };
    await notifyOwner(env, fetchImpl, 'RayValue Instagram: access token needs attention', [
      daysLeft === null ? 'The Instagram access token could not be refreshed and its expiry date is unknown.' : `The Instagram access token could not be refreshed and expires in about ${Math.max(0, Math.floor(daysLeft))} days.`,
      `Reason: ${msg}`,
      '',
      'To fix it:',
      '1. Meta developer dashboard > your app > Instagram > API setup with Instagram login > generate a token for rayvalue_usa.',
      '2. Set it as IG_ACCESS_TOKEN in Vercel (Production and Preview) and redeploy.',
      '3. In the Supabase SQL editor run: delete from public.social_auth;  (the stored token takes priority over the env var until removed).',
      'Posting stops when the token expires.',
    ]);
    return { error: msg, source: cur.source, emailed: true };
  }
}

// ---------------------------------------------------------------------------------------------------- publish

export interface PublishOutcome {
  ok: boolean;
  dryRun?: boolean;
  paused?: boolean;
  error?: string;
  /** Set when Facebook is not connected (FB_PAGE_ID / FB_PAGE_TOKEN missing): posts that include Facebook go to review. */
  facebook?: string;
  due?: number;
  published?: number;
  waiting?: number;
  sentToReview?: number;
  retried?: number;
  failed?: number;
  skipped?: number;
}

const LABEL: Record<Channel, string> = { instagram: 'Instagram', facebook: 'Facebook' };
export const FB_NOT_CONNECTED = 'Facebook Page not connected';

const channelsOf = (p: Pick<SocialPost, 'channels'>): Channel[] => (Array.isArray(p.channels) && p.channels.length ? p.channels : ['instagram']);
const idFor = (p: SocialPost, ch: Channel) => (ch === 'instagram' ? p.ig_media_id : p.fb_post_id);
const permalinkFor = (p: SocialPost, ch: Channel) => (ch === 'instagram' ? p.ig_permalink : p.fb_permalink);
const attemptsFor = (p: SocialPost, ch: Channel) => (ch === 'instagram' ? p.attempts : p.fb_attempts) ?? 0;
const errorFor = (p: SocialPost, ch: Channel) => (ch === 'instagram' ? p.last_error : p.fb_last_error);
/** A channel with no id and no attempts left: the owner has to retry it from the admin (which resets the attempts). */
const isDead = (p: SocialPost, ch: Channel) => !idFor(p, ch) && attemptsFor(p, ch) >= MAX_ATTEMPTS;

/** What happened to one channel of one post during this run. */
type Res =
  | { kind: 'waiting' }
  | { kind: 'done' }
  /** Another run owns it (or the database failed): leave the whole post alone. */
  | { kind: 'skipped' }
  /** The publish call failed in a way that may have succeeded: keep the container and look again next run. */
  | { kind: 'uncertain'; message: string }
  | { kind: 'fail'; message: string; noRetry?: boolean };

/** The verified place id of a post's location tag, or null (no tag, or the location has no verified id). */
export const placeIdOf = (p: DuePost): string | null => (p.location_key && p.location?.fb_place_id ? p.location.fb_place_id : null);

interface Job {
  post: DuePost;
  media: PostMedia[];
  /** The post's row version we last wrote (for compare-and-swap). */
  version: string;
  res: Partial<Record<Channel, Res>>;
  justDone: Channel[];
  /** A channel went live but the database would not record it: do not touch the post again this run. */
  unrecorded: boolean;
  finishCalled: boolean;
}

export async function runPublisher(env: SocialEnv, fetchImpl: typeof fetch, now = new Date(), deps: PublisherDeps = {}): Promise<PublishOutcome> {
  const store = deps.store ?? supabaseStore(env, fetchImpl);
  const sleep = deps.sleep ?? defaultSleep;
  const nowMs = deps.nowMs ?? Date.now;
  const startedMs = nowMs();
  const dry = isDryRun(env);
  const fbConnected = !!(env.FB_PAGE_ID && env.FB_PAGE_TOKEN);

  const settings = await store.loadSettings();
  if (!settings) return { ok: false, error: 'could not read social_settings' };
  if (settings.paused) return { ok: true, paused: true, dryRun: dry || undefined };

  const loaded = await store.loadDuePosts(now, 20);
  if (!loaded) return { ok: false, error: 'could not read posts' };
  const due = duePosts(loaded, now, MAX_POSTS_PER_RUN);
  const out: PublishOutcome = {
    ok: true,
    dryRun: dry || undefined,
    ...(fbConnected ? {} : { facebook: `not connected (${FB_NOT_CONNECTED}; set FB_PAGE_ID and FB_PAGE_TOKEN)` }),
    due: due.length,
    published: 0,
    waiting: 0,
    sentToReview: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
  };
  if (!due.length) return out;

  const cur = await currentToken(env, store);
  const igToken = cur?.token ?? '';
  const fbToken = env.FB_PAGE_TOKEN ?? '';
  const ig: InstagramClient | null = cur && env.IG_USER_ID ? createInstagramClient({ token: cur.token, userId: env.IG_USER_ID, fetch: fetchImpl, readOnly: dry, sleep }) : null;
  const fb: FacebookClient | null = fbConnected ? createFacebookClient({ token: fbToken, pageId: env.FB_PAGE_ID!, fetch: fetchImpl, readOnly: dry }) : null;
  const igError = !cur ? 'no Instagram token configured' : !env.IG_USER_ID ? 'IG_USER_ID is not set' : null;
  const tokenFor = (ch: Channel) => (ch === 'instagram' ? igToken : fbToken);

  const mediaByPost = await store.loadMedia(due.map((p) => p.id));
  if (!mediaByPost) return { ...out, ok: false, error: 'could not read post media' };

  const pending: { job: Job; ch: Channel }[] = [];
  const jobs: Job[] = [];
  const retryAt = new Date(now.getTime() + RETRY_DELAY_MS).toISOString();

  /** Every write to a post goes through here so the row version stays current for compare-and-swap. */
  async function write(job: Job, where: PostWhere, patch: Partial<SocialPost>): Promise<UpdateResult> {
    const r = await store.updatePost(job.post.id, where, patch);
    if (r !== 'error' && r !== 'nomatch') {
      job.version = r.updated_at;
      Object.assign(job.post, patch);
    }
    return r;
  }

  /** Records that a channel is live, immediately (so a later failure or crash cannot lose the id). */
  async function recordDone(job: Job, ch: Channel, id: string): Promise<Res> {
    let permalink = permalinkFor(job.post, ch);
    if (!permalink) {
      try {
        permalink = ch === 'instagram' ? await ig!.getPermalink(id) : await fb!.getPermalink(job.post.fb_video_id ?? id);
      } catch (e) {
        await store.logEvent(job.post.id, 'permalink_failed', { channel: ch, error: errText(e, tokenFor(ch)) });
      }
    }
    const patch: Partial<SocialPost> =
      ch === 'instagram'
        ? { ig_media_id: id, ig_permalink: permalink, last_error: null }
        : { fb_post_id: id, fb_permalink: permalink, fb_published_at: job.post.fb_published_at ?? now.toISOString(), fb_last_error: null };
    let r = await write(job, { status: 'publishing' }, patch);
    if (r === 'error') r = await write(job, { status: 'publishing' }, patch);
    if (r === 'error' || r === 'nomatch') {
      job.unrecorded = true;
      Object.assign(job.post, patch); // it IS live: never publish it again this run
      await store.logEvent(job.post.id, 'published_not_recorded', { channel: ch, id });
      await notifyOwner(env, fetchImpl, `RayValue ${LABEL[ch]}: published but not recorded`, [
        `A post went live on ${LABEL[ch]} (id ${id}${permalink ? `, ${permalink}` : ''}) but its status could not be saved. Check it in the admin before rescheduling anything.`,
      ]);
      return { kind: 'done' };
    }
    job.justDone.push(ch);
    return { kind: 'done' };
  }

  /** Location refused by a channel: logged, and the caller has already retried without it. */
  const locationDropped = (job: Job, ch: Channel) => async (message: string) => {
    await store.logEvent(job.post.id, 'location_dropped', { channel: ch, location_key: job.post.location_key, place_id: placeIdOf(job.post), error: scrub(message, tokenFor(ch)).slice(0, 300) });
  };
  const igOpts = (job: Job) => ({ locationId: placeIdOf(job.post), onLocationRejected: locationDropped(job, 'instagram') });
  const fbOpts = (job: Job) => ({ place: placeIdOf(job.post), onPlaceRejected: locationDropped(job, 'facebook') });

  // -------------------------------------------------- Instagram steps

  /** Creates the container (carousel: children first) and remembers its id. */
  async function startIg(job: Job): Promise<Res> {
    let containerId: string;
    try {
      containerId = await ig!.createContainer(job.post, job.media, igOpts(job));
    } catch (e) {
      return { kind: 'fail', message: errText(e, igToken) };
    }
    await write(job, { status: 'publishing' }, { ig_container_id: containerId });
    await store.logEvent(job.post.id, 'container_created', { container_id: containerId });
    pending.push({ job, ch: 'instagram' });
    return { kind: 'waiting' };
  }

  /** FINISHED container: claim the row version, then media_publish (never when ig_media_id already exists). */
  async function publishIg(job: Job, containerId: string): Promise<Res> {
    if (job.post.ig_media_id) return { kind: 'done' };
    if (dry) {
      await store.logEvent(job.post.id, 'dry_run', { would: 'media_publish', container_id: containerId });
      return { kind: 'waiting' };
    }
    const claim = await write(job, { status: 'publishing', updated_at: job.version }, { last_error: null });
    if (claim === 'error' || claim === 'nomatch') return { kind: 'skipped' }; // another run is publishing this post (or the database is down)
    let mediaId: string;
    try {
      mediaId = await ig!.publishContainer(containerId);
    } catch (e) {
      const msg = errText(e, igToken);
      return e instanceof IgError && (e.status === 0 || e.status >= 500) ? { kind: 'uncertain', message: msg } : { kind: 'fail', message: msg };
    }
    return recordDone(job, 'instagram', mediaId);
  }

  async function advanceIg(job: Job): Promise<Res> {
    const containerId = job.post.ig_container_id!;
    let status: Awaited<ReturnType<InstagramClient['getContainerStatus']>>;
    try {
      status = await ig!.getContainerStatus(containerId);
    } catch (e) {
      if (e instanceof IgError && e.transient) return { kind: 'waiting' }; // a hiccup reading the status is not the post's fault
      return { kind: 'fail', message: errText(e, igToken) };
    }
    if (status.status === 'FINISHED') return publishIg(job, containerId);
    if (status.status === 'IN_PROGRESS') return { kind: 'waiting' };
    // Already live but we hold no media id: media_publish must not be called again.
    if (status.status === 'PUBLISHED') return { kind: 'fail', noRetry: true, message: 'Instagram says this post is already published but its id was not recorded. Check the account before rescheduling.' };
    return { kind: 'fail', message: `Instagram could not process the media (${status.status}${status.detail ? `: ${status.detail}` : ''}).` };
  }

  // -------------------------------------------------- Facebook steps

  /** Photo / multi-photo publish is one non-repeatable call; Reels upload first and finish on a later poll. */
  async function startFb(job: Job): Promise<Res> {
    const { post, media } = job;
    const unsupported = facebookUnsupported(post, media);
    if (unsupported) return { kind: 'fail', noRetry: true, message: unsupported };
    try {
      if (post.type === 'image') {
        const r = await fb!.publishPhoto(media[0]!.public_url, post.caption, fbOpts(job));
        return recordDone(job, 'facebook', r.postId);
      }
      if (post.type === 'carousel') {
        const r = await fb!.publishMultiPhoto(media.map((m) => m.public_url), post.caption, fbOpts(job));
        return recordDone(job, 'facebook', r.postId);
      }
    } catch (e) {
      if (e instanceof FbError && e.ambiguous) {
        return { kind: 'fail', noRetry: true, message: `${errText(e, fbToken)} Facebook did not confirm whether the post went live. Check the Page, then use Retry only if it is not there.` };
      }
      return { kind: 'fail', message: errText(e, fbToken) };
    }
    // Reel: open the upload session, remember the video id, then let Facebook fetch the hosted file.
    let videoId: string;
    try {
      videoId = await fb!.startReel();
    } catch (e) {
      return { kind: 'fail', message: errText(e, fbToken) };
    }
    await write(job, { status: 'publishing' }, { fb_video_id: videoId });
    await store.logEvent(post.id, 'fb_reel_started', { video_id: videoId });
    try {
      await fb!.uploadReelFromUrl(videoId, media[0]!.public_url);
    } catch (e) {
      return { kind: 'fail', message: errText(e, fbToken) };
    }
    pending.push({ job, ch: 'facebook' });
    return { kind: 'waiting' };
  }

  async function advanceFb(job: Job): Promise<Res> {
    const videoId = job.post.fb_video_id!;
    let st: Awaited<ReturnType<FacebookClient['getReelStatus']>>;
    try {
      st = await fb!.getReelStatus(videoId);
    } catch (e) {
      if (e instanceof FbError && e.transient) return { kind: 'waiting' };
      return { kind: 'fail', message: errText(e, fbToken) };
    }
    if (st.publishStatus === 'published') return recordDone(job, 'facebook', videoId);
    if (st.videoStatus === 'upload_failed' || st.videoStatus === 'error' || st.videoStatus === 'expired' || st.publishStatus === 'error') {
      return { kind: 'fail', message: `Facebook could not process the Reel (${st.videoStatus}${st.error ? `: ${st.error}` : ''}).` };
    }
    if (st.videoStatus === 'upload_complete' || st.videoStatus === 'ready') {
      if (dry) {
        await store.logEvent(job.post.id, 'dry_run', { would: 'finish_reel', video_id: videoId });
        return { kind: 'waiting' };
      }
      if (!job.finishCalled) {
        job.finishCalled = true;
        try {
          await fb!.finishReel(videoId, job.post.caption, fbOpts(job));
        } catch (e) {
          if (e instanceof FbError && e.transient) return { kind: 'waiting' }; // same video id: safe to repeat next run
          return { kind: 'fail', message: errText(e, fbToken) };
        }
        await store.logEvent(job.post.id, 'fb_reel_finish', { video_id: videoId });
      }
      return { kind: 'waiting' };
    }
    const changed = new Date(job.version).getTime();
    if (Number.isFinite(changed) && now.getTime() - changed > FB_REEL_STALL_MS) return { kind: 'fail', message: 'Facebook did not finish processing the Reel in time.' };
    return { kind: 'waiting' };
  }

  // -------------------------------------------------- starting / resuming one channel of a job

  async function start(job: Job, ch: Channel): Promise<void> {
    job.res[ch] = await (ch === 'instagram' ? startIg(job) : startFb(job));
  }

  /** A channel of a post that is already 'publishing' (a previous run began it). */
  async function resume(job: Job, ch: Channel): Promise<void> {
    const post = job.post;
    if (idFor(post, ch)) {
      job.res[ch] = { kind: 'done' };
      if (!permalinkFor(post, ch) && (ch === 'instagram' ? ig : fb)) {
        try {
          const link = ch === 'instagram' ? await ig!.getPermalink(idFor(post, ch)!) : await fb!.getPermalink(post.fb_video_id ?? idFor(post, ch)!);
          if (link) await write(job, { status: 'publishing' }, ch === 'instagram' ? { ig_permalink: link } : { fb_permalink: link });
        } catch (e) {
          await store.logEvent(post.id, 'permalink_failed', { channel: ch, error: errText(e, tokenFor(ch)) });
        }
      }
      return;
    }
    if (isDead(post, ch)) return;
    if (ch === 'instagram' ? post.ig_container_id : post.fb_video_id) {
      pending.push({ job, ch });
      job.res[ch] = { kind: 'waiting' };
      return;
    }
    // Nothing started yet for this channel.
    if (errorFor(post, ch) !== null && post.scheduled_at !== null && new Date(post.scheduled_at) <= now && !dry) {
      // A recorded, retryable failure while the other channel was still in progress: start again, in place.
      const claim = await write(job, { status: 'publishing', updated_at: job.version }, ch === 'instagram' ? { last_error: null } : { fb_last_error: null });
      if (claim === 'error' || claim === 'nomatch') job.res[ch] = { kind: 'skipped' };
      else await start(job, ch);
      return;
    }
    if (errorFor(post, ch) === null && now.getTime() - new Date(job.version).getTime() > STALE_CLAIM_MS && !dry) {
      // The run that claimed this post died before the channel got going.
      // A Facebook photo post may have gone live before the crash, so it is not repeated automatically.
      const risky = ch === 'facebook' && post.type !== 'reel';
      job.res[ch] = {
        kind: 'fail',
        noRetry: risky,
        message: risky
          ? 'Publishing was interrupted; Facebook may or may not have posted it. Check the Page, then use Retry only if it is not there.'
          : `Publishing was interrupted before ${LABEL[ch]} created ${ch === 'instagram' ? 'a container' : 'the upload'}.`,
      };
      return;
    }
    job.res[ch] = { kind: 'waiting' };
    out.skipped! += 1;
  }

  // -------------------------------------------------- settling a job after the polling rounds

  const permalinkLines = (post: SocialPost) =>
    channelsOf(post).map((ch) => `${LABEL[ch]}: ${permalinkFor(post, ch) ?? 'no link returned yet; find it on the account.'}`);

  async function settle(job: Job): Promise<void> {
    const post = job.post;
    if (job.unrecorded) return;
    const chs = channelsOf(post);
    if (chs.some((ch) => job.res[ch]?.kind === 'skipped')) {
      out.skipped! += 1;
      return;
    }
    const patch: Partial<SocialPost> = {};
    const retry: Channel[] = [];
    const dead: Channel[] = [];
    const waiting: Channel[] = [];
    const messages: Partial<Record<Channel, string>> = {};
    const nextAttempts: Partial<Record<Channel, number>> = {};

    for (const ch of chs) {
      if (idFor(post, ch)) continue;
      const r = job.res[ch];
      if (!r || r.kind === 'waiting' || r.kind === 'done') {
        if (isDead(post, ch)) {
          dead.push(ch);
          messages[ch] = errorFor(post, ch) ?? 'No attempts left.';
        } else waiting.push(ch);
        continue;
      }
      if (r.kind === 'skipped') continue;
      const attempts = r.kind === 'fail' && r.noRetry ? Math.max(attemptsFor(post, ch) + 1, MAX_ATTEMPTS) : attemptsFor(post, ch) + 1;
      const last_error = r.message.slice(0, 1000);
      messages[ch] = r.message;
      nextAttempts[ch] = attempts;
      Object.assign(patch, ch === 'instagram' ? { attempts, last_error } : { fb_attempts: attempts, fb_last_error: last_error });
      if (r.kind === 'uncertain' && attempts < MAX_ATTEMPTS) {
        waiting.push(ch);
        await store.logEvent(post.id, 'publish_uncertain', { channel: ch, attempts, error: r.message });
      } else if (attempts >= MAX_ATTEMPTS) dead.push(ch);
      else {
        retry.push(ch);
        Object.assign(patch, ch === 'instagram' ? { ig_container_id: null } : { fb_video_id: null });
      }
    }

    const logChannels = async () => {
      for (const ch of job.justDone) await store.logEvent(post.id, 'channel_published', { channel: ch, id: idFor(post, ch), permalink: permalinkFor(post, ch) });
    };
    const firstFail = (list: Channel[]) => list[0]!;

    if (waiting.length) {
      if (retry.length) patch.scheduled_at = retryAt;
      if (Object.keys(patch).length) await write(job, { status: 'publishing' }, patch);
      for (const ch of retry) await store.logEvent(post.id, 'retry_pending', { channel: ch, attempts: nextAttempts[ch], error: messages[ch] });
      await logChannels();
      out.waiting! += 1;
      return;
    }

    if (retry.length) {
      if (!publisherCanMove('publishing', 'scheduled')) return;
      patch.status = 'scheduled';
      patch.scheduled_at = retryAt;
      const r = await write(job, { status: 'publishing' }, patch);
      if (r === 'error' || r === 'nomatch') return;
      const ch = firstFail(retry);
      await store.logEvent(post.id, 'retry_scheduled', { channel: ch, channels: retry, attempts: nextAttempts[ch], error: messages[ch], scheduled_at: retryAt });
      await logChannels();
      out.retried! += 1;
      return;
    }

    if (dead.length) {
      if (!publisherCanMove('publishing', 'failed')) return;
      patch.status = 'failed';
      const r = await write(job, { status: 'publishing' }, patch);
      if (r === 'error' || r === 'nomatch') return;
      const ch = firstFail(dead);
      await store.logEvent(post.id, 'failed', { channel: ch, channels: dead, attempts: nextAttempts[ch] ?? attemptsFor(post, ch), error: messages[ch] });
      await logChannels();
      out.failed! += 1;
      const okChannels = chs.filter((c) => idFor(post, c));
      await notifyOwner(env, fetchImpl, `RayValue social: post failed on ${dead.map((c) => LABEL[c]).join(' and ')} (${post.title || post.type})`, [
        `A scheduled ${post.type} post could not be published to ${dead.map((c) => LABEL[c]).join(' and ')}.`,
        ...dead.map((c) => `${LABEL[c]} failed: ${messages[c] ?? 'unknown error'}`),
        ...(okChannels.length ? [`It did publish to: ${okChannels.map((c) => `${LABEL[c]} (${permalinkFor(post, c) ?? 'no link'})`).join(', ')}. Retry will only try ${dead.map((c) => LABEL[c]).join(' and ')} again.`] : []),
        'It is marked Failed. Open it in the admin to fix and retry.',
      ]);
      return;
    }

    // Every channel has its id.
    if (!publisherCanMove('publishing', 'published')) return;
    const publishedPatch: Partial<SocialPost> = { status: 'published', published_at: post.published_at ?? now.toISOString() };
    let r = await write(job, { status: 'publishing' }, publishedPatch);
    if (r === 'error') r = await write(job, { status: 'publishing' }, publishedPatch);
    if (r === 'error' || r === 'nomatch') {
      await store.logEvent(post.id, 'published_not_recorded', { channels: chs });
      await notifyOwner(env, fetchImpl, 'RayValue social: published but not recorded', [`A post went live (${permalinkLines(post).join('; ')}) but its status could not be saved. Check it in the admin before rescheduling anything.`]);
      return;
    }
    await store.logEvent(post.id, 'published', {
      media_id: post.ig_media_id,
      permalink: post.ig_permalink,
      ...(chs.includes('facebook') ? { facebook: { post_id: post.fb_post_id, permalink: post.fb_permalink } } : {}),
    });
    out.published! += 1;
    if (settings!.notify_email) {
      await notifyOwner(env, fetchImpl, `RayValue social: published ${post.title || post.type}`, [`Your ${post.type} post is live.`, ...permalinkLines(post)]);
    }
  }

  // ---- 1. due posts: re-check, claim, start each missing channel
  for (const post of due) {
    const media = mediaByPost.get(post.id) ?? [];
    const job: Job = { post, media, version: post.updated_at, res: {}, justDone: [], unrecorded: false, finishCalled: false };
    const missing = channelsOf(post).filter((ch) => !idFor(post, ch) && !isDead(post, ch));
    const needs = (ch: Channel) => missing.includes(ch);

    // A channel we cannot talk to. Instagram: report and leave the post alone. Facebook (scheduled posts): review, below.
    if (needs('instagram') && !ig) {
      out.ok = false;
      out.error = igError ?? 'Instagram is not configured';
      out.skipped! += 1;
      continue;
    }

    if (post.status === 'publishing') {
      if (needs('facebook') && !fb) {
        out.skipped! += 1; // Page disconnected mid-publish: leave it for when it is back
        continue;
      }
      for (const ch of channelsOf(post)) await resume(job, ch);
      jobs.push(job);
      continue;
    }

    const checks = runChecks({ type: post.type, caption: post.caption, data_refs: post.data_refs, numbers_confirmed: post.numbers_confirmed, media, channels: channelsOf(post) });
    const passed = checksPassed(checks);
    if (!passed) {
      const failed = checks.filter((c) => !c.ok && c.level === 'error');
      if (dry) {
        await store.logEvent(post.id, 'dry_run', { would: 'move_to_review', failed: failed.map((c) => c.key) });
        out.skipped! += 1;
        continue;
      }
      if (!publisherCanMove('scheduled', 'review')) continue;
      const r = await store.updatePost(post.id, { status: 'scheduled' }, { status: 'review', checks, checks_passed: false });
      if (r === 'error' || r === 'nomatch') continue;
      await store.logEvent(post.id, 'checks_failed', { failed: failed.map((c) => ({ key: c.key, message: c.message })) });
      out.sentToReview! += 1;
      await notifyOwner(env, fetchImpl, `RayValue social: post held for review (${post.title || post.type})`, [
        'A scheduled post failed its final checks and was NOT published. It is waiting in Needs review.',
        ...failed.map((c) => `- ${c.message}`),
      ]);
      continue;
    }

    if (needs('facebook') && !fb) {
      // The owner chose to include Facebook: publishing only Instagram would silently drop it, so nothing goes out.
      if (dry) {
        await store.logEvent(post.id, 'dry_run', { would: 'move_to_review', reason: FB_NOT_CONNECTED });
        out.skipped! += 1;
        continue;
      }
      if (!publisherCanMove('scheduled', 'review')) continue;
      const r = await store.updatePost(post.id, { status: 'scheduled' }, { status: 'review', fb_last_error: FB_NOT_CONNECTED });
      if (r === 'error' || r === 'nomatch') continue;
      await store.logEvent(post.id, 'facebook_not_connected', { channels: channelsOf(post) });
      out.sentToReview! += 1;
      await notifyOwner(env, fetchImpl, `RayValue social: post held for review (${post.title || post.type})`, [
        `This post includes Facebook, but the Facebook Page is not connected (${FB_NOT_CONNECTED}), so it was NOT published to any channel. It is waiting in Needs review.`,
        'Connect the Page (docs/LAUNCH.md, Facebook Page section) or untick Facebook on the post, then schedule it again.',
      ]);
      continue;
    }

    if (dry) {
      await store.logEvent(post.id, 'dry_run', { would: 'create_container_and_publish', type: post.type, channels: missing, media: media.map((m) => m.public_url), share_to_feed: post.share_to_feed, thumb_offset_ms: post.thumb_offset_ms, location: placeIdOf(post) });
      out.skipped! += 1;
      continue;
    }

    if (!publisherCanMove('scheduled', 'publishing')) continue;
    const claim = await store.updatePost(post.id, { status: 'scheduled' }, { status: 'publishing', checks, checks_passed: true });
    if (claim === 'error' || claim === 'nomatch') {
      out.skipped! += 1;
      continue;
    }
    job.version = claim.updated_at;
    Object.assign(post, { status: 'publishing', checks, checks_passed: true });
    jobs.push(job);
    for (const ch of channelsOf(post)) {
      if (idFor(post, ch)) job.res[ch] = { kind: 'done' };
      else if (!isDead(post, ch)) await start(job, ch);
    }
  }

  // ---- 2. poll containers / Reel uploads (within the time budget), publish the finished ones
  let waiting = pending;
  for (let round = 0; waiting.length; round++) {
    const next: typeof pending = [];
    for (const item of waiting) {
      const res = await (item.ch === 'instagram' ? advanceIg(item.job) : advanceFb(item.job));
      item.job.res[item.ch] = res;
      if (res.kind === 'waiting') next.push(item);
    }
    waiting = next;
    if (!waiting.length || round + 1 >= MAX_POLL_ROUNDS || nowMs() - startedMs + POLL_INTERVAL_MS > POLL_BUDGET_MS) break;
    await sleep(POLL_INTERVAL_MS);
  }

  // ---- 3. one outcome per post
  for (const job of jobs) await settle(job);
  return out;
}

// ---------------------------------------------------------------------------------------------------- insights

export interface InsightsOutcome {
  ok: boolean;
  checked?: number;
  updated?: number;
  failed?: number;
  skipped?: number;
  error?: string;
  /** Set when Facebook insights were skipped because the Page is not connected. */
  facebook?: string;
}

export async function runInsightsSync(env: SocialEnv, fetchImpl: typeof fetch, now = new Date(), deps: PublisherDeps = {}): Promise<InsightsOutcome> {
  const store = deps.store ?? supabaseStore(env, fetchImpl);
  const posts = await store.loadPublishedSince(new Date(now.getTime() - INSIGHTS_DAYS * 86_400_000), 60);
  if (!posts) return { ok: false, error: 'could not read posts' };
  if (!posts.length) return { ok: true, checked: 0, updated: 0, failed: 0, skipped: 0 };
  const cur = await currentToken(env, store);
  const igClient: InstagramClient | null = cur && env.IG_USER_ID ? createInstagramClient({ token: cur.token, userId: env.IG_USER_ID, fetch: fetchImpl, readOnly: true }) : null;
  const fbClient: FacebookClient | null = env.FB_PAGE_ID && env.FB_PAGE_TOKEN ? createFacebookClient({ token: env.FB_PAGE_TOKEN, pageId: env.FB_PAGE_ID, fetch: fetchImpl, readOnly: true }) : null;

  const out: InsightsOutcome = { ok: true, checked: 0, updated: 0, failed: 0, skipped: 0 };
  if (!fbClient && posts.some((p) => p.fb_post_id)) out.facebook = `not connected (${FB_NOT_CONNECTED}); Facebook insights skipped`;
  if (!igClient && posts.some((p) => p.ig_media_id)) {
    const error = !cur ? 'no Instagram token configured' : 'IG_USER_ID is not set';
    if (!fbClient) return { ...out, ok: false, error };
    out.ok = false;
    out.error = error;
  }

  for (const post of posts) {
    // Story insights exist for 24 hours only; after that the request would just error.
    const expiredStory = post.type === 'story' && post.published_at && now.getTime() - new Date(post.published_at).getTime() > 24 * 3_600_000;

    if (post.ig_media_id && igClient) {
      if (expiredStory) out.skipped! += 1;
      else {
        out.checked! += 1;
        try {
          const insights = await igClient.getInsights(post.ig_media_id, post.type);
          if (!Object.keys(insights).length) out.skipped! += 1;
          else if ((await store.updatePost(post.id, { status: 'published' }, { insights, insights_at: now.toISOString() })) === 'error') out.failed! += 1;
          else out.updated! += 1;
        } catch (e) {
          out.failed! += 1;
          if (e instanceof IgError && e.code === 190) {
            out.ok = false;
            out.error = 'Instagram rejected the access token';
            break;
          }
        }
      }
    }

    // Facebook: Reels read the video id, photo posts the post id. Stories never go to Facebook.
    if (post.fb_post_id && fbClient && post.type !== 'story') {
      out.checked! += 1;
      try {
        const insights = await fbClient.getInsights(post.type === 'reel' ? (post.fb_video_id ?? post.fb_post_id) : post.fb_post_id, post.type);
        if (!Object.keys(insights).length) out.skipped! += 1;
        else if ((await store.updatePost(post.id, { status: 'published' }, { fb_insights: insights, fb_insights_at: now.toISOString() })) === 'error') out.failed! += 1;
        else out.updated! += 1;
      } catch (e) {
        out.failed! += 1;
        if (e instanceof FbError && e.code === 190) {
          out.ok = false;
          out.error = 'Facebook rejected the Page token';
          break;
        }
      }
    }
  }
  return out;
}
