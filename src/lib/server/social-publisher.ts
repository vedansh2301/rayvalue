/**
 * Instagram publisher (SERVER ONLY). Three jobs, each called by a cronGuard-protected route that GitHub Actions hits
 * (see .github/workflows/social-cron.yml): runPublisher (every 15 min), runTokenRefresh and runInsightsSync (daily).
 *
 * Safety rules the code enforces:
 * - Nothing goes out while social_settings.paused. Checks are re-run right before publishing; a failing post goes
 *   to "review" (never published) with an event row and an owner email.
 * - Every status change is a conditional update (filter on the current status; media_publish also on the row
 *   version), so two overlapping runs cannot both create a container or both call media_publish for one post.
 * - media_publish is never called for a post that already has ig_media_id.
 * - If media_publish fails in a way that could still have succeeded (timeout, 5xx) the post is NOT retried with a new
 *   container (that could post twice); it stays "publishing" and the next run reads the container status.
 * - SOCIAL_DRY_RUN=1: every Instagram write (container create, media_publish) is blocked; posts are not moved, an
 *   event row records what would have happened.
 * Secrets: the token comes from social_auth or IG_ACCESS_TOKEN, is sent only to graph.instagram.com, and never
 * appears in events, emails, last_error or logs.
 */
import { runChecks, checksPassed } from '../social/checks';
import { createInstagramClient, IgError, scrub, type InstagramClient } from '../social/instagram';
import { duePosts } from '../social/schedule';
import { MAX_ATTEMPTS, publisherCanMove } from '../social/status';
import type { SocialPost } from '../social/types';
import type { AdminEnv } from './admin-db';
import { sendEmail, type EmailEnv } from './email';
import { supabaseStore, type PostMedia, type PublisherStore } from './social-publisher-store';

export interface SocialEnv extends AdminEnv, EmailEnv {
  IG_USER_ID?: string;
  /** Bootstrap token; once social_auth has a row, that row wins. */
  IG_ACCESS_TOKEN?: string;
  OWNER_EMAIL?: string;
  /** "1" = never write to Instagram. */
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
  SOCIAL_DRY_RUN: process.env.SOCIAL_DRY_RUN,
  SITE_URL: process.env.SITE_URL,
});

export interface PublisherDeps {
  store?: PublisherStore;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds clock for the polling budget (tests inject a fake). */
  nowMs?: () => number;
}

export const MAX_POSTS_PER_RUN = 5;
/** Total time one run may spend polling container status (the route allows 60s). */
export const POLL_BUDGET_MS = 45_000;
export const POLL_INTERVAL_MS = 10_000;
/** Hard cap on polling rounds regardless of the clock. */
export const MAX_POLL_ROUNDS = Math.floor(POLL_BUDGET_MS / POLL_INTERVAL_MS);
export const RETRY_DELAY_MS = 15 * 60_000;
/** A 'publishing' post with no container this long after its last change was interrupted. */
export const STALE_CLAIM_MS = 10 * 60_000;
export const TOKEN_MIN_AGE_MS = 24 * 3_600_000;
export const TOKEN_WARN_DAYS = 10;
export const INSIGHTS_DAYS = 30;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const isDryRun = (env: SocialEnv) => env.SOCIAL_DRY_RUN === '1';
const adminLink = (env: SocialEnv) => `${(env.SITE_URL || 'https://rayvalue.com').replace(/\/+$/, '')}/admin/social`;
const errText = (e: unknown, token?: string) => scrub(e instanceof IgError ? e.message : e instanceof Error ? `Unexpected error (${e.name}).` : 'Unexpected error.', token).slice(0, 300);

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
  due?: number;
  published?: number;
  waiting?: number;
  sentToReview?: number;
  retried?: number;
  failed?: number;
  skipped?: number;
}

interface Work {
  post: SocialPost;
  media: PostMedia[];
  /** The post's row version we last wrote (for compare-and-swap). */
  version: string;
}

