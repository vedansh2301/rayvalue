/**
 * Database and Storage calls for /admin/social (server only; uses SUPABASE_SECRET_KEY). The publisher has its own data
 * layer; nothing here talks to Instagram. Status moves go through src/lib/social/status.ts and every write that depends
 * on the current status filters on it, so a post the publisher just picked up cannot be overwritten.
 */
import { channelsLabel, normalizeChannels, publishedChannels } from '../social/channels';
import { checksPassed, runChecks, type MediaForCheck } from '../social/checks';
import {
  isUuid,
  parseLocalDateTime,
  publicUrlFor,
  resolveScheduleTarget,
  type ListFilters,
  type MediaInsert,
  type PostFormInput,
  type SettingsInput,
} from '../social/forms';
import type { FlashCode } from '../social/flash';
import { nextFreeSlot } from '../social/schedule';
import { canTransition, isEditable } from '../social/status';
import { POST_TYPES, type PostStatus, type PostType, type SocialMedia, type SocialPost, type SocialSettings } from '../social/types';
import type { CalendarPost } from '../social/view';
import { adminDelete, adminInsert, adminInsertMany, adminSelect, adminUpdate, adminHeaders, DB_TIMEOUT_MS, type AdminEnv } from './admin-db';

export interface SocialEnv extends AdminEnv {
  GITHUB_DISPATCH_TOKEN?: string;
  /** Only read to say whether the Page is connected; never displayed. */
  FB_PAGE_ID?: string;
  FB_PAGE_TOKEN?: string;
}

const f = fetch;
const LIST_LIMIT = 100;

export interface SocialEvent {
  id: number;
  post_id: string | null;
  at: string;
  event: string;
  detail: Record<string, unknown> | null;
}
export interface SocialTemplate {
  id: string;
  kind: 'caption' | 'hashtags';
  name: string;
  body: string;
  created_at: string;
}

// ------------------------------------------------------------------ settings
export async function getSettings(env: SocialEnv): Promise<SocialSettings | null> {
  const rows = await adminSelect<SocialSettings>(env, 'social_settings', { select: '*', limit: '1' }, f);
  const row = rows?.[0];
  return row ? { ...row, default_channels: normalizeChannels(row.default_channels) } : null;
}

export async function updateSettings(env: SocialEnv, s: SettingsInput): Promise<boolean> {
  const n = await adminUpdate(env, 'social_settings', { id: 'eq.true' }, { auto_publish: s.auto_publish, paused: s.paused, timezone: s.timezone, notify_email: s.notify_email, slots: s.slots, default_channels: s.default_channels }, f);
  if (n) await logEvent(env, null, 'settings_saved', { paused: s.paused, auto_publish: s.auto_publish, timezone: s.timezone, slots: s.slots.length, default_channels: s.default_channels });
  return n === 1;
}

export async function setPaused(env: SocialEnv, paused: boolean): Promise<boolean> {
  const n = await adminUpdate(env, 'social_settings', { id: 'eq.true' }, { paused }, f);
  if (n) await logEvent(env, null, paused ? 'paused' : 'resumed');
  return n === 1;
}

// ------------------------------------------------------------------ events
export async function logEvent(env: SocialEnv, postId: string | null, event: string, detail: Record<string, unknown> | null = null): Promise<void> {
  const r = await adminInsert(env, 'social_events', { post_id: postId, event, detail }, f, 'id');
  if (!r || 'conflict' in r) console.error(`social_events: could not log ${event}`);
}

export const listEvents = (env: SocialEnv, postId: string) => adminSelect<SocialEvent>(env, 'social_events', { post_id: `eq.${postId}`, select: '*', order: 'at.desc,id.desc', limit: '50' }, f);

// ------------------------------------------------------------------ posts
export async function listPosts(env: SocialEnv, filters: ListFilters): Promise<SocialPost[] | null> {
  const params: Record<string, string> = { select: '*', order: 'updated_at.desc', limit: String(LIST_LIMIT) };
  if (filters.status) params.status = `eq.${filters.status}`;
  if (filters.type) params.type = `eq.${filters.type}`;
  if (filters.channel) params.channels = `cs.{${filters.channel}}`;
  if (filters.q) params.or = `(title.ilike.*${filters.q}*,caption.ilike.*${filters.q}*)`;
  return adminSelect<SocialPost>(env, 'social_posts', params, f);
}

