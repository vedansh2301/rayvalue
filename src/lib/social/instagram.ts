/**
 * Small Instagram client for the social publisher: "Instagram API with Instagram Login" (host graph.instagram.com).
 * `fetch` is injected so everything is unit-testable with fakes. The access token is sent in an Authorization header
 * (the one exception is refresh_access_token, which only accepts it as a query parameter) and is never logged;
 * every error message is scrubbed of it.
 *
 * Verified 2026-10-26 against the docs and with read-only calls on the live account (GET /me, content_publishing_limit):
 * - Version: v26.0 (the version used in the docs' examples). Bearer-header auth works.
 *   https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
 * - Container params (POST /{ig-user-id}/media): https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
 *     reel:     media_type=REELS, video_url, caption, share_to_feed=true|false, thumb_offset (ms)
 *     image:    image_url (JPEG), caption   (no media_type)
 *     carousel: children first: image_url|video_url(+media_type=VIDEO) with is_carousel_item=true (no caption), then
 *               media_type=CAROUSEL, children=<comma separated ids>, caption
 *     story:    media_type=STORIES, image_url or video_url (no caption)
 * - Container status: GET /{container-id}?fields=status_code -> EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED.
 *   Docs: poll about once a minute, for at most 5 minutes. Containers expire after 24 hours.
 * - Publish: POST /{ig-user-id}/media_publish, creation_id=<container id> -> { id } (the media id).
 *   Quota 100 API posts per rolling 24h (GET /{ig-user-id}/content_publishing_limit).
 * - Permalink: GET /{media-id}?fields=permalink.  https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media
 * - Refresh: GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<token>;
 *   the token must be at least 24h old and not expired; new lifetime 60 days.
 *   https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token
 * - Insights (GET /{media-id}/insights?metric=a,b): https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights
 *   Valid now: views, reach, likes, comments, saved, shares, total_interactions (feed + reels), plus ig_reels_avg_watch_time
 *   for reels; stories: views, reach, shares, replies, total_interactions (available for 24h only). `impressions`
 *   is deprecated for media after 2 Jul 2024 and `plays`/`video_views` are gone, so none of them are requested.
 *   Insights are not available for the child items of an album, only for the carousel itself.
 * - Location tag (checked 2026-10-26, same reference page): `location_id` = id of a Facebook Page with location data, on
 *   image, Reel and carousel PARENT containers ("Not supported on images or videos in carousels"; not in the Stories
 *   syntax). A Page without location data is refused: HTTP 400, code 100, subcode 2207019
 *   (INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID), seen live on an unpublished container. The publisher then creates the
 *   container once more without the tag (see createContainer) instead of failing the post.
 * - Alt text: `alt_text` on image containers and image carousel items only ("Reels and stories are not supported");
 *   accepted live on an unpublished image container and an unpublished carousel item, 2026-10-26.
 */
import type { PostType, SocialMedia, SocialPost } from './types';

export const IG_HOST = 'https://graph.instagram.com';
export const IG_VERSION = 'v26.0';

export type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';

export class IgError extends Error {
  constructor(
    message: string,
    /** HTTP status, 0 for network failures. */
    readonly status: number,
    /** Instagram error code (190 = bad/expired token, 4/17/32/613 = rate limit, 100 = bad parameter). */
    readonly code: number | null,
    /** error_subcode (2207019 = invalid location id). */
    readonly subcode: number | null = null,
  ) {
    super(message);
    this.name = 'IgError';
  }
  /** Worth retrying later without changing anything. */
  get transient() {
    return this.status === 0 || this.status >= 500 || (this.code !== null && [1, 2, 4, 17, 32, 341, 368, 613].includes(this.code));
  }
}

export interface IgClientOptions {
  token: string;
  userId: string;
  fetch: typeof fetch;
  version?: string;
  /** Reject every POST (nothing can be created or published). Used by SOCIAL_DRY_RUN. */
  readOnly?: boolean;
  /** Wait between carousel-child status checks (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export type PostForContainer = Pick<SocialPost, 'type' | 'caption' | 'share_to_feed' | 'thumb_offset_ms'>;
export type MediaForContainer = Pick<SocialMedia, 'kind' | 'public_url'> & { alt_text?: string | null };

export interface ContainerOptions {
  /** Facebook Page id with location data to tag the post with (image, Reel, carousel parent). */
  locationId?: string | null;
  /** Called when Instagram refuses the location; the container is then created again without it. */
  onLocationRejected?: (message: string) => void | Promise<void>;
}

export const IG_INVALID_LOCATION_SUBCODE = 2207019;
/** A refusal worth one more try without the location: the documented invalid-location subcode, or any non-transient "bad parameter". */
export const isLocationRejection = (e: unknown) => e instanceof IgError && !e.transient && (e.subcode === IG_INVALID_LOCATION_SUBCODE || e.code === 100);

