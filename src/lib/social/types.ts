/** Social CMS row shapes (supabase/migrations/0014_social_cms.sql). Shared by /admin/social, the publisher and the generator. */

export const POST_TYPES = ['reel', 'image', 'carousel', 'story'] as const;
export type PostType = (typeof POST_TYPES)[number];

export const POST_STATUSES = ['draft', 'review', 'scheduled', 'publishing', 'published', 'failed', 'archived'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const CHANNELS = ['instagram', 'facebook'] as const;
export type Channel = (typeof CHANNELS)[number];

export type MediaKind = 'video' | 'image';
export type MediaMime = 'video/mp4' | 'video/quicktime' | 'image/jpeg';

/** Where a number shown in a post came from: one database value. `value` is the text as it appears in the post. */
export interface DataRef {
  table: string;
  id: string;
  field: string;
  value: string;
}

export interface SocialMedia {
  id: string;
  kind: MediaKind;
  storage_path: string;
  public_url: string;
  mime: MediaMime;
  bytes: number | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  alt_text: string | null;
  credit: string | null;
  license: string | null;
  source: 'upload' | 'generated';
  created_at: string;
}

export interface SocialPost {
  id: string;
  type: PostType;
  status: PostStatus;
  title: string;
  caption: string;
  origin: 'upload' | 'generated';
  template_key: string | null;
  data_refs: DataRef[];
  numbers_confirmed: boolean;
  share_to_feed: boolean;
  thumb_offset_ms: number | null;
  scheduled_at: string | null;
  checks: CheckResult[];
  checks_passed: boolean;
  ig_container_id: string | null;
  ig_media_id: string | null;
  ig_permalink: string | null;
  published_at: string | null;
  attempts: number;
  last_error: string | null;
  insights: Record<string, number> | null;
  insights_at: string | null;
  /** Where the post goes (0015). Status 'published' = every channel here has published. */
  channels: Channel[];
  fb_post_id: string | null;
  fb_video_id: string | null;
  fb_permalink: string | null;
  fb_published_at: string | null;
  fb_attempts: number;
  fb_last_error: string | null;
  fb_insights: Record<string, number> | null;
  fb_insights_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Slot {
  /** 0 = Sunday ... 6 = Saturday, in the settings timezone. */
  dow: number;
  /** "HH:MM", 24-hour, in the settings timezone. */
  time: string;
  type: PostType;
}

export interface SocialSettings {
  auto_publish: boolean;
  paused: boolean;
  timezone: string;
  notify_email: boolean;
  slots: Slot[];
  /** Channels new posts start with. */
  default_channels: Channel[];
  updated_at: string;
}

export interface CheckResult {
  key: string;
  ok: boolean;
  /** error = blocks scheduling/publishing; warn = shown only. */
  level: 'error' | 'warn';
  message: string;
}
