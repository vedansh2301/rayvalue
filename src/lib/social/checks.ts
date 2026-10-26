/**
 * Pre-publish checks for a social post (pure). A post goes out automatically only when no `error` check fails;
 * otherwise it waits in "review". Covers Instagram's publishing limits and CLAUDE.md rules 1 (every number traces to
 * the database), 2 (the federal 25D credit is never shown as available) and 5 (nothing reads as official/government).
 */
import type { Channel, CheckResult, DataRef, MediaKind, MediaMime, PostType } from './types';

/**
 * Instagram Content Publishing limits (developers.facebook.com/docs/instagram-platform/content-publishing,
 * checked 2026-10-26). Platform constraints, not figures shown to readers.
 */
export const IG_LIMITS = {
  captionChars: 2200,
  hashtags: 30,
  mentions: 20,
  carouselMin: 2,
  carouselMax: 10,
  reelSeconds: { min: 3, max: 900 },
  storyVideoSeconds: { min: 3, max: 60 },
  carouselVideoSeconds: { min: 3, max: 60 },
  /** Feed photos: width / height between 4:5 and 1.91:1. */
  imageAspect: { min: 4 / 5, max: 1.91 },
} as const;

export interface MediaForCheck {
  kind: MediaKind;
  mime: MediaMime;
  width: number | null;
  height: number | null;
  duration_s: number | null;
}

export interface PostForCheck {
  type: PostType;
  caption: string;
  data_refs: DataRef[];
  numbers_confirmed: boolean;
  media: MediaForCheck[];
  /** Defaults to Instagram only (posts made before 0015). */
  channels?: Channel[];
}

const ok = (key: string, level: CheckResult['level'], message: string): CheckResult => ({ key, ok: true, level, message });
const fail = (key: string, level: CheckResult['level'], message: string): CheckResult => ({ key, ok: false, level, message });

