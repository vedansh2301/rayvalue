/**
 * Small Facebook Page client for the social publisher (Graph API, host graph.facebook.com). `fetch` is injected so
 * everything is unit-testable with fakes. The Page access token is sent in an `Authorization: OAuth` header (the form
 * Meta's Reels docs use for rupload.facebook.com), never in a URL, and is scrubbed from every error message.
 *
 * Verified 2026-10-26 against the docs (no live calls: the Page is not connected yet):
 * - Version: v26.0 (the version in the docs' examples). Token: a non-expiring Page token from a Business Manager system user
 *   with pages_manage_posts, pages_read_engagement, pages_show_list (+ read_insights for insights).
 * - Photo post: POST /{page-id}/photos with `url` (a public image URL) and a caption -> { id: <photo id>, post_id: <post id> }.
 *   The docs now name the text param `caption` and mark `message` deprecated, so both are sent (they are aliases).
 *   `published=false` uploads without publishing (unpublished photos are deleted after about 24h).
 *   https://developers.facebook.com/docs/graph-api/reference/page/photos/
 * - Multi-photo post (our carousel): upload each photo with published=false, then POST /{page-id}/feed with `message` and
 *   attached_media[i]={"media_fbid":"<photo id>"} -> { id: <post id> }. Photos only: a feed post does not mix video and photos.
 *   https://developers.facebook.com/docs/graph-api/reference/page/feed/
 * - Reels (hosted file): https://developers.facebook.com/docs/video-api/guides/reels-publishing
 *     1. POST /{page-id}/video_reels  upload_phase=start                       -> { video_id, upload_url }
 *     2. POST https://rupload.facebook.com/video-upload/v26.0/{video_id}  headers `Authorization: OAuth <token>` and
 *        `file_url: <public https url>` (the host must allow the facebookexternalhit/1.1 user agent)  -> { success: true }
 *     3. POST /{page-id}/video_reels  video_id, upload_phase=finish, video_state=PUBLISHED, description -> { success: true }
 *     Status: GET /{video-id}?fields=status -> { status: { video_status: uploading | upload_complete | upload_failed |
 *     processing | ready | error | expired, uploading_phase, processing_phase, publishing_phase: { publish_status:
 *     draft | scheduled | published | error } } }.
 *     Limits: 3-90 s, 9:16 recommended (1080x1920, min 540x960), 24-60 fps, MP4 (H.264/H.265), AAC audio;
 *     30 API-published Reels per Page per rolling 24h. The finish call does not return an id: the video id from step 1
 *     is the Reel's id (kept as fb_video_id and, once published, fb_post_id).
 * - Permalink: GET /{post-id}?fields=permalink_url (absolute URL on a Page post; a video node may return a path
 *   starting with "/", which is prefixed with https://www.facebook.com).
 *   https://developers.facebook.com/docs/graph-api/reference/page-post/
 * - Insights (GET /{id}/insights?metric=a,b&period=lifetime): https://developers.facebook.com/docs/graph-api/reference/page-post/insights/
 *   Photo / multi-photo posts: post_media_view, post_total_media_view_unique, post_clicks, post_reactions_by_type_total
 *   (an object by reaction; stored as the sum under `post_reactions_total`). post_impressions and post_impressions_unique
 *   are deprecated (replaced by post_media_view / post_total_media_view_unique), so they are not requested.
 *   https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics
 *   Reels (GET /{video-id}/video_insights?metric=...&period=lifetime, needs read_insights; Reels metrics support only
 *   `lifetime`): blue_reels_play_count, fb_reels_total_plays, post_video_avg_time_watched, post_video_view_time.
 *   https://developers.facebook.com/docs/graph-api/reference/video/video_insights/
 *   Note: blue_reels_play_count is not on the post-insights page, only on the video_insights page, so it is requested
 *   there and per-metric fallback keeps the rest if Meta rejects one.
 * - Errors: { error: { message, code, error_subcode, error_user_msg } }. 190 = bad/expired token, 4/17/32/613 = rate
 *   limit, 100 = bad parameter, 200/10/283 = permission, 506 = duplicate post text.
 */