export async function getPost(env: SocialEnv, id: string): Promise<SocialPost | null> {
  if (!isUuid(id)) return null;
  return (await adminSelect<SocialPost>(env, 'social_posts', { id: `eq.${id}`, select: '*', limit: '1' }, f))?.[0] ?? null;
}

/** The post's media in carousel order. */
export async function getPostMedia(env: SocialEnv, postId: string): Promise<SocialMedia[] | null> {
  const rows = await adminSelect<{ position: number; social_media: SocialMedia | null }>(env, 'social_post_media', { post_id: `eq.${postId}`, select: 'position,social_media(*)', order: 'position.asc' }, f);
  return rows ? rows.flatMap((r) => (r.social_media ? [r.social_media] : [])) : null;
}

export async function calendarPosts(env: SocialEnv): Promise<CalendarPost[] | null> {
  return adminSelect<CalendarPost>(env, 'social_posts', { select: 'id,title,type,status,scheduled_at,published_at', or: '(scheduled_at.not.is.null,published_at.not.is.null)', order: 'scheduled_at.asc', limit: '1000' }, f);
}

export const publishedPosts = (env: SocialEnv) =>
  adminSelect<SocialPost>(env, 'social_posts', { select: '*', status: 'eq.published', order: 'published_at.desc', limit: '200' }, f);

export interface HubCounts {
  review: number;
  scheduledSoon: number;
  failed: number;
  total: number;
}

export async function hubCounts(env: SocialEnv, now: Date): Promise<HubCounts | null> {
  const rows = await adminSelect<Pick<SocialPost, 'status' | 'scheduled_at'>>(env, 'social_posts', { select: 'status,scheduled_at', limit: '5000' }, f);
  if (!rows) return null;
  const weekOut = now.getTime() + 7 * 86_400_000;
  return {
    total: rows.length,
    review: rows.filter((r) => r.status === 'review').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    scheduledSoon: rows.filter((r) => r.status === 'scheduled' && r.scheduled_at && new Date(r.scheduled_at).getTime() <= weekOut).length,
  };
}

/** scheduled_at of every scheduled post (optionally except one), for "next free slot". */
async function takenTimes(env: SocialEnv, exceptId: string | null): Promise<string[] | null> {
  const rows = await adminSelect<{ id: string; scheduled_at: string | null }>(env, 'social_posts', { select: 'id,scheduled_at', status: 'in.(scheduled,publishing)', limit: '1000' }, f);
  return rows ? rows.filter((r) => r.id !== exceptId && r.scheduled_at).map((r) => r.scheduled_at!) : null;
}

/** Next free slot per post type, for the editor's schedule options. */
export async function nextSlotsByType(env: SocialEnv, settings: SocialSettings, exceptId: string | null, now: Date): Promise<Record<PostType, string | null>> {
  const taken = (await takenTimes(env, exceptId)) ?? [];
  const out = {} as Record<PostType, string | null>;
  for (const t of POST_TYPES) out[t] = nextFreeSlot(settings.slots, t, settings.timezone, taken, now)?.toISOString() ?? null;
  return out;
}

const toCheckMedia = (m: SocialMedia): MediaForCheck => ({ kind: m.kind, mime: m.mime, width: m.width, height: m.height, duration_s: m.duration_s });

async function setPostMedia(env: SocialEnv, postId: string, mediaIds: string[]): Promise<boolean> {
  const deleted = await adminDelete(env, 'social_post_media', { post_id: `eq.${postId}` }, f);
  if (deleted === null) return false;
  return adminInsertMany(env, 'social_post_media', mediaIds.map((media_id, position) => ({ post_id: postId, media_id, position })), f);
}

export type SaveResult = { ok: true; id: string; status: PostStatus; flash: FlashCode } | { ok: false; errors: string[] };
const fail = (...errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });

