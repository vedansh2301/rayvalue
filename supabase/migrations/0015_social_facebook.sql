-- RayValue social CMS: Facebook Page as a second channel next to Instagram.
--
-- APPLY ORDER: after 0014, before deploying the Facebook publisher code. Nothing here is applied automatically.
-- A post now lists its channels; each channel keeps its own result. The post's status covers the whole post:
-- 'published' only when every selected channel has published.

alter table public.social_posts
  add column if not exists channels text[] not null default '{instagram}'
    check (cardinality(channels) between 1 and 2 and channels <@ array['instagram', 'facebook']::text[]),
  add column if not exists fb_post_id      text null check (fb_post_id is null or char_length(fb_post_id) <= 100),
  -- Video uploads (Reels) are a multi-step upload; the video id is kept while Facebook processes it.
  add column if not exists fb_video_id     text null check (fb_video_id is null or char_length(fb_video_id) <= 100),
  add column if not exists fb_permalink    text null check (fb_permalink is null or char_length(fb_permalink) <= 300),
  add column if not exists fb_published_at timestamptz null,
  add column if not exists fb_attempts     smallint not null default 0 check (fb_attempts >= 0),
  add column if not exists fb_last_error   text null check (fb_last_error is null or char_length(fb_last_error) <= 1000),
  add column if not exists fb_insights     jsonb null,
  add column if not exists fb_insights_at  timestamptz null;

-- 'published' used to require ig_media_id; now it requires the id of every selected channel.
alter table public.social_posts drop constraint if exists social_posts_check1;
alter table public.social_posts drop constraint if exists social_posts_published_ids;
alter table public.social_posts add constraint social_posts_published_ids check (
  status <> 'published'
  or ((not ('instagram' = any (channels)) or ig_media_id is not null)
      and (not ('facebook' = any (channels)) or fb_post_id is not null))
);

-- Channels new posts start with (editor default and generator). Facebook is off until the Page is connected.
alter table public.social_settings
  add column if not exists default_channels text[] not null default '{instagram}'
    check (cardinality(default_channels) between 1 and 2 and default_channels <@ array['instagram', 'facebook']::text[]);

notify pgrst, 'reload schema';
