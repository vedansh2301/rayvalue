/**
 * Form and request parsing for /admin/social (pure). Everything the owner submits is validated here, server-side,
 * against the same limits as the check constraints in supabase/migrations/0014_social_cms.sql.
 */
import { CHANNELS, POST_STATUSES, POST_TYPES, type Channel, type MediaKind, type MediaMime, type PostStatus, type PostType, type Slot } from './types';
import { isChannel } from './channels';
import { zonedToUtc, isValidSlot } from './schedule';
import { canTransition, statusOnSchedule } from './status';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

export const LIMITS = { title: 120, caption: 2200, alt: 1000, credit: 300, license: 120, templateName: 80, templateBody: 2200, thumbOffsetMs: 3_600_000, carouselMax: 10 } as const;

/** US time zones offered for posting slots. */
export const US_TIMEZONES = [
  { id: 'America/New_York', label: 'Eastern (New York)' },
  { id: 'America/Chicago', label: 'Central (Chicago)' },
  { id: 'America/Denver', label: 'Mountain (Denver)' },
  { id: 'America/Phoenix', label: 'Mountain, no DST (Phoenix)' },
  { id: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { id: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { id: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
] as const;
export const isUsTimezone = (tz: string) => US_TIMEZONES.some((z) => z.id === tz);

export const DOW_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const bad = (...errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });

const clean = (s: string | null | undefined) => (s ?? '').replace(/\r\n?/g, '\n');
const trimmed = (s: string | null | undefined) => clean(s).trim();

// ------------------------------------------------------------------ uploads
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const UPLOAD_TYPES: Record<MediaMime, { kind: MediaKind; ext: string }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
};
export const isUploadMime = (m: unknown): m is MediaMime => typeof m === 'string' && Object.hasOwn(UPLOAD_TYPES, m);

/** Check a file the browser wants to upload: only JPEG, MP4, MOV, at most 50 MB. */
export function validateUploadRequest(input: unknown): Result<{ mime: MediaMime; bytes: number }> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (!isUploadMime(o.mime)) return bad('Only JPEG photos and MP4 or MOV videos can be uploaded.');
  if (typeof o.bytes !== 'number' || !Number.isInteger(o.bytes) || o.bytes <= 0) return bad('File size is missing.');
  if (o.bytes > MAX_UPLOAD_BYTES) return bad('Files can be at most 50 MB.');
  return { ok: true, value: { mime: o.mime, bytes: o.bytes } };
}

/** uploads/YYYY/MM/<uuid>.<ext> (UTC month). */
export function newStoragePath(now: Date, uuid: string, mime: MediaMime): string {
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `uploads/${now.getUTCFullYear()}/${mm}/${uuid}.${UPLOAD_TYPES[mime].ext}`;
}
export const isUploadPath = (p: unknown): p is string => typeof p === 'string' && /^uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|mp4|mov)$/.test(p) && isUuid(p.slice(-40, -4));
export const publicUrlFor = (supabaseUrl: string, path: string) => `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/social/${path}`;

const optText = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? null : t.length <= max ? t : undefined;
};
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 2_147_483_647 ? Math.round(v) : null);

export interface MediaInsert {
  kind: MediaKind;
  storage_path: string;
  mime: MediaMime;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  alt_text: string | null;
  credit: string | null;
  license: string | null;
  source: 'upload';
}

/** Register an uploaded file as a media row. Width, height and duration come from the browser and may be missing. */
export function parseMediaRegistration(body: unknown): Result<MediaInsert> {
  const o = (body ?? {}) as Record<string, unknown>;
  const up = validateUploadRequest(o);
  if (!up.ok) return up;
  if (!isUploadPath(o.storage_path)) return bad('Invalid storage path.');
  const ext = o.storage_path.slice(o.storage_path.lastIndexOf('.') + 1);
  if (UPLOAD_TYPES[up.value.mime].ext !== ext) return bad('File type does not match the stored file.');
  const alt = optText(o.alt_text, LIMITS.alt);
  const credit = optText(o.credit, LIMITS.credit);
  const license = optText(o.license, LIMITS.license);
  if (alt === undefined) return bad(`Alt text can be at most ${LIMITS.alt} characters.`);
  if (credit === undefined) return bad(`Credit can be at most ${LIMITS.credit} characters.`);
  if (license === undefined) return bad(`License can be at most ${LIMITS.license} characters.`);
  const d = typeof o.duration_s === 'number' && Number.isFinite(o.duration_s) ? Math.round(o.duration_s * 100) / 100 : null;
  return {
    ok: true,
    value: {
      kind: UPLOAD_TYPES[up.value.mime].kind,
      storage_path: o.storage_path,
      mime: up.value.mime,
      bytes: up.value.bytes,
      width: posInt(o.width),
      height: posInt(o.height),
      duration_s: d !== null && d > 0 && d < 100000 ? d : null,
      alt_text: alt,
      credit,
      license,
      source: 'upload',
    },
  };
}