import { scrub } from './instagram';
import type { PostType, SocialMedia, SocialPost } from './types';

export const FB_HOST = 'https://graph.facebook.com';
export const FB_UPLOAD_HOST = 'https://rupload.facebook.com';
export const FB_VERSION = 'v26.0';

export type ReelVideoStatus = 'uploading' | 'upload_complete' | 'upload_failed' | 'processing' | 'ready' | 'error' | 'expired';
export type ReelPublishStatus = 'draft' | 'scheduled' | 'published' | 'error';

export class FbError extends Error {
  constructor(
    message: string,
    /** HTTP status, 0 for network failures. */
    readonly status: number,
    /** Graph API error code (190 = bad/expired token, 4/17/32/613 = rate limit, 100 = bad parameter). */
    readonly code: number | null,
  ) {
    super(message);
    this.name = 'FbError';
  }
  /** Worth retrying later without changing anything. */
  get transient() {
    return this.status === 0 || this.status >= 500 || (this.code !== null && [1, 2, 4, 17, 32, 341, 368, 613].includes(this.code));
  }
  /** A publish call that failed this way may still have gone through (timeout / server error): do not blindly repeat it. */
  get ambiguous() {
    return this.status === 0 || this.status >= 500;
  }
}

export interface FbClientOptions {
  token: string;
  pageId: string;
  fetch: typeof fetch;
  version?: string;
  /** Reject every POST (nothing can be created or published). Used by SOCIAL_DRY_RUN. */
  readOnly?: boolean;
  timeoutMs?: number;
}

export type MediaForFb = Pick<SocialMedia, 'kind' | 'public_url'>;

/** Metrics to ask for. */
export const FB_POST_METRICS = ['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_reactions_by_type_total'] as const;
export const FB_REEL_METRICS = ['blue_reels_play_count', 'fb_reels_total_plays', 'post_video_avg_time_watched', 'post_video_view_time'] as const;
export const FB_INSIGHT_METRICS: Record<PostType, readonly string[]> = {
  image: FB_POST_METRICS,
  carousel: FB_POST_METRICS,
  reel: FB_REEL_METRICS,
  story: [],
};

export interface ReelStatus {
  videoStatus: ReelVideoStatus;
  publishStatus: ReelPublishStatus | null;
  /** Short safe description of a failure reported by Facebook, if any. */
  error: string | null;
}

const VIDEO_STATUSES: readonly string[] = ['uploading', 'upload_complete', 'upload_failed', 'processing', 'ready', 'error', 'expired'];
const PUBLISH_STATUSES: readonly string[] = ['draft', 'scheduled', 'published', 'error'];