const altParam = (m: MediaForContainer): Record<string, string> => (m.kind === 'image' && m.alt_text ? { alt_text: m.alt_text } : {});
const locParam = (id: string | null | undefined): Record<string, string> => (id ? { location_id: id } : {});

/** Strip anything that looks like a token from text that may be stored, emailed or logged. */
export function scrub(text: string, token?: string): string {
  let out = text;
  if (token) out = out.split(token).join('[token]');
  return out.replace(/access_token=[^&\s"']+/gi, 'access_token=[token]').replace(/\bIG[A-Za-z0-9_-]{30,}/g, '[token]').replace(/\bEA[A-Za-z0-9_-]{30,}/g, '[token]');
}

/** Metrics to ask for per post type (see the header comment). */
export const INSIGHT_METRICS: Record<PostType, string[]> = {
  reel: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'ig_reels_avg_watch_time'],
  image: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'],
  carousel: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'],
  story: ['views', 'reach', 'shares', 'replies', 'total_interactions'],
};

/**
 * The form fields for the container (or carousel children; the parent is carouselParentParams) of one post. Pure.
 * `locationId` goes on image and Reel containers; alt text on images and image carousel items.
 */
export function containerParams(post: PostForContainer, media: MediaForContainer[], opts: Pick<ContainerOptions, 'locationId'> = {}): Record<string, string>[] {
  const m = media[0];
  if (!m) throw new IgError('Post has no media.', 0, null);
  switch (post.type) {
    case 'reel': {
      if (m.kind !== 'video') throw new IgError('A Reel needs a video.', 0, null);
      return [
        {
          media_type: 'REELS',
          video_url: m.public_url,
          caption: post.caption,
          share_to_feed: String(post.share_to_feed),
          ...(post.thumb_offset_ms !== null ? { thumb_offset: String(post.thumb_offset_ms) } : {}),
          ...locParam(opts.locationId),
        },
      ];
    }
    case 'image': {
      if (m.kind !== 'image') throw new IgError('A photo post needs an image.', 0, null);
      return [{ image_url: m.public_url, caption: post.caption, ...altParam(m), ...locParam(opts.locationId) }];
    }
    case 'story':
      return [{ media_type: 'STORIES', ...(m.kind === 'video' ? { video_url: m.public_url } : { image_url: m.public_url }) }];
    case 'carousel':
      // One params object per child; the parent is built by the client once the child ids exist.
      return media.map((x) => ({ is_carousel_item: 'true', ...(x.kind === 'video' ? { media_type: 'VIDEO', video_url: x.public_url } : { image_url: x.public_url, ...altParam(x) }) }));
  }
}

/** The carousel parent container: the children's ids, the caption and the location tag. Pure. */
export function carouselParentParams(post: Pick<PostForContainer, 'caption'>, childIds: string[], locationId?: string | null): Record<string, string> {
  return { media_type: 'CAROUSEL', children: childIds.join(','), caption: post.caption, ...locParam(locationId) };
}

export function createInstagramClient(opts: IgClientOptions) {
  const { token, userId, fetch: f } = opts;
  const version = opts.version ?? IG_VERSION;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 20_000;

  async function call(method: 'GET' | 'POST', path: string, params: Record<string, string> = {}, extra: { tokenInQuery?: boolean; unversioned?: boolean } = {}): Promise<Record<string, unknown>> {
    if (method === 'POST' && opts.readOnly) throw new IgError('Dry run: Instagram write calls are disabled.', 0, null);
    const url = new URL(`${IG_HOST}/${extra.unversioned ? '' : `${version}/`}${path}`);
    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: string | undefined;
    if (extra.tokenInQuery) url.searchParams.set('access_token', token);
    else headers.Authorization = `Bearer ${token}`;
    if (method === 'GET') for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    else {
      body = new URLSearchParams(params).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    let res: Response;
    try {
      res = await f(url.toString(), { method, headers, ...(body !== undefined ? { body } : {}), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new IgError(`Instagram request failed (${e instanceof Error ? e.name : 'network error'}).`, 0, null);
    }
    const json = (await res.json().catch(() => null)) as { error?: { message?: unknown; code?: unknown; error_subcode?: unknown; error_user_msg?: unknown } } | null;
    if (!res.ok || json?.error) {
      const err = json?.error;
      const code = typeof err?.code === 'number' ? err.code : null;
      const subcode = typeof err?.error_subcode === 'number' ? err.error_subcode : null;
      const sub = subcode !== null ? `/${subcode}` : '';
      const text = typeof err?.error_user_msg === 'string' ? err.error_user_msg : typeof err?.message === 'string' ? err.message : `HTTP ${res.status}`;
      throw new IgError(scrub(`Instagram ${res.status}${code !== null ? ` (code ${code}${sub})` : ''}: ${text}`, token).slice(0, 300), res.status, code, subcode);
    }
    return (json ?? {}) as Record<string, unknown>;
  }

  const idOf = (r: Record<string, unknown>, what: string): string => {
    if (typeof r.id !== 'string' || !r.id) throw new IgError(`Instagram returned no ${what} id.`, 200, null);
    return r.id;
  };

  async function getContainerStatus(containerId: string): Promise<{ status: ContainerStatus; detail: string | null }> {
    const r = await call('GET', containerId, { fields: 'status_code,status' });
    const s = r.status_code;
    if (s !== 'IN_PROGRESS' && s !== 'FINISHED' && s !== 'ERROR' && s !== 'EXPIRED' && s !== 'PUBLISHED') throw new IgError('Instagram returned an unknown container status.', 200, null);
    return { status: s, detail: typeof r.status === 'string' ? scrub(r.status, token).slice(0, 200) : null };
  }

  /** POST the container; if it carries a location that Instagram refuses, report it and POST once more without it. */
  async function postWithLocation(params: Record<string, string>, what: string, opts: ContainerOptions): Promise<string> {
    try {
      return idOf(await call('POST', `${userId}/media`, params), what);
    } catch (e) {
      if (!params.location_id || !isLocationRejection(e)) throw e;
      await opts.onLocationRejected?.((e as IgError).message);
      const { location_id: _dropped, ...rest } = params;
      return idOf(await call('POST', `${userId}/media`, rest), what);
    }
  }

  /** Creates the container for a post (for a carousel: the children first, then the parent). Returns the id to publish. */
  async function createContainer(post: PostForContainer, media: MediaForContainer[], opts: ContainerOptions = {}): Promise<string> {
    const params = containerParams(post, media, opts);
    if (post.type !== 'carousel') return postWithLocation(params[0]!, 'container', opts);

    const children: string[] = [];
    for (const p of params) children.push(idOf(await call('POST', `${userId}/media`, p), 'carousel item'));
    // Video children need processing before the parent can reference them.
    for (const [i, child] of children.entries()) {
      if (!('video_url' in params[i]!)) continue;
      let ready = false;
      for (let tries = 0; tries < 6 && !ready; tries++) {
        const s = await getContainerStatus(child);
        if (s.status === 'FINISHED') ready = true;
        else if (s.status === 'ERROR' || s.status === 'EXPIRED') throw new IgError(`Carousel item ${i + 1} failed to process${s.detail ? `: ${s.detail}` : '.'}`, 200, null);
        else await sleep(4000);
      }
      if (!ready) throw new IgError(`Carousel item ${i + 1} is still processing; will retry.`, 0, null);
    }
    return postWithLocation(carouselParentParams(post, children, opts.locationId), 'carousel', opts);
  }

  return {
    createContainer,
    getContainerStatus,
    /** media_publish: returns the Instagram media id. */
    async publishContainer(containerId: string): Promise<string> {
      return idOf(await call('POST', `${userId}/media_publish`, { creation_id: containerId }), 'media');
    },
    async getPermalink(mediaId: string): Promise<string | null> {
      const r = await call('GET', mediaId, { fields: 'permalink' });
      return typeof r.permalink === 'string' ? r.permalink : null;
    },
    /** Exchanges the token for a fresh long-lived one (token must be 24h+ old and unexpired). */
    async refreshToken(): Promise<{ accessToken: string; expiresInSeconds: number | null }> {
      const r = await call('GET', 'refresh_access_token', { grant_type: 'ig_refresh_token' }, { tokenInQuery: true, unversioned: true });
      if (typeof r.access_token !== 'string' || r.access_token.length < 20) throw new IgError('Instagram returned no refreshed token.', 200, null);
      return { accessToken: r.access_token, expiresInSeconds: typeof r.expires_in === 'number' ? r.expires_in : null };
    },
    /** Flat metric -> number. If one metric is rejected the call is retried per metric so the others still arrive. */
    async getInsights(mediaId: string, type: PostType): Promise<Record<string, number>> {
      const metrics = INSIGHT_METRICS[type];
      const parse = (r: Record<string, unknown>, out: Record<string, number>) => {
        for (const row of (Array.isArray(r.data) ? r.data : []) as { name?: unknown; values?: { value?: unknown }[]; total_value?: { value?: unknown } }[]) {
          const v = row.values?.[0]?.value ?? row.total_value?.value;
          if (typeof row.name === 'string' && typeof v === 'number') out[row.name] = v;
        }
      };
      const out: Record<string, number> = {};
      try {
        parse(await call('GET', `${mediaId}/insights`, { metric: metrics.join(',') }), out);
        return out;
      } catch (e) {
        if (!(e instanceof IgError) || e.code !== 100) throw e;
      }
      let last: IgError | null = null;
      for (const m of metrics) {
        try {
          parse(await call('GET', `${mediaId}/insights`, { metric: m }), out);
        } catch (e) {
          if (e instanceof IgError && e.code === 100) last = e;
          else throw e;
        }
      }
      if (!Object.keys(out).length && last) throw last;
      return out;
    },
  };
}

export type InstagramClient = ReturnType<typeof createInstagramClient>;