/** Editable media fields from a library form. */
export function parseMediaMeta(form: URLSearchParams): Result<{ id: string; alt_text: string | null; credit: string | null; license: string | null }> {
  const id = form.get('id');
  if (!isUuid(id)) return bad('Invalid media id.');
  const alt = optText(form.get('alt_text'), LIMITS.alt);
  const credit = optText(form.get('credit'), LIMITS.credit);
  const license = optText(form.get('license'), LIMITS.license);
  if (alt === undefined || credit === undefined || license === undefined) return bad('A field is too long (alt text 1000, credit 300, license 120 characters).');
  return { ok: true, value: { id, alt_text: alt, credit, license } };
}

// ------------------------------------------------------------------ posts
export const POST_ACTIONS = ['save', 'schedule', 'publish_now'] as const;
export type PostAction = (typeof POST_ACTIONS)[number];
export const WHEN_MODES = ['none', 'next_slot', 'custom', 'now'] as const;
export type WhenMode = (typeof WHEN_MODES)[number];

/**
 * The "Post to" checkboxes: a non-empty set of known channels, each at most once. Returned in canonical order.
 * `emptyMessage` is the error when nothing is ticked.
 */
export function parseChannels(values: string[], emptyMessage = 'Pick at least one channel to post to.'): Result<Channel[]> {
  if (values.some((v) => !isChannel(v))) return bad('Unknown channel.');
  const out = CHANNELS.filter((c) => values.includes(c));
  return out.length ? { ok: true, value: out } : bad(emptyMessage);
}

export interface PostFormInput {
  action: PostAction;
  type: PostType;
  channels: Channel[];
  title: string;
  caption: string;
  media_ids: string[];
  thumb_offset_ms: number | null;
  share_to_feed: boolean;
  numbers_confirmed: boolean;
  when: WhenMode;
  /** "YYYY-MM-DDTHH:MM" wall-clock in the settings time zone (custom mode). */
  scheduled_local: string;
  /** New alt text per selected media id (only the ids present in the form). */
  alt_text: Record<string, string | null>;
}

export function parsePostForm(form: URLSearchParams): Result<PostFormInput> {
  const errors: string[] = [];
  const action = form.get('action');
  if (!POST_ACTIONS.includes(action as PostAction)) return bad('Unknown action.');
  const type = form.get('type');
  if (!POST_TYPES.includes(type as PostType)) errors.push('Choose a post type.');
  const channels = parseChannels(form.getAll('channels'));
  if (!channels.ok) errors.push(...channels.errors);
  const title = trimmed(form.get('title'));
  if (title.length > LIMITS.title) errors.push(`Title can be at most ${LIMITS.title} characters.`);
  const caption = clean(form.get('caption'));
  if (caption.length > LIMITS.caption) errors.push(`Caption is ${caption.length} characters; the limit is ${LIMITS.caption}.`);

  const media_ids = form.getAll('media_ids');
  if (media_ids.some((m) => !isUuid(m))) errors.push('Invalid media selection.');
  if (new Set(media_ids).size !== media_ids.length) errors.push('The same media is selected twice.');
  if (media_ids.length > LIMITS.carouselMax) errors.push(`At most ${LIMITS.carouselMax} media items.`);

  const rawOffset = (form.get('thumb_offset_ms') ?? '').trim();
  let thumb: number | null = null;
  if (rawOffset !== '') {
    thumb = Number(rawOffset);
    if (!Number.isInteger(thumb) || thumb < 0 || thumb > LIMITS.thumbOffsetMs) {
      errors.push('Cover frame offset must be a whole number of milliseconds, 0 or more.');
      thumb = null;
    }
  }
  const isReel = type === 'reel';
  const whenRaw = form.get('when') ?? 'none';
  const when: WhenMode = WHEN_MODES.includes(whenRaw as WhenMode) ? (whenRaw as WhenMode) : 'none';
  const alt_text: Record<string, string | null> = {};
  for (const id of media_ids) {
    if (!form.has(`alt_${id}`)) continue;
    const a = optText(form.get(`alt_${id}`), LIMITS.alt);
    if (a === undefined) errors.push(`Alt text can be at most ${LIMITS.alt} characters.`);
    else alt_text[id] = a;
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      action: action as PostAction,
      type: type as PostType,
      channels: channels.ok ? channels.value : [],
      title,
      caption,
      media_ids,
      thumb_offset_ms: isReel ? thumb : null,
      share_to_feed: isReel ? form.has('share_to_feed') : true,
      numbers_confirmed: form.has('numbers_confirmed'),
      when: action === 'publish_now' ? 'now' : when,
      scheduled_local: (form.get('scheduled_local') ?? '').trim(),
      alt_text,
    },
  };
}