/**
 * Create or update a post from the editor. Checks are recomputed here (authoritative) and stored. Scheduling picks the
 * time (next free slot, a chosen time or now) and the status through resolveScheduleTarget.
 */
export async function savePost(env: SocialEnv, existing: SocialPost | null, input: PostFormInput, now: Date): Promise<SaveResult> {
  const settings = await getSettings(env);
  if (!settings) return fail('Could not read settings from the database.');
  if (existing && !isEditable(existing.status)) return fail(`A post that is ${existing.status} can no longer be edited.`);

  // Media, in the order chosen.
  let media: SocialMedia[] = [];
  if (input.media_ids.length) {
    const rows = await adminSelect<SocialMedia>(env, 'social_media', { select: '*', id: `in.(${input.media_ids.join(',')})` }, f);
    if (!rows) return fail('Could not read the media library.');
    const byId = new Map(rows.map((m) => [m.id, m]));
    if (input.media_ids.some((id) => !byId.has(id))) return fail('A selected media file no longer exists.');
    media = input.media_ids.map((id) => byId.get(id)!);
  }
  for (const m of media) {
    if (!(m.id in input.alt_text) || input.alt_text[m.id] === m.alt_text) continue;
    await adminUpdate(env, 'social_media', { id: `eq.${m.id}` }, { alt_text: input.alt_text[m.id] }, f);
  }

  // A channel that already published cannot be taken off the post (its result would be lost).
  const dropped = existing ? publishedChannels(existing).filter((c) => !input.channels.includes(c)) : [];
  if (dropped.length) return fail(`${channelsLabel(dropped)} already published this post, so it has to stay ticked.`);

  const results = runChecks({ type: input.type, caption: input.caption, data_refs: existing?.data_refs ?? [], numbers_confirmed: input.numbers_confirmed, media: media.map(toCheckMedia), channels: input.channels });
  const passed = checksPassed(results);
  const from: PostStatus = existing?.status ?? 'draft';

  const patch: Record<string, unknown> = {
    type: input.type,
    channels: input.channels,
    title: input.title,
    caption: input.caption,
    numbers_confirmed: input.numbers_confirmed,
    share_to_feed: input.share_to_feed,
    thumb_offset_ms: input.thumb_offset_ms,
    checks: results,
    checks_passed: passed,
  };
  let status: PostStatus = from;
  let flash: FlashCode = existing ? 'saved' : 'created';
  let event = existing ? 'saved' : 'created';
  let detail: Record<string, unknown> = { checks_passed: passed };

  if (input.action === 'save') {
    // A scheduled post whose checks now fail goes back to draft rather than publishing something that fails them.
    if (from === 'scheduled' && !passed) {
      status = 'draft';
      patch.scheduled_at = null;
      flash = 'demoted_by_save';
      detail = { ...detail, unscheduled_by_checks: true };
    }
  } else {
    let at: Date | null = null;
    if (input.when === 'now') at = now;
    else if (input.when === 'custom') {
      at = parseLocalDateTime(input.scheduled_local, settings.timezone);
      if (!at) return fail('Pick a valid date and time.');
      if (at.getTime() < now.getTime() - 60_000) return fail('That time is in the past. Use “Publish now” to post immediately.');
    } else if (input.when === 'next_slot') {
      const taken = (await takenTimes(env, existing?.id ?? null)) ?? [];
      at = nextFreeSlot(settings.slots, input.type, settings.timezone, taken, now);
      if (!at) return fail(`No free ${input.type} slot in the next three weeks. Add slots in settings or pick a time.`);
    } else return fail('Choose when to publish: next free slot, a date and time, or now.');

    const target = resolveScheduleTarget(from, passed, settings.auto_publish);
    if (!target) return fail(`A ${from} post cannot be scheduled.`);
    status = target;
    patch.scheduled_at = at.toISOString();
    if (target === 'scheduled') {
      event = 'scheduled';
      detail = { ...detail, scheduled_at: at.toISOString(), mode: input.when };
      if (from === 'failed') Object.assign(patch, { attempts: 0, last_error: null, fb_attempts: 0, fb_last_error: null });
      flash = input.when === 'now' ? 'queued_now' : 'scheduled';
    } else {
      flash = target === 'review' ? 'needs_review' : 'demoted_draft';
      detail = { ...detail, wanted_at: at.toISOString() };
    }
  }
  patch.status = status;

  let id: string;
  if (!existing) {
    const created = await adminInsert<{ id: string }>(env, 'social_posts', { ...patch, origin: 'upload' }, f, 'id');
    if (!created || 'conflict' in created) return fail('Could not save the post. Try again.');
    id = created.row.id;
  } else {
    id = existing.id;
    if (status !== from && !canTransition(from, status)) return fail(`A ${from} post cannot move to ${status}.`);
    const n = await adminUpdate(env, 'social_posts', { id: `eq.${id}`, status: `eq.${from}` }, patch, f);
    if (n === null) return fail('Could not save the post. Try again.');
    if (n === 0) return fail('The post changed while you were editing (it may have just been published). Reload and try again.');
  }
  if (!(await setPostMedia(env, id, input.media_ids))) return fail('The post was saved but its media could not be updated. Open it again and re-save.');
  if (!existing) await logEvent(env, id, 'created', { origin: 'upload' });
  if (existing || event !== 'created') await logEvent(env, id, event, detail);
  return { ok: true, id, status, flash };
}

