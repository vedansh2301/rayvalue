/**
 * Social post generator. Renders Reels (MP4) and carousels (JPEG) from RayValue's live data and queues them as posts.
 *
 *   npm run social:generate -- --template utility-payback-reel --target fpl [--channel instagram|facebook] [--draft] [--dry-run]
 *   npm run social:generate -- --auto [--channel instagram|facebook] [--draft] [--dry-run]
 *
 * One post per channel, each with its own caption: an explicit run makes one for --channel (default: the first of
 * social_settings.default_channels); --auto makes one per default channel for every planned job, sharing the job's slot.
 * --draft queues every post as a draft with no slot, so the owner can preview it before it is scheduled.
 * --dry-run reads data, renders into ./out/social/<template>__<target>__<channel>/ and writes nothing to Storage or the database.
 * Without it: SUPABASE_URL + SUPABASE_SECRET_KEY are required (the run is skipped with a log line when they are not set).
 * Never posts to Instagram; the publisher does that from the queue.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createRepo } from '../../src/lib/db/repo';
import { DEFAULT_CHANNELS, isChannel, normalizeChannels } from '../../src/lib/social/channels';
import { checksPassed, runChecks, type MediaForCheck } from '../../src/lib/social/checks';
import { countFreeSlots, isValidJob, planAuto, COOLDOWN_DAYS, type HistoryItem, type Job } from '../../src/lib/social/gen/plan';
import { decideQueueState } from '../../src/lib/social/gen/queue';
import { describeSlide, truncateAlt } from '../../src/lib/social/gen/templates';
import type { GeneratedPost } from '../../src/lib/social/gen/types';
import { isValidSlot } from '../../src/lib/social/schedule';
import { locationKeyForTarget } from '../../src/lib/social/locations';
import { templateByKey } from '../../src/lib/social/template-keys';
import type { Channel, SocialLocation, SocialSettings } from '../../src/lib/social/types';
import { buildPost } from './build';
import { SocialDb } from './db';
import { hasFfmpeg, renderPost, renderSlidesOnly, type RenderedFile } from './render';

// ------------------------------------------------------------------ settings
const DEFAULT_SETTINGS: Pick<SocialSettings, 'auto_publish' | 'paused' | 'timezone' | 'slots' | 'default_channels'> = {
  auto_publish: true,
  paused: false,
  default_channels: [...DEFAULT_CHANNELS],
  timezone: 'America/New_York',
  slots: [
    { dow: 1, time: '18:00', type: 'reel' },
    { dow: 2, time: '12:00', type: 'carousel' },
    { dow: 3, time: '18:00', type: 'reel' },
    { dow: 4, time: '12:00', type: 'carousel' },
    { dow: 5, time: '18:00', type: 'reel' },
  ],
};

async function loadSettings(db: SocialDb): Promise<typeof DEFAULT_SETTINGS> {
  const [row] = await db.select<Partial<SocialSettings>>('social_settings', { select: 'auto_publish,paused,timezone,slots,default_channels', limit: '1' });
  if (!row) return DEFAULT_SETTINGS;
  return {
    auto_publish: row.auto_publish ?? DEFAULT_SETTINGS.auto_publish,
    paused: row.paused ?? DEFAULT_SETTINGS.paused,
    timezone: row.timezone ?? DEFAULT_SETTINGS.timezone,
    slots: Array.isArray(row.slots) ? row.slots.filter(isValidSlot) : DEFAULT_SETTINGS.slots,
    default_channels: normalizeChannels(row.default_channels),
  };
}

const mediaForCheck = (files: RenderedFile[]): MediaForCheck[] =>
  files.map((f) => ({ kind: f.mime === 'video/mp4' ? 'video' : 'image', mime: f.mime, width: f.info.width, height: f.info.height, duration_s: f.info.durationS }));

/** Alt text per media item: one description for a Reel; one per slide for a carousel. */
const altTexts = (post: GeneratedPost): string[] => (post.type === 'reel' ? [post.altText] : post.slides.map((s) => truncateAlt(describeSlide(s))));

// ------------------------------------------------------------------ main
interface Args {
  template?: string;
  target?: string;
  auto: boolean;
  dryRun: boolean;
  draft: boolean;
  /** undefined = not given; null = given but not a known channel. */
  channel: Channel | null | undefined;
  out: string;
}

function parseCli(argv: string[]): Args {
  const { values } = parseArgs({
    args: argv,
    options: {
      template: { type: 'string' },
      target: { type: 'string' },
      auto: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      draft: { type: 'boolean', default: false },
      channel: { type: 'string' },
      out: { type: 'string', default: 'out/social' },
    },
  });
  const channel = values.channel === undefined ? undefined : isChannel(values.channel) ? values.channel : null;
  return {
    template: values.template || undefined,
    target: values.target || undefined,
    auto: values.auto ?? false,
    dryRun: values['dry-run'] ?? false,
    draft: values.draft ?? false,
    channel,
    out: values.out ?? 'out/social',
  };
}