/** "2026-11-03T18:00" (a datetime-local value) as wall-clock time in `tz` -> UTC instant, or null if malformed. */
export function parseLocalDateTime(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return zonedToUtc(y, mo, d, h, mi, tz);
}

/** UTC instant -> "YYYY-MM-DDTHH:MM" wall-clock in `tz`, for prefilling a datetime-local input. */
export function toLocalInput(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/**
 * Status a post lands in when the owner schedules it. Passing checks -> scheduled; failing checks -> review
 * (or draft when the post is scheduled now, since scheduled -> review is not an allowed move).
 * null when the move is not allowed from `from` (e.g. a published post).
 */
export function resolveScheduleTarget(from: PostStatus, passed: boolean, autoPublish: boolean): 'scheduled' | 'review' | 'draft' | null {
  const want = statusOnSchedule({ checksPassed: passed, autoPublish, byOwner: true });
  if (from === want) return want;
  if (canTransition(from, want)) return want;
  if (want === 'review' && canTransition(from, 'draft')) return 'draft';
  return null;
}

// ------------------------------------------------------------------ list filters
export interface ListFilters {
  status: PostStatus | null;
  type: PostType | null;
  channel: Channel | null;
  q: string;
}

/** PostgREST-safe search text: drop characters that mean something in a filter expression. */
export const sanitizeSearch = (q: string) => q.replace(/[,()*%\\"'\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export function parseListFilters(p: URLSearchParams): ListFilters {
  const status = p.get('status');
  const type = p.get('type');
  const channel = p.get('channel');
  return {
    status: POST_STATUSES.includes(status as PostStatus) ? (status as PostStatus) : null,
    type: POST_TYPES.includes(type as PostType) ? (type as PostType) : null,
    channel: isChannel(channel) ? channel : null,
    q: sanitizeSearch(p.get('q') ?? ''),
  };
}

// ------------------------------------------------------------------ settings
export interface SettingsInput {
  auto_publish: boolean;
  paused: boolean;
  timezone: string;
  notify_email: boolean;
  slots: Slot[];
  default_channels: Channel[];
}

export function parseSettingsForm(form: URLSearchParams): Result<SettingsInput> {
  const tz = form.get('timezone') ?? '';
  if (!isUsTimezone(tz)) return bad('Choose a time zone from the list.');
  const channels = parseChannels(form.getAll('default_channels'), 'Pick at least one default channel.');
  if (!channels.ok) return channels;
  let raw: unknown;
  try {
    raw = JSON.parse(form.get('slots') ?? '[]');
  } catch {
    return bad('Posting slots could not be read.');
  }
  if (!Array.isArray(raw)) return bad('Posting slots could not be read.');
  if (raw.length > 28) return bad('At most 28 posting slots.');
  const slots: Slot[] = [];
  for (const s of raw) {
    if (!isValidSlot(s)) return bad('Each slot needs a weekday, a time (HH:MM) and a post type.');
    slots.push({ dow: s.dow, time: s.time, type: s.type });
  }
  const key = (s: Slot) => `${s.dow}|${s.time}|${s.type}`;
  if (new Set(slots.map(key)).size !== slots.length) return bad('Two slots are identical.');
  slots.sort((a, b) => a.dow - b.dow || a.time.localeCompare(b.time) || a.type.localeCompare(b.type));
  return { ok: true, value: { auto_publish: form.has('auto_publish'), paused: form.has('paused'), timezone: tz, notify_email: form.has('notify_email'), slots, default_channels: channels.value } };
}

// ------------------------------------------------------------------ templates
export function parseTemplateForm(form: URLSearchParams): Result<{ kind: 'caption' | 'hashtags'; name: string; body: string }> {
  const kind = form.get('kind');
  if (kind !== 'caption' && kind !== 'hashtags') return bad('Choose caption or hashtag set.');
  const name = trimmed(form.get('name'));
  const body = clean(form.get('body')).trim();
  if (name.length < 1 || name.length > LIMITS.templateName) return bad(`Name must be 1 to ${LIMITS.templateName} characters.`);
  if (body.length < 1 || body.length > LIMITS.templateBody) return bad(`Text must be 1 to ${LIMITS.templateBody} characters.`);
  return { ok: true, value: { kind, name, body } };
}

// ------------------------------------------------------------------ generate
/** Target for a generator template: a utility slug, a state code, or nothing. */
export function parseGenerateTarget(kind: 'utility' | 'state' | 'none', raw: string | null, utilitySlugs: readonly string[]): Result<string> {
  const t = (raw ?? '').trim();
  if (kind === 'none') return { ok: true, value: '' };
  if (kind === 'state') return t === 'fl' || t === 'ca' ? { ok: true, value: t } : bad('Choose Florida or California.');
  return utilitySlugs.includes(t) ? { ok: true, value: t } : bad('Choose a utility.');
}