export async function runPublisher(env: SocialEnv, fetchImpl: typeof fetch, now = new Date(), deps: PublisherDeps = {}): Promise<PublishOutcome> {
  const store = deps.store ?? supabaseStore(env, fetchImpl);
  const sleep = deps.sleep ?? defaultSleep;
  const nowMs = deps.nowMs ?? Date.now;
  const startedMs = nowMs();
  const dry = isDryRun(env);

  const settings = await store.loadSettings();
  if (!settings) return { ok: false, error: 'could not read social_settings' };
  if (settings.paused) return { ok: true, paused: true, dryRun: dry || undefined };

  const loaded = await store.loadDuePosts(now, 20);
  if (!loaded) return { ok: false, error: 'could not read posts' };
  const due = duePosts(loaded, now, MAX_POSTS_PER_RUN);
  const out: PublishOutcome = { ok: true, dryRun: dry || undefined, due: due.length, published: 0, waiting: 0, sentToReview: 0, retried: 0, failed: 0, skipped: 0 };
  if (!due.length) return out;

  const cur = await currentToken(env, store);
  if (!cur || !env.IG_USER_ID) return { ...out, ok: false, error: !cur ? 'no Instagram token configured' : 'IG_USER_ID is not set' };
  const token = cur.token;
  const client = createInstagramClient({ token, userId: env.IG_USER_ID, fetch: fetchImpl, readOnly: dry, sleep });

  const mediaByPost = await store.loadMedia(due.map((p) => p.id));
  if (!mediaByPost) return { ...out, ok: false, error: 'could not read post media' };

  const pending: (Work & { containerId: string })[] = [];

  /** Retry later or give up, depending on attempts. `from` is the status the post must still have. */
  async function failPost(w: Work, message: string, opts: { noRetry?: boolean; keepPublishing?: boolean } = {}): Promise<void> {
    const attempts = w.post.attempts + 1;
    const last_error = message.slice(0, 1000);
    if (opts.keepPublishing && attempts < MAX_ATTEMPTS) {
      const r = await store.updatePost(w.post.id, { status: 'publishing' }, { attempts, last_error });
      if (r !== 'error' && r !== 'nomatch') w.version = r.updated_at;
      await store.logEvent(w.post.id, 'publish_uncertain', { attempts, error: message });
      out.waiting! += 1;
      return;
    }
    if (!opts.noRetry && attempts < MAX_ATTEMPTS) {
      if (!publisherCanMove('publishing', 'scheduled')) return;
      const scheduled_at = new Date(now.getTime() + RETRY_DELAY_MS).toISOString();
      const r = await store.updatePost(w.post.id, { status: 'publishing' }, { status: 'scheduled', attempts, last_error, scheduled_at, ig_container_id: null });
      if (r === 'error' || r === 'nomatch') return;
      await store.logEvent(w.post.id, 'retry_scheduled', { attempts, error: message, scheduled_at });
      out.retried! += 1;
      return;
    }
    if (!publisherCanMove('publishing', 'failed')) return;
    const r = await store.updatePost(w.post.id, { status: 'publishing' }, { status: 'failed', attempts, last_error });
    if (r === 'error' || r === 'nomatch') return;
    await store.logEvent(w.post.id, 'failed', { attempts, error: message });
    out.failed! += 1;
    await notifyOwner(env, fetchImpl, `RayValue Instagram: post failed (${w.post.title || w.post.type})`, [
      `A scheduled ${w.post.type} post could not be published${opts.noRetry ? '' : ` after ${attempts} attempts`}.`,
      `Reason: ${message}`,
      'It is marked Failed. Open it in the admin to fix and reschedule.',
    ]);
  }

  async function finishPublished(w: Work, mediaId: string): Promise<void> {
    let permalink: string | null = w.post.ig_permalink;
    if (!permalink) {
      try {
        permalink = await client.getPermalink(mediaId);
      } catch (e) {
        await store.logEvent(w.post.id, 'permalink_failed', { error: errText(e, token) });
      }
    }
    const patch = { status: 'published' as const, ig_media_id: mediaId, ig_permalink: permalink, published_at: w.post.published_at ?? now.toISOString(), last_error: null };
    if (!publisherCanMove('publishing', 'published')) return;
    let r = await store.updatePost(w.post.id, { status: 'publishing' }, patch);
    if (r === 'error') r = await store.updatePost(w.post.id, { status: 'publishing' }, patch);
    if (r === 'error' || r === 'nomatch') {
      await store.logEvent(w.post.id, 'published_not_recorded', { media_id: mediaId });
      await notifyOwner(env, fetchImpl, 'RayValue Instagram: published but not recorded', [`A post went live on Instagram (media id ${mediaId}${permalink ? `, ${permalink}` : ''}) but its status could not be saved. Check it in the admin before rescheduling anything.`]);
      return;
    }
    await store.logEvent(w.post.id, 'published', { media_id: mediaId, permalink });
    out.published! += 1;
    if (settings!.notify_email) {
      await notifyOwner(env, fetchImpl, `RayValue Instagram: published ${w.post.title || w.post.type}`, [`Your ${w.post.type} post is live.`, permalink ? `Link: ${permalink}` : 'Instagram did not return a link yet; find it on the account.']);
    }
  }

  /** FINISHED container: claim the row version, then media_publish (never when ig_media_id already exists). */
  async function publish(w: Work, containerId: string): Promise<void> {
    if (w.post.ig_media_id) return finishPublished(w, w.post.ig_media_id);
    if (dry) {
      await store.logEvent(w.post.id, 'dry_run', { would: 'media_publish', container_id: containerId });
      out.waiting! += 1;
      return;
    }
    const claim = await store.updatePost(w.post.id, { status: 'publishing', updated_at: w.version }, { last_error: null });
    if (claim === 'error' || claim === 'nomatch') {
      out.skipped! += 1; // another run is publishing this post (or the database is down); do not risk a double post
      return;
    }
    w.version = claim.updated_at;
    let mediaId: string;
    try {
      mediaId = await client.publishContainer(containerId);
    } catch (e) {
      const msg = errText(e, token);
      const ambiguous = e instanceof IgError && (e.status === 0 || e.status >= 500);
      return failPost(w, msg, ambiguous ? { keepPublishing: true } : {});
    }
    return finishPublished({ ...w, post: { ...w.post, ig_media_id: mediaId } }, mediaId);
  }

  // ---- 1. scheduled posts: re-check, claim, create the container
  for (const post of due) {
    const media = mediaByPost.get(post.id) ?? [];
    const w: Work = { post, media, version: post.updated_at };

    if (post.status === 'publishing') {
      if (post.ig_media_id) {
        await publish(w, post.ig_container_id ?? '');
      } else if (post.ig_container_id) {
        pending.push({ ...w, containerId: post.ig_container_id });
      } else if (now.getTime() - new Date(post.updated_at).getTime() > STALE_CLAIM_MS && !dry) {
        await failPost(w, 'Publishing was interrupted before Instagram created a container.');
      } else out.skipped! += 1;
      continue;
    }

    const checks = runChecks({ type: post.type, caption: post.caption, data_refs: post.data_refs, numbers_confirmed: post.numbers_confirmed, media });
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
      await notifyOwner(env, fetchImpl, `RayValue Instagram: post held for review (${post.title || post.type})`, [
        'A scheduled post failed its final checks and was NOT published. It is waiting in Needs review.',
        ...failed.map((c) => `- ${c.message}`),
      ]);
      continue;
    }

    if (dry) {
      await store.logEvent(post.id, 'dry_run', { would: 'create_container_and_publish', type: post.type, media: media.map((m) => m.public_url), share_to_feed: post.share_to_feed, thumb_offset_ms: post.thumb_offset_ms });
      out.skipped! += 1;
      continue;
    }

    if (!publisherCanMove('scheduled', 'publishing')) continue;
    const claim = await store.updatePost(post.id, { status: 'scheduled' }, { status: 'publishing', checks, checks_passed: true });
    if (claim === 'error' || claim === 'nomatch') {
      out.skipped! += 1;
      continue;
    }
    w.version = claim.updated_at;
    let containerId: string;
    try {
      containerId = await client.createContainer(post, media);
    } catch (e) {
      await failPost(w, errText(e, token));
      continue;
    }
    const saved = await store.updatePost(post.id, { status: 'publishing' }, { ig_container_id: containerId });
    if (saved !== 'error' && saved !== 'nomatch') w.version = saved.updated_at;
    await store.logEvent(post.id, 'container_created', { container_id: containerId });
    pending.push({ ...w, containerId });
  }

  // ---- 2. poll containers (within the time budget), publish the finished ones
  let waiting = pending;
  for (let round = 0; waiting.length; round++) {
    const next: typeof pending = [];
    for (const w of waiting) {
      let status: Awaited<ReturnType<InstagramClient['getContainerStatus']>>;
      try {
        status = await client.getContainerStatus(w.containerId);
      } catch (e) {
        if (e instanceof IgError && e.transient) {
          next.push(w); // a hiccup reading the status is not the post's fault
          continue;
        }
        await failPost(w, errText(e, token));
        continue;
      }
      if (status.status === 'FINISHED') await publish(w, w.containerId);
      else if (status.status === 'IN_PROGRESS') next.push(w);
      else if (status.status === 'PUBLISHED') {
        // Already live but we hold no media id: media_publish must not be called again.
        await failPost(w, 'Instagram says this post is already published but its id was not recorded. Check the account before rescheduling.', { noRetry: true });
      } else await failPost(w, `Instagram could not process the media (${status.status}${status.detail ? `: ${status.detail}` : ''}).`);
    }
    waiting = next;
    if (!waiting.length || round + 1 >= MAX_POLL_ROUNDS || nowMs() - startedMs + POLL_INTERVAL_MS > POLL_BUDGET_MS) break;
    await sleep(POLL_INTERVAL_MS);
  }
  out.waiting! += waiting.length; // still IN_PROGRESS: the next run picks them up
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
}