/** Absolute permalink: Graph sometimes returns a path ("/reel/123/"). */
export function absolutePermalink(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (/^https:\/\//i.test(raw)) return raw.slice(0, 300);
  return raw.startsWith('/') ? `https://www.facebook.com${raw}`.slice(0, 300) : null;
}

export function createFacebookClient(opts: FbClientOptions) {
  const { token, pageId, fetch: f } = opts;
  const version = opts.version ?? FB_VERSION;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  async function call(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string> = {},
    extra: { host?: string; headers?: Record<string, string>; versioned?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    if (method === 'POST' && opts.readOnly) throw new FbError('Dry run: Facebook write calls are disabled.', 0, null);
    const url = new URL(`${extra.host ?? FB_HOST}/${extra.versioned === false ? '' : `${version}/`}${path}`);
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `OAuth ${token}`, ...(extra.headers ?? {}) };
    let body: string | undefined;
    if (method === 'GET') for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    else if (Object.keys(params).length) {
      body = new URLSearchParams(params).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    let res: Response;
    try {
      res = await f(url.toString(), { method, headers, ...(body !== undefined ? { body } : {}), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new FbError(`Facebook request failed (${e instanceof Error ? e.name : 'network error'}).`, 0, null);
    }
    const json = (await res.json().catch(() => null)) as { error?: { message?: unknown; code?: unknown; error_subcode?: unknown; error_user_msg?: unknown } } | null;
    if (!res.ok || json?.error) {
      const err = json?.error;
      const code = typeof err?.code === 'number' ? err.code : null;
      const sub = typeof err?.error_subcode === 'number' ? `/${err.error_subcode}` : '';
      const text = typeof err?.error_user_msg === 'string' ? err.error_user_msg : typeof err?.message === 'string' ? err.message : `HTTP ${res.status}`;
      throw new FbError(scrub(`Facebook ${res.status}${code !== null ? ` (code ${code}${sub})` : ''}: ${text}`, token).slice(0, 300), res.status, code);
    }
    return (json ?? {}) as Record<string, unknown>;
  }

  const str = (r: Record<string, unknown>, key: string, what: string): string => {
    const v = r[key];
    if (typeof v !== 'string' || !v) throw new FbError(`Facebook returned no ${what} id.`, 200, null);
    return v;
  };

  /** Photo post. Returns the post id (page_post id) and the photo id. */
  async function publishPhoto(imageUrl: string, caption: string): Promise<{ postId: string; photoId: string | null }> {
    const r = await call('POST', `${pageId}/photos`, { url: imageUrl, caption, message: caption, published: 'true' });
    const photoId = typeof r.id === 'string' && r.id ? r.id : null;
    const postId = typeof r.post_id === 'string' && r.post_id ? r.post_id : photoId;
    if (!postId) throw new FbError('Facebook returned no post id.', 200, null);
    return { postId, photoId };
  }

  /** Multi-photo post: each photo uploaded unpublished, then one feed post that attaches them. */
  async function publishMultiPhoto(imageUrls: string[], caption: string): Promise<{ postId: string }> {
    if (imageUrls.length < 2) throw new FbError('A multi-photo post needs at least two photos.', 0, null);
    const photoIds: string[] = [];
    for (const url of imageUrls) {
      const r = await call('POST', `${pageId}/photos`, { url, published: 'false' });
      photoIds.push(str(r, 'id', 'photo'));
    }
    const params: Record<string, string> = { message: caption };
    photoIds.forEach((id, i) => {
      params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
    });
    const r = await call('POST', `${pageId}/feed`, params);
    return { postId: str(r, 'id', 'post') };
  }

  /** Reel step 1: opens an upload session. The returned video id is the Reel's id from here on. */
  async function startReel(): Promise<string> {
    const r = await call('POST', `${pageId}/video_reels`, { upload_phase: 'start' });
    return str(r, 'video_id', 'video');
  }

  /** Reel step 2: Facebook fetches the hosted file. */
  async function uploadReelFromUrl(videoId: string, fileUrl: string): Promise<void> {
    const r = await call('POST', `video-upload/${version}/${videoId}`, {}, { host: FB_UPLOAD_HOST, versioned: false, headers: { file_url: fileUrl } });
    if (r.success !== true) throw new FbError('Facebook did not accept the Reel upload.', 200, null);
  }

  async function getReelStatus(videoId: string): Promise<ReelStatus> {
    const r = await call('GET', videoId, { fields: 'status' });
    const s = (r.status ?? {}) as {
      video_status?: unknown;
      uploading_phase?: { status?: unknown; errors?: unknown };
      processing_phase?: { status?: unknown; error?: unknown };
      publishing_phase?: { publish_status?: unknown; error?: unknown };
    };
    if (typeof s.video_status !== 'string' || !VIDEO_STATUSES.includes(s.video_status)) throw new FbError('Facebook returned an unknown Reel status.', 200, null);
    const publishStatus = typeof s.publishing_phase?.publish_status === 'string' && PUBLISH_STATUSES.includes(s.publishing_phase.publish_status) ? (s.publishing_phase.publish_status as ReelPublishStatus) : null;
    const rawErr = [s.processing_phase?.error, s.publishing_phase?.error, s.uploading_phase?.errors].find((e) => e && (typeof e === 'string' || typeof e === 'object'));
    const detail = rawErr ? (typeof rawErr === 'string' ? rawErr : ((rawErr as { message?: unknown }).message ?? null)) : null;
    return {
      videoStatus: s.video_status as ReelVideoStatus,
      publishStatus,
      error: typeof detail === 'string' ? scrub(detail, token).slice(0, 200) : null,
    };
  }

  /** Reel step 3: publish. Safe to repeat for the same video id (a video can only become one Reel). */
  async function finishReel(videoId: string, description: string): Promise<void> {
    const r = await call('POST', `${pageId}/video_reels`, { video_id: videoId, upload_phase: 'finish', video_state: 'PUBLISHED', description });
    if (r.success !== true) throw new FbError('Facebook did not confirm the Reel publish.', 200, null);
  }

  async function getPermalink(id: string): Promise<string | null> {
    const r = await call('GET', id, { fields: 'permalink_url' });
    return absolutePermalink(r.permalink_url);
  }

  /**
   * Flat metric -> number. `id` is the post id (photo / multi-photo) or the video id (reel). If one metric is
   * rejected the call is retried per metric so the others still arrive.
   */
  async function getInsights(id: string, type: PostType): Promise<Record<string, number>> {
    const metrics = FB_INSIGHT_METRICS[type];
    if (!metrics.length) return {};
    const path = type === 'reel' ? `${id}/video_insights` : `${id}/insights`;
    const parse = (r: Record<string, unknown>, out: Record<string, number>) => {
      for (const row of (Array.isArray(r.data) ? r.data : []) as { name?: unknown; values?: { value?: unknown }[] }[]) {
        if (typeof row.name !== 'string') continue;
        const v = row.values?.[0]?.value;
        if (typeof v === 'number') out[row.name] = v;
        else if (v && typeof v === 'object') {
          // Breakdown metrics (reactions by type): keep one number, the sum.
          const sum = Object.values(v as Record<string, unknown>).reduce<number>((a, x) => a + (typeof x === 'number' ? x : 0), 0);
          out[row.name === 'post_reactions_by_type_total' ? 'post_reactions_total' : row.name] = sum;
        }
      }
    };
    const out: Record<string, number> = {};
    try {
      parse(await call('GET', path, { metric: metrics.join(','), period: 'lifetime' }), out);
      return out;
    } catch (e) {
      if (!(e instanceof FbError) || e.code !== 100) throw e;
    }
    let last: FbError | null = null;
    for (const m of metrics) {
      try {
        parse(await call('GET', path, { metric: m, period: 'lifetime' }), out);
      } catch (e) {
        if (e instanceof FbError && e.code === 100) last = e;
        else throw e;
      }
    }
    if (!Object.keys(out).length && last) throw last;
    return out;
  }

  return { publishPhoto, publishMultiPhoto, startReel, uploadReelFromUrl, getReelStatus, finishReel, getPermalink, getInsights };
}

export type FacebookClient = ReturnType<typeof createFacebookClient>;

/** Guard: why this post cannot go to a Facebook Page at all (null = it can). Stories are Instagram-only. */
export function facebookUnsupported(post: Pick<SocialPost, 'type'>, media: MediaForFb[]): string | null {
  if (post.type === 'story') return 'Stories post to Instagram only; Facebook Page Stories are not supported.';
  if (!media.length) return 'Post has no media.';
  if (post.type === 'reel' && media[0]!.kind !== 'video') return 'A Reel needs a video.';
  if (post.type === 'image' && media[0]!.kind !== 'image') return 'A photo post needs an image.';
  if (post.type === 'carousel' && (media.length < 2 || media.some((m) => m.kind !== 'image'))) return 'A Facebook multi-photo post needs two or more photos (no video).';
  return null;
}
