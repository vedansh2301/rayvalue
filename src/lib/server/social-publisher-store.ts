/**
 * Data layer of the Instagram publisher (SERVER ONLY): a small interface, the Supabase implementation that talks to
 * PostgREST with SUPABASE_SECRET_KEY, and nothing else. The orchestration in social-publisher.ts depends only on
 * the interface, so tests drive it with an in-memory store. Tables: supabase/migrations/0014_social_cms.sql.
 */
import type { MediaKind, MediaMime, PostStatus, SocialPost, SocialSettings } from '../social/types';
import { adminHeaders, adminInsert, adminSelect, adminUpsert, DB_TIMEOUT_MS, type AdminEnv } from './admin-db';

export interface PostMedia {
  kind: MediaKind;
  mime: MediaMime;
  public_url: string;
  width: number | null;
  height: number | null;
  duration_s: number | null;
}

export interface AuthRow {
  access_token: string;
  expires_at: string | null;
  refreshed_at: string;
}

/** Conditions an update must still satisfy, so two overlapping runs cannot both act on a post. */
export interface PostWhere {
  status?: PostStatus | PostStatus[];
  /** Compare-and-swap on the row version (every update bumps updated_at in the database). */
  updated_at?: string;
}

/** `{ updated_at }` = updated (the new version); 'nomatch' = the post changed under us; 'error' = database failure. */
export type UpdateResult = { updated_at: string } | 'nomatch' | 'error';

export interface PublisherStore {
  loadSettings(): Promise<SocialSettings | null>;
  /** Scheduled posts due at `now` plus posts mid-publish, oldest first. */
  loadDuePosts(now: Date, limit: number): Promise<SocialPost[] | null>;
  /** Ordered media per post id. */
  loadMedia(postIds: string[]): Promise<Map<string, PostMedia[]> | null>;
  updatePost(id: string, where: PostWhere, patch: Partial<SocialPost>): Promise<UpdateResult>;
  logEvent(postId: string | null, event: string, detail?: Record<string, unknown>): Promise<void>;
  loadAuth(): Promise<AuthRow | null>;
  saveAuth(row: AuthRow): Promise<boolean>;
  /** Published posts with an Instagram media id since `since`, newest first. */
  loadPublishedSince(since: Date, limit: number): Promise<SocialPost[] | null>;
}

const base = (url: string) => url.replace(/\/+$/, '');

export function supabaseStore(env: AdminEnv, fetchImpl: typeof fetch): PublisherStore {
  return {
    async loadSettings() {
      const rows = await adminSelect<SocialSettings>(env, 'social_settings', { select: '*', limit: '1' }, fetchImpl);
      return rows?.[0] ?? null;
    },

    async loadDuePosts(now, limit) {
      return adminSelect<SocialPost>(
        env,
        'social_posts',
        { select: '*', or: `(and(status.eq.scheduled,scheduled_at.lte.${now.toISOString()}),status.eq.publishing)`, order: 'scheduled_at.asc', limit: String(limit) },
        fetchImpl,
      );
    },

    async loadMedia(postIds) {
      const out = new Map<string, PostMedia[]>();
      if (!postIds.length) return out;
      const rows = await adminSelect<{ post_id: string; position: number; media: PostMedia | null }>(
        env,
        'social_post_media',
        { select: 'post_id,position,media:social_media(kind,mime,public_url,width,height,duration_s)', post_id: `in.(${postIds.join(',')})`, order: 'position.asc' },
        fetchImpl,
      );
      if (!rows) return null;
      for (const r of rows) if (r.media) out.set(r.post_id, [...(out.get(r.post_id) ?? []), r.media]);
      return out;
    },

    async updatePost(id, where, patch) {
      if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return 'error';
      const u = new URL(`${base(env.SUPABASE_URL)}/rest/v1/social_posts`);
      u.searchParams.set('id', `eq.${id}`);
      if (where.status) u.searchParams.set('status', Array.isArray(where.status) ? `in.(${where.status.join(',')})` : `eq.${where.status}`);
      if (where.updated_at) u.searchParams.set('updated_at', `eq.${where.updated_at}`);
      u.searchParams.set('select', 'updated_at');
      try {
        const res = await fetchImpl(u.toString(), {
          method: 'PATCH',
          headers: adminHeaders(env.SUPABASE_SECRET_KEY, { Prefer: 'return=representation' }),
          body: JSON.stringify(patch),
          signal: AbortSignal.timeout(DB_TIMEOUT_MS),
        });
        if (!res.ok) {
          console.error(`social_posts: supabase status ${res.status}`);
          return 'error';
        }
        const body = (await res.json().catch(() => null)) as { updated_at?: string }[] | null;
        if (!Array.isArray(body)) return 'error';
        return body[0]?.updated_at ? { updated_at: body[0].updated_at } : 'nomatch';
      } catch (e) {
        console.error('social_posts: supabase request failed', e instanceof Error ? e.name : 'error');
        return 'error';
      }
    },

    async logEvent(postId, event, detail) {
      await adminInsert(env, 'social_events', { post_id: postId, event, ...(detail ? { detail } : {}) }, fetchImpl);
    },

    async loadAuth() {
      const rows = await adminSelect<AuthRow>(env, 'social_auth', { select: 'access_token,expires_at,refreshed_at', limit: '1' }, fetchImpl);
      return rows?.[0] ?? null;
    },

    saveAuth(row) {
      return adminUpsert(env, 'social_auth', { id: true, ...row }, 'id', fetchImpl);
    },

    loadPublishedSince(since, limit) {
      return adminSelect<SocialPost>(
        env,
        'social_posts',
        { select: '*', status: 'eq.published', ig_media_id: 'not.is.null', published_at: `gte.${since.toISOString()}`, order: 'published_at.desc', limit: String(limit) },
        fetchImpl,
      );
    },
  };
}