export type ActionResult = { ok: true; flash: FlashCode; id?: string } | { ok: false; error: string };

/** Unschedule, retry, archive, delete and duplicate. */
export async function postAction(env: SocialEnv, post: SocialPost, action: 'unschedule' | 'retry' | 'archive' | 'delete' | 'duplicate', now: Date): Promise<ActionResult> {
  const err = (error: string): ActionResult => ({ ok: false, error });
  switch (action) {
    case 'unschedule': {
      if (post.status !== 'scheduled' || !canTransition('scheduled', 'draft')) return err('Only a scheduled post can be unscheduled.');
      const n = await adminUpdate(env, 'social_posts', { id: `eq.${post.id}`, status: 'eq.scheduled' }, { status: 'draft', scheduled_at: null }, f);
      if (!n) return err(n === 0 ? 'The post is no longer scheduled (it may be publishing).' : 'Could not unschedule. Try again.');
      await logEvent(env, post.id, 'unscheduled', { was: post.scheduled_at });
      return { ok: true, flash: 'unscheduled' };
    }
    case 'retry': {
      if (post.status !== 'failed' || !canTransition('failed', 'scheduled')) return err('Only a failed post can be retried.');
      const media = await getPostMedia(env, post.id);
      if (!media) return err('Could not read the post media.');
      const results = runChecks({ type: post.type, caption: post.caption, data_refs: post.data_refs, numbers_confirmed: post.numbers_confirmed, media: media.map(toCheckMedia), channels: normalizeChannels(post.channels) });
      if (!checksPassed(results)) return err('The post fails a check, so it cannot be retried. Fix it in the editor first.');
      const n = await adminUpdate(env, 'social_posts', { id: `eq.${post.id}`, status: 'eq.failed' }, { status: 'scheduled', scheduled_at: now.toISOString(), attempts: 0, last_error: null, fb_attempts: 0, fb_last_error: null, checks: results, checks_passed: true }, f);
      if (!n) return err('Could not retry. Try again.');
      await logEvent(env, post.id, 'retry', { previous_error: post.last_error });
      return { ok: true, flash: 'retried' };
    }
    case 'archive': {
      if (!canTransition(post.status, 'archived')) return err(`A ${post.status} post cannot be archived.`);
      const n = await adminUpdate(env, 'social_posts', { id: `eq.${post.id}`, status: `eq.${post.status}` }, { status: 'archived' }, f);
      if (!n) return err('Could not archive (the post changed). Reload and try again.');
      await logEvent(env, post.id, 'archived', { was: post.status });
      return { ok: true, flash: 'archived' };
    }
    case 'delete': {
      if (post.status !== 'draft') return err('Only drafts can be deleted. Archive other posts instead.');
      const n = await adminDelete(env, 'social_posts', { id: `eq.${post.id}`, status: 'eq.draft' }, f);
      if (!n) return err('Could not delete the draft.');
      await logEvent(env, null, 'deleted', { post_id: post.id, title: post.title });
      return { ok: true, flash: 'deleted' };
    }
    case 'duplicate': {
      const media = await getPostMedia(env, post.id);
      if (!media) return err('Could not read the post media.');
      const created = await adminInsert<{ id: string }>(
        env,
        'social_posts',
        {
          type: post.type,
          channels: normalizeChannels(post.channels),
          status: 'draft',
          title: `${post.title} (copy)`.slice(0, 120),
          caption: post.caption,
          origin: post.origin,
          template_key: post.template_key,
          data_refs: post.data_refs,
          numbers_confirmed: post.numbers_confirmed,
          share_to_feed: post.share_to_feed,
          thumb_offset_ms: post.thumb_offset_ms,
          checks: [],
          checks_passed: false,
        },
        f,
        'id',
      );
      if (!created || 'conflict' in created) return err('Could not duplicate the post.');
      if (!(await setPostMedia(env, created.row.id, media.map((m) => m.id)))) return err('Copied the post but not its media.');
      await logEvent(env, created.row.id, 'duplicated', { from: post.id });
      return { ok: true, flash: 'duplicated', id: created.row.id };
    }
  }
}