async function main(): Promise<number> {
  const args = parseCli(process.argv.slice(2));
  const explicit = args.template !== undefined;
  if (args.auto === explicit || args.channel === null) {
    console.error('Usage: social:generate --template <key> --target <slug> | --auto   [--channel instagram|facebook] [--draft] [--dry-run] [--out <dir>]');
    return 2;
  }
  let job: Job | null = null;
  if (explicit) {
    const t = templateByKey(args.template!);
    job = { template: args.template!, target: args.target ?? (t?.target === 'none' ? 'none' : '') };
    if (!t || !isValidJob(job)) {
      console.error(`Unknown template/target: ${job.template} ${job.target || '(no target)'}`);
      return 2;
    }
  }

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const readKey = args.dryRun ? process.env.SUPABASE_PUBLISHABLE_KEY || secret : secret;
  if (!url || !readKey) {
    const missing = [!url && 'SUPABASE_URL', !readKey && (args.dryRun ? 'SUPABASE_PUBLISHABLE_KEY (or SUPABASE_SECRET_KEY)' : 'SUPABASE_SECRET_KEY')].filter(Boolean).join(', ');
    console.log(`Social render skipped: ${missing} not set.`);
    return 0;
  }

  const ffmpeg = await hasFfmpeg();
  if (!ffmpeg && !args.dryRun) {
    console.error('ffmpeg/ffprobe not found on PATH. Install ffmpeg (apt-get install ffmpeg) and retry.');
    return 1;
  }
  if (!ffmpeg) console.warn('ffmpeg not found: dry run will write PNG frames only (no MP4/JPEG).');

  const repo = createRepo({ env: { url, key: readKey } });
  // The social tables are server-only; a dry run reads them only when the secret key happens to be set.
  const db = secret ? new SocialDb({ url, key: secret }) : null;
  const now = new Date();
  const settings = db ? await loadSettings(db) : DEFAULT_SETTINGS;
  const runSettings = settings;
  const channels: Channel[] = args.channel ? [args.channel] : explicit ? [settings.default_channels[0] ?? DEFAULT_CHANNELS[0]!] : settings.default_channels;
  let taken: (string | null)[] = db ? (await db.select<{ scheduled_at: string | null }>('social_posts', { select: 'scheduled_at', status: 'in.(scheduled,publishing)', scheduled_at: 'not.is.null' })).map((r) => r.scheduled_at) : [];

  let jobs: Job[];
  if (job) {
    jobs = [job];
  } else {
    let history: HistoryItem[] = [];
    if (db) {
      const since = new Date(now.getTime() - COOLDOWN_DAYS * 86_400_000).toISOString();
      const rows = await db.select<{ at: string; detail: { template?: string; target?: string } | null }>('social_events', { select: 'at,detail', event: 'eq.generated', at: `gte.${since}` });
      history = rows.flatMap((r) => (r.detail?.template && r.detail.target ? [{ template: r.detail.template, target: r.detail.target, at: r.at }] : []));
    } else {
      console.log('Dry run without SUPABASE_SECRET_KEY: planning with default slots and no history.');
    }
    const freeSlots = {
      reel: countFreeSlots(settings.slots, 'reel', settings.timezone, taken, now),
      carousel: countFreeSlots(settings.slots, 'carousel', settings.timezone, taken, now),
    };
    jobs = planAuto({ freeSlots, history, now });
    console.log(`Open slots in the next 7 days: ${freeSlots.reel} reel, ${freeSlots.carousel} carousel. Generating ${jobs.length}${jobs.length ? `: ${jobs.map((j) => `${j.template}/${j.target}`).join(', ')}` : ''} for ${channels.join(' + ')}.`);
  }

  let failures = 0;
  // One post per job and channel. Every channel's post for a job is decided against the slots taken before that job,
  // so they share its slot (same time on each channel) instead of using up the next job's.
  const tasks = jobs.flatMap((job) => channels.map((channel) => ({ job, channel })));
  let jobTaken = taken;
  let lastJob: Job | null = null;
  for (const { job: j, channel } of tasks) {
    if (j !== lastJob) [jobTaken, lastJob] = [taken, j];
    const label = `${j.template}/${j.target} (${channel})`;
    try {
      const post = await buildPost(j, repo, channel);
      // This post's view of the settings: it goes to its own channel only (checks, queue row and summary read this).
      const settings = { ...runSettings, default_channels: [post.channel] };
      const dir = args.dryRun ? resolve(args.out, `${j.template}__${j.target}__${post.channel}`) : await mkdtemp(join(tmpdir(), 'social-'));
      await mkdir(dir, { recursive: true });
      try {
        const files = ffmpeg ? await renderPost(post, dir) : (await renderSlidesOnly(post.type, post.slides, dir), []);
        const checks = runChecks({ type: post.type, caption: post.caption, data_refs: post.dataRefs, numbers_confirmed: false, media: mediaForCheck(files), channels: settings.default_channels });
        const passed = checksPassed(checks);
        const decision = decideQueueState({ checksPassed: passed, type: post.type, settings, taken: jobTaken, now, draft: args.draft });
        const summary = {
          template: post.templateKey,
          target: post.target,
          type: post.type,
          channel: post.channel,
          channels: settings.default_channels,
          music: post.music,
          title: post.title,
          caption: post.caption,
          voice: post.slides.flatMap((s) => (s.voice ? [s.voice] : [])),
          slides: post.slides.map((s) => ({ id: s.id, photo: s.photo ?? null, seconds: s.seconds ?? null, voice: s.voice ?? null, kicker: s.kicker ?? null, title: s.title, subtitle: s.subtitle ?? null })),
          data_refs: post.dataRefs,
          alt_texts: altTexts(post),
          checks,
          checks_passed: passed,
          would_queue_as: { status: decision.status, scheduled_at: decision.scheduledAt?.toISOString() ?? null },
          files: files.map((f) => ({ file: f.path, ...f.info })),
        };
        if (args.dryRun) {
          await writeFile(join(dir, 'post.json'), JSON.stringify(summary, null, 2));
          console.log(`[dry-run] ${label}: ${files.length} file(s), checks ${passed ? 'passed' : 'FAILED'}, would queue as ${decision.status}. Output: ${dir}`);
          for (const c of checks.filter((c) => !c.ok)) console.log(`  check failed (${c.level}): ${c.key}: ${c.message}`);
          continue;
        }
        if (!db) throw new Error('internal: no database client');
        const id = await queuePost(db, post, files, checks, passed, decision, settings.paused, settings.default_channels);
        if (decision.scheduledAt) taken = [...taken, decision.scheduledAt.toISOString()];
        console.log(`Queued ${label} as ${decision.status}${decision.scheduledAt ? ` for ${decision.scheduledAt.toISOString()}` : ''} (post ${id}).`);
      } finally {
        if (!args.dryRun) await rm(dir, { recursive: true, force: true });
      }
    } catch (e) {
      failures++;
      console.error(`FAILED ${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return failures ? 1 : 0;
}

// ------------------------------------------------------------------ upload + insert
async function queuePost(
  db: SocialDb,
  post: GeneratedPost,
  files: RenderedFile[],
  checks: ReturnType<typeof runChecks>,
  passed: boolean,
  decision: ReturnType<typeof decideQueueState>,
  paused: boolean,
  channels: Channel[],
): Promise<string> {
  const now = new Date();
  const folder = `generated/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const alts = altTexts(post);
  // Location tag from the target's row in social_locations; a failed read only means the post goes out untagged.
  let location_key: string | null = null;
  try {
    location_key = locationKeyForTarget(await db.select<Pick<SocialLocation, 'key' | 'targets' | 'fb_place_id'>>('social_locations', { select: 'key,targets,fb_place_id' }), post.target);
  } catch (e) {
    console.warn(`Location lookup failed; queuing without a location tag (${e instanceof Error ? e.message.slice(0, 120) : 'error'}).`);
  }
  const uploaded: string[] = [];
  const mediaIds: string[] = [];
  let postId: string | null = null;
  try {
    for (const [i, f] of files.entries()) {
      const mediaId = randomUUID();
      const path = `${folder}/${mediaId}.${f.ext}`;
      const publicUrl = await db.upload(path, await readFile(f.path), f.mime);
      uploaded.push(path);
      await db.insert('social_media', {
        id: mediaId,
        kind: f.mime === 'video/mp4' ? 'video' : 'image',
        storage_path: path,
        public_url: publicUrl,
        mime: f.mime,
        bytes: f.info.bytes,
        width: f.info.width,
        height: f.info.height,
        duration_s: f.info.durationS,
        alt_text: alts[i] ?? null,
        source: 'generated',
      });
      mediaIds.push(mediaId);
    }
    // Insert as a draft, attach media, then move to the final status so the publisher never sees a half-built post.
    const [row] = await db.insert<{ id: string }>('social_posts', {
      type: post.type,
      channels,
      status: 'draft',
      title: post.title,
      caption: post.caption,
      origin: 'generated',
      template_key: post.templateKey,
      data_refs: post.dataRefs,
      numbers_confirmed: false,
      checks,
      checks_passed: passed,
      location_key,
    });
    postId = row!.id;
    await db.insert('social_post_media', mediaIds.map((media_id, position) => ({ post_id: postId, media_id, position })));
    if (decision.status !== 'draft') {
      await db.update('social_posts', { id: `eq.${postId}` }, { status: decision.status, scheduled_at: decision.scheduledAt?.toISOString() ?? null });
    }
    await db.insert('social_events', {
      post_id: postId,
      event: 'generated',
      detail: { template: post.templateKey, target: post.target, channel: post.channel, status: decision.status, channels, paused, location_key, run: process.env.GITHUB_RUN_ID ?? null },
    });
    return postId;
  } catch (e) {
    // Best-effort cleanup so a failed run leaves no half-built post or orphaned files.
    if (postId) await db.remove('social_posts', { id: `eq.${postId}` }).catch(() => {});
    if (mediaIds.length) await db.remove('social_media', { id: `in.(${mediaIds.join(',')})` }).catch(() => {});
    await db.removeObjects(uploaded).catch(() => {});
    throw e;
  }
}

process.exitCode = await main();