export async function runInsightsSync(env: SocialEnv, fetchImpl: typeof fetch, now = new Date(), deps: PublisherDeps = {}): Promise<InsightsOutcome> {
  const store = deps.store ?? supabaseStore(env, fetchImpl);
  const posts = await store.loadPublishedSince(new Date(now.getTime() - INSIGHTS_DAYS * 86_400_000), 60);
  if (!posts) return { ok: false, error: 'could not read posts' };
  if (!posts.length) return { ok: true, checked: 0, updated: 0, failed: 0, skipped: 0 };
  const cur = await currentToken(env, store);
  if (!cur || !env.IG_USER_ID) return { ok: false, error: !cur ? 'no Instagram token configured' : 'IG_USER_ID is not set' };
  const client: InstagramClient = createInstagramClient({ token: cur.token, userId: env.IG_USER_ID, fetch: fetchImpl, readOnly: true });

  const out: InsightsOutcome = { ok: true, checked: 0, updated: 0, failed: 0, skipped: 0 };
  for (const post of posts) {
    // Story insights exist for 24 hours only; after that the request would just error.
    if (post.type === 'story' && post.published_at && now.getTime() - new Date(post.published_at).getTime() > 24 * 3_600_000) {
      out.skipped! += 1;
      continue;
    }
    out.checked! += 1;
    try {
      const insights = await client.getInsights(post.ig_media_id!, post.type);
      if (!Object.keys(insights).length) {
        out.skipped! += 1;
        continue;
      }
      const r = await store.updatePost(post.id, { status: 'published' }, { insights, insights_at: now.toISOString() });
      if (r === 'error') out.failed! += 1;
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
  return out;
}