export const countHashtags = (caption: string) => (caption.match(/(^|[^\w&])#[\p{L}\p{N}_]+/gu) ?? []).length;
export const countMentions = (caption: string) => (caption.match(/(^|[^\w])@[\w.]+/g) ?? []).length;

// ------------------------------------------------------------------ rule 2: federal credit
const CREDIT_MENTION =
  /\b25D\b|\bITC\b|investment tax credit|residential clean energy credit|federal\s+(solar\s+)?(tax\s+)?credit|\b(30|thirty)\s*(%|percent)\s+(federal\s+)?(solar\s+)?(tax\s+)?credit|solar\s+tax\s+credit/i;
const CREDIT_GONE =
  /\b(ended|ends|expired|expires|gone|no longer|eliminated|repealed|went away|lost|without|zero)\b|\$0\b|\b0\s*%|isn['’]t available|not available|is over/i;

const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());

/** Sentences that mention the federal credit without saying it is gone. */
export function creditClaims(caption: string): string[] {
  return sentences(caption).filter((s) => CREDIT_MENTION.test(s) && !CREDIT_GONE.test(s));
}

// ------------------------------------------------------------------ rule 5: government look
const OFFICIAL = /\bofficial(ly)?\b|\.gov\b|\bgovernment[- ](approved|endorsed|backed|program|certified)\b|\bstate[- ](approved|endorsed|certified)\b|\bendorsed by\b/i;

export function officialWording(caption: string): string[] {
  return [...new Set((caption.match(new RegExp(OFFICIAL.source, 'gi')) ?? []).map((m) => m.toLowerCase()))];
}

// ------------------------------------------------------------------ rule 1: numbers trace to data
/** Program names that contain digits but are not figures. */
const NAMED_TERMS = /\bNEM\s?[123](\.0)?\b|\b25D\b|\b24\/7\b/gi;

/** "$1,234.50" -> "1234.5", "9.0" -> "9", "35%" -> "35". */
export function normalizeNumber(raw: string): string {
  const n = Number(raw.replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? String(n) : raw;
}

/** Numbers a reader sees in the caption, ignoring hashtags, @mentions, URLs, named terms and 4-digit years. */
export function captionNumbers(caption: string): string[] {
  const text = caption
    .replace(/https?:\/\/\S+|\b[\w-]+\.(com|org|net|gov)\S*/gi, ' ')
    .replace(/[#@][\p{L}\p{N}_.]+/gu, ' ')
    .replace(NAMED_TERMS, ' ');
  const out: string[] = [];
  for (const m of text.matchAll(/\$?\d[\d,]*(\.\d+)?%?/g)) {
    const v = normalizeNumber(m[0]);
    if (/^(19|20)\d{2}$/.test(v) && !m[0].includes('$') && !m[0].includes(',')) continue; // a year
    out.push(v);
  }
  return [...new Set(out)];
}

/** Caption numbers that no data_ref accounts for. */
export function untracedNumbers(caption: string, refs: DataRef[]): string[] {
  const known = new Set(refs.flatMap((r) => captionNumbersRaw(r.value)));
  return captionNumbers(caption).filter((n) => !known.has(n));
}

/** Every number inside a data_ref value ("9–12" -> ["9", "12"]). */
function captionNumbersRaw(value: string): string[] {
  return [...value.matchAll(/\$?\d[\d,]*(\.\d+)?%?/g)].map((m) => normalizeNumber(m[0]));
}

// ------------------------------------------------------------------ media
function mediaChecks(type: PostType, media: MediaForCheck[]): CheckResult[] {
  const out: CheckResult[] = [];
  const count = media.length;
  const want =
    type === 'carousel' ? `${IG_LIMITS.carouselMin}–${IG_LIMITS.carouselMax} items` : type === 'reel' ? '1 video' : type === 'image' ? '1 photo' : '1 photo or video';
  const countOk =
    type === 'carousel'
      ? count >= IG_LIMITS.carouselMin && count <= IG_LIMITS.carouselMax
      : count === 1 && (type === 'reel' ? media[0]!.kind === 'video' : type === 'image' ? media[0]!.kind === 'image' : true);
  out.push(countOk ? ok('media_count', 'error', `Media: ${want}.`) : fail('media_count', 'error', `A ${type} needs ${want}; it has ${count}.`));

  const badFormat = media.filter((m) => (m.kind === 'image' ? m.mime !== 'image/jpeg' : m.mime !== 'video/mp4' && m.mime !== 'video/quicktime'));
  out.push(badFormat.length ? fail('media_format', 'error', 'Photos must be JPEG and videos MP4 or MOV.') : ok('media_format', 'error', 'File formats are supported.'));

  const range = type === 'reel' ? IG_LIMITS.reelSeconds : type === 'story' ? IG_LIMITS.storyVideoSeconds : IG_LIMITS.carouselVideoSeconds;
  for (const [i, m] of media.entries()) {
    const label = count > 1 ? `Item ${i + 1}` : 'Video';
    if (m.kind === 'video') {
      if (m.duration_s === null) out.push(fail(`duration_${i}`, 'error', `${label}: length unknown; re-upload so it can be measured.`));
      else if (m.duration_s < range.min || m.duration_s > range.max) out.push(fail(`duration_${i}`, 'error', `${label} is ${m.duration_s}s; allowed ${range.min}–${range.max}s.`));
      if (type === 'reel' && m.width && m.height && Math.abs(m.width / m.height - 9 / 16) > 0.02) {
        out.push(fail(`aspect_${i}`, 'warn', `${label} is ${m.width}×${m.height}; Reels look best at 9:16 (1080×1920).`));
      }
    } else if (type !== 'story' && m.width && m.height) {
      const r = m.width / m.height;
      if (r < IG_LIMITS.imageAspect.min - 0.005 || r > IG_LIMITS.imageAspect.max + 0.005) {
        out.push(fail(`aspect_${i}`, 'error', `${count > 1 ? label : 'Photo'} is ${m.width}×${m.height}; feed photos must be between 4:5 and 1.91:1.`));
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ all checks
export function runChecks(post: PostForCheck): CheckResult[] {
  const out: CheckResult[] = [];
  const { caption } = post;

  out.push(
    caption.length <= IG_LIMITS.captionChars
      ? ok('caption_length', 'error', `Caption ${caption.length}/${IG_LIMITS.captionChars} characters.`)
      : fail('caption_length', 'error', `Caption is ${caption.length} characters; the limit is ${IG_LIMITS.captionChars}.`),
  );
  const tags = countHashtags(caption);
  out.push(tags <= IG_LIMITS.hashtags ? ok('hashtags', 'error', `${tags}/${IG_LIMITS.hashtags} hashtags.`) : fail('hashtags', 'error', `${tags} hashtags; the limit is ${IG_LIMITS.hashtags}.`));
  const mentions = countMentions(caption);
  out.push(mentions <= IG_LIMITS.mentions ? ok('mentions', 'error', `${mentions}/${IG_LIMITS.mentions} @mentions.`) : fail('mentions', 'error', `${mentions} @mentions; the limit is ${IG_LIMITS.mentions}.`));
  if (post.type !== 'story' && !caption.trim()) out.push(fail('caption_empty', 'warn', 'No caption.'));

  const claims = creditClaims(caption);
  out.push(
    claims.length
      ? fail('federal_credit', 'error', `Mentions the federal tax credit without saying it ended for 2026+ installs: “${claims[0]!.trim().slice(0, 120)}”.`)
      : ok('federal_credit', 'error', 'No claim that the federal credit is available.'),
  );

  const official = officialWording(caption);
  out.push(official.length ? fail('official_wording', 'error', `Reads as official/government: ${official.join(', ')}.`) : ok('official_wording', 'error', 'No official or government wording.'));

  const untraced = untracedNumbers(caption, post.data_refs);
  out.push(
    untraced.length === 0
      ? ok('numbers_traced', 'error', 'Every number traces to the database.')
      : post.numbers_confirmed
        ? ok('numbers_traced', 'error', `Numbers ${untraced.join(', ')} confirmed by the owner.`)
        : fail('numbers_traced', 'error', `Numbers not traced to the database: ${untraced.join(', ')}. Use a data template or tick “I checked every number”.`),
  );

  out.push(...mediaChecks(post.type, post.media));

  const channels = post.channels ?? ['instagram'];
  if (channels.length === 0) out.push(fail('channels', 'error', 'Pick at least one channel.'));
  // Facebook Page Stories are not available through the Pages API.
  if (post.type === 'story' && channels.includes('facebook')) out.push(fail('channels', 'error', 'Stories post to Instagram only; untick Facebook.'));
  return out;
}

/** True when no error-level check failed. */
export const checksPassed = (results: CheckResult[]) => results.every((r) => r.ok || r.level !== 'error');