// ------------------------------------------------------------------ media library
export const listMedia = (env: SocialEnv) => adminSelect<SocialMedia>(env, 'social_media', { select: '*', order: 'created_at.desc', limit: '500' }, f);

/** How many posts use each media file. */
export async function mediaUsage(env: SocialEnv): Promise<Map<string, number> | null> {
  const rows = await adminSelect<{ media_id: string }>(env, 'social_post_media', { select: 'media_id', limit: '5000' }, f);
  if (!rows) return null;
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.media_id, (m.get(r.media_id) ?? 0) + 1);
  return m;
}

export async function insertMedia(env: SocialEnv, row: MediaInsert): Promise<{ ok: true; media: SocialMedia } | { ok: false; error: string }> {
  if (!env.SUPABASE_URL) return { ok: false, error: 'Database is not configured.' };
  const r = await adminInsert<SocialMedia>(env, 'social_media', { ...row, public_url: publicUrlFor(env.SUPABASE_URL, row.storage_path) }, f, '*');
  if (!r) return { ok: false, error: 'Could not save the media row.' };
  if ('conflict' in r) return { ok: false, error: 'That file is already registered.' };
  return { ok: true, media: r.row };
}

export async function updateMediaMeta(env: SocialEnv, id: string, patch: { alt_text: string | null; credit: string | null; license: string | null }): Promise<boolean> {
  return (await adminUpdate(env, 'social_media', { id: `eq.${id}` }, patch, f)) === 1;
}

/** Delete a media file (row and Storage object) only when no post uses it. */
export async function deleteMedia(env: SocialEnv, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await adminSelect<SocialMedia>(env, 'social_media', { id: `eq.${id}`, select: '*', limit: '1' }, f);
  const media = rows?.[0];
  if (!media) return { ok: false, error: 'Media not found.' };
  const used = await adminSelect<{ post_id: string }>(env, 'social_post_media', { media_id: `eq.${id}`, select: 'post_id', limit: '1' }, f);
  if (!used) return { ok: false, error: 'Could not check where the media is used.' };
  if (used.length) return { ok: false, error: 'This media is used by a post. Remove it from the post first.' };
  const n = await adminDelete(env, 'social_media', { id: `eq.${id}` }, f);
  if (!n) return { ok: false, error: 'Could not delete the media row.' };
  const stored = await deleteStorageObject(env, media.storage_path);
  return stored ? { ok: true } : { ok: false, error: 'The library entry was removed but the stored file could not be deleted; remove it in the Supabase dashboard.' };
}

// ------------------------------------------------------------------ storage
const storageBase = (env: SocialEnv) => `${env.SUPABASE_URL!.replace(/\/+$/, '')}/storage/v1`;

/** A one-time signed upload URL for `path` in the social bucket (valid about two hours). null on failure. */
export async function createSignedUpload(env: SocialEnv, path: string): Promise<{ url: string; token: string } | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  try {
    const res = await f(`${storageBase(env)}/object/upload/sign/social/${path}`, { method: 'POST', headers: adminHeaders(env.SUPABASE_SECRET_KEY), body: '{}', signal: AbortSignal.timeout(DB_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`storage sign: status ${res.status}`);
      return null;
    }
    const body = (await res.json().catch(() => null)) as { url?: unknown; token?: unknown } | null;
    if (!body || typeof body.url !== 'string' || typeof body.token !== 'string') return null;
    return { url: `${storageBase(env)}${body.url}`, token: body.token };
  } catch (e) {
    console.error('storage sign failed', e instanceof Error ? e.name : 'error');
    return null;
  }
}

export async function deleteStorageObject(env: SocialEnv, path: string): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return false;
  try {
    const res = await f(`${storageBase(env)}/object/social/${path}`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SECRET_KEY }, signal: AbortSignal.timeout(DB_TIMEOUT_MS) });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/** Is the file publicly readable at its URL (i.e. the browser upload really finished)? */
export async function storageObjectExists(env: SocialEnv, path: string): Promise<boolean> {
  if (!env.SUPABASE_URL) return false;
  try {
    const res = await f(publicUrlFor(env.SUPABASE_URL, path), { method: 'HEAD', signal: AbortSignal.timeout(DB_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ templates
export const listTemplates = (env: SocialEnv) => adminSelect<SocialTemplate>(env, 'social_templates', { select: '*', order: 'kind.asc,name.asc', limit: '500' }, f);

export async function saveTemplate(env: SocialEnv, id: string | null, t: { kind: 'caption' | 'hashtags'; name: string; body: string }): Promise<'ok' | 'duplicate' | 'error'> {
  if (id) {
    const r = await adminUpdateTemplate(env, id, t);
    return r;
  }
  const r = await adminInsert(env, 'social_templates', t, f, 'id');
  if (!r) return 'error';
  return 'conflict' in r ? 'duplicate' : 'ok';
}

async function adminUpdateTemplate(env: SocialEnv, id: string, t: { kind: string; name: string; body: string }): Promise<'ok' | 'duplicate' | 'error'> {
  // adminUpdate reports failure as null for both errors and unique violations; check for the clash first.
  const clash = await adminSelect<{ id: string }>(env, 'social_templates', { kind: `eq.${t.kind}`, name: `eq.${t.name}`, id: `neq.${id}`, select: 'id', limit: '1' }, f);
  if (!clash) return 'error';
  if (clash.length) return 'duplicate';
  const n = await adminUpdate(env, 'social_templates', { id: `eq.${id}` }, t, f);
  return n === 1 ? 'ok' : 'error';
}

export async function deleteTemplate(env: SocialEnv, id: string): Promise<boolean> {
  return (await adminDelete(env, 'social_templates', { id: `eq.${id}` }, f)) === 1;
}

// ------------------------------------------------------------------ generate
export const RENDER_WORKFLOW_URL = 'https://api.github.com/repos/vedansh2301/rayvalue/actions/workflows/social-render.yml/dispatches';

/** Ask GitHub Actions to render a post. 'no_token' when GITHUB_DISPATCH_TOKEN is not configured. */
export async function dispatchRender(env: SocialEnv, template: string, target: string): Promise<'ok' | 'no_token' | 'error'> {
  const token = env.GITHUB_DISPATCH_TOKEN;
  if (!token) return 'no_token';
  try {
    const res = await f(RENDER_WORKFLOW_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'rayvalue-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { template, target } }),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    if (res.status !== 204) console.error(`render dispatch: github status ${res.status}`);
    if (res.status === 204) await logEvent(env, null, 'render_requested', { template, target });
    return res.status === 204 ? 'ok' : 'error';
  } catch (e) {
    console.error('render dispatch failed', e instanceof Error ? e.name : 'error');
    return 'error';
  }
}
