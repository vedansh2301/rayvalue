/**
 * Rendering. Each slide is two layers (see layout.ts): a background (photo crop + scrim, sharp) and a transparent text
 * layer (satori + resvg). Carousels flatten them into JPEGs; Reels move them separately in ffmpeg (a slow zoom on the
 * photo, the copy fading up over it) and cross-fade between slides, with the voice-over / music track from audio.ts.
 * ffmpeg and ffprobe must be on PATH (GitHub's ubuntu runners ship both).
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import sharp, { type Sharp } from 'sharp';
import { photoByKey } from '../../src/lib/social/gen/photos';
import { REEL_DEFAULT_SECONDS } from '../../src/lib/social/gen/templates';
import { REEL_MAX_SECONDS, reelTimeline, XFADE_SECONDS } from '../../src/lib/social/gen/timeline';
import type { GeneratedPost, Slide } from '../../src/lib/social/gen/types';
import { hasTts, mixReelAudio, synthesizeVoice, type VoiceClip } from './audio';
import { plainBackgroundSvg, scrimSvg, SIZES, textElement, type Format } from './layout';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Hard cap on a rendered Reel (with its voice-over): generation fails above it. Facebook Reels allow 90 s. */
export const REEL_RENDER_MAX_SECONDS = 60;
/** Reel backgrounds are rendered at this multiple of the frame so the slow zoom never upscales. */
export const REEL_BG_SCALE = 2;
/** How far the background zooms over one slide (1.00 -> 1.08). */
const ZOOM = 0.08;
/**
 * The copy is never on screen during a cross-fade (two layers of text over each other read as a smudge): it fades out
 * just before a transition and fades in, rising this many px, once the new photo is fully up.
 */
const TEXT_IN = { at: XFADE_SECONDS, fade: 0.45, rise: 36, riseSeconds: 0.65 } as const;
const TEXT_OUT_SECONDS = 0.3;
/** Voice-over starts this long after its slide begins to appear (with its copy) and leaves this much air before the next transition. */
export const VOICE_LEAD = 0.5;
export const VOICE_TAIL = 0.45;
const FPS = 30;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

let fontsPromise: Promise<{ name: string; data: Buffer; weight: 400 | 700 | 800; style: 'normal' }[]> | null = null;
const fonts = () =>
  (fontsPromise ??= Promise.all(
    ([400, 700, 800] as const).map(async (weight) => ({
      name: 'Inter',
      data: await readFile(require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`)),
      weight,
      style: 'normal' as const,
    })),
  ));

// ------------------------------------------------------------------ layers
/** The transparent text layer as PNG bytes. `page` adds the "n / N" counter (carousel). */
export async function renderTextPng(slide: Slide, format: Format, page: { n: number; total: number } | null): Promise<Buffer> {
  const { width, height } = SIZES[format];
  const svg = await satori(textElement(slide, format, page) as never, { width, height, fonts: await fonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'original' }, background: 'rgba(0,0,0,0)' }).render().asPng());
}

/** The background layer at `scale` x the frame size: the photo cropped to fill, under its scrim (or a plain fill). */
export async function renderBackground(slide: Slide, format: Format, scale = 1): Promise<Sharp> {
  const width = SIZES[format].width * scale;
  const height = SIZES[format].height * scale;
  if (!slide.photo) return sharp(Buffer.from(plainBackgroundSvg(slide.theme, width, height)));
  const file = join(REPO_ROOT, photoByKey(slide.photo).file);
  return sharp(file)
    .rotate()
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .modulate({ saturation: 0.94 })
    .composite([{ input: Buffer.from(scrimSvg(slide, width, height)) }]);
}

/** Background + text flattened at frame size. */
async function flatten(slide: Slide, format: Format, page: { n: number; total: number } | null): Promise<Sharp> {
  const [bg, text] = await Promise.all([renderBackground(slide, format, 1).then((b) => b.png().toBuffer()), renderTextPng(slide, format, page)]);
  return sharp(bg).composite([{ input: text }]);
}

/** One finished slide as PNG bytes. */
export async function renderSlidePng(slide: Slide, format: Format, page: { n: number; total: number } | null): Promise<Buffer> {
  return (await flatten(slide, format, page)).png().toBuffer();
}

/** Baseline 4:2:0 JPEG (what Instagram accepts). Not mozjpeg: ffmpeg's decoder fails on some of its files. */
const toJpeg = (img: Sharp, quality: number) => img.flatten({ background: '#000' }).jpeg({ quality, chromaSubsampling: '4:2:0', progressive: false });

// ------------------------------------------------------------------ ffmpeg helpers
export async function hasFfmpeg(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

export interface MediaInfo {
  width: number;
  height: number;
  bytes: number;
  /** Seconds, 2 decimals; videos only. */
  durationS: number | null;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<MediaInfo> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
  const j = JSON.parse(stdout) as { streams: { codec_type: string; width?: number; height?: number; duration?: string }[]; format: { duration?: string } };
  const v = j.streams.find((s) => s.codec_type === 'video');
  if (!v?.width || !v.height) throw new Error(`${file}: no video/image stream`);
  const dur = Number(j.format.duration);
  const isVideo = file.endsWith('.mp4');
  return {
    width: v.width,
    height: v.height,
    bytes: (await stat(file)).size,
    durationS: isVideo && Number.isFinite(dur) ? Math.round(dur * 100) / 100 : null,
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
  };
}

// ------------------------------------------------------------------ Reel timing (pure)
export interface ReelTiming {
  /** Hold time per slide (including its half of each transition), stretched to fit its voice clip. */
  seconds: number[];
  /** When each slide's voice clip starts (null = no clip). */
  voiceAt: (number | null)[];
  total: number;
}

const up1 = (n: number) => Math.ceil(n * 10 - 1e-9) / 10;

/**
 * Slide timing for a Reel: each slide holds for its planned seconds, or longer when its voice clip needs it (lead +
 * clip + tail, and clear of the next cross-fade). The clip starts VOICE_LEAD after the slide begins to appear.
 */
export function fitReelTiming(planned: readonly number[], clipSeconds: readonly (number | null)[], xfade = XFADE_SECONDS): ReelTiming {
  const last = planned.length - 1;
  const seconds = planned.map((p, i) => {
    const clip = clipSeconds[i];
    return clip == null ? p : Math.max(p, up1(VOICE_LEAD + clip + VOICE_TAIL + (i < last ? xfade : 0)));
  });
  const { offsets, total } = reelTimeline(seconds, xfade);
  const voiceAt = clipSeconds.map((c, i) => (c == null ? null : r3((i === 0 ? 0 : offsets[i - 1]!) + VOICE_LEAD)));
  return { seconds, voiceAt, total };
}

/** Zoom drift per slide, cycling so neighbouring slides move differently: [x, y] position of the crop window (0..1, or 'p' = moving with progress). */
const DRIFT: [string, string][] = [
  ['0.5', '0.5'], // straight in
  ['p', '0.45'], // left to right
  ['0.5', '1-p'], // upward
  ['1-p', '0.55'], // right to left
  ['0.5', 'p'], // downward
];

/**
 * Background JPEGs (REEL_BG_SCALE x) + text PNGs -> one MP4: H.264 yuv420p, 30 fps, faststart. Each background zooms
 * slowly, each slide's copy fades up over it (the first is visible from frame one, as the cover), slides cross-fade, and
 * the audio is `audio` (padded to length) or a silent AAC track (Instagram prefers a file with one).
 */
export async function assembleReel(layers: { bg: string; text: string }[], seconds: number[], audio: string | null, out: string): Promise<void> {
  const { width, height } = SIZES.reel;
  const { offsets, total } = reelTimeline(seconds);
  const args = ['-y', '-loglevel', 'error'];
  layers.forEach((l, i) => args.push('-i', l.bg, '-loop', '1', '-framerate', String(FPS), '-t', String(seconds[i]), '-i', l.text));
  const a = layers.length * 2;
  if (audio) args.push('-i', audio);
  else args.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

  const chain: string[] = [];
  layers.forEach((_, i) => {
    const frames = Math.round(seconds[i]! * FPS);
    const p = `on/${Math.max(1, frames - 1)}`;
    const [fx, fy] = DRIFT[i % DRIFT.length]!.map((e) => e.replace(/p/g, `(${p})`));
    chain.push(
      `[${2 * i}:v]zoompan=z='1+${ZOOM}*${p}':x='(iw-iw/zoom)*(${fx})':y='(ih-ih/zoom)*(${fy})':d=${frames}:s=${width}x${height}:fps=${FPS},scale=out_range=tv,format=yuv420p,setsar=1[b${i}]`,
    );
    // First slide: copy visible from frame one (it is the cover). Last slide: copy stays to the end.
    const fades = [
      ...(i > 0 ? [`fade=t=in:st=${TEXT_IN.at}:d=${TEXT_IN.fade}:alpha=1`] : []),
      ...(i < layers.length - 1 ? [`fade=t=out:st=${r3(seconds[i]! - XFADE_SECONDS - TEXT_OUT_SECONDS)}:d=${TEXT_OUT_SECONDS}:alpha=1`] : []),
    ];
    const rise = `min(1,max(0,1-(t-${TEXT_IN.at})/${TEXT_IN.riseSeconds}))`;
    chain.push(
      `[${2 * i + 1}:v]${['format=rgba', ...fades].join(',')}[t${i}]`,
      i === 0
        ? `[b${i}][t${i}]overlay=0:0:shortest=1,format=yuv420p,setsar=1[v${i}]`
        : `[b${i}][t${i}]overlay=x=0:y='${TEXT_IN.rise}*pow(${rise},3)':eval=frame:shortest=1,format=yuv420p,setsar=1[v${i}]`,
    );
  });
  let last = 'v0';
  offsets.forEach((off, k) => {
    const next = `x${k + 1}`;
    chain.push(`[${last}][v${k + 1}]xfade=transition=fade:duration=${XFADE_SECONDS}:offset=${off}[${next}]`);
    last = next;
  });
  chain.push(audio ? `[${a}:a]apad[aud]` : `[${a}:a]anull[aud]`);
  args.push(
    '-filter_complex', chain.join(';'),
    '-map', `[${last}]`, '-map', '[aud]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', audio ? '128k' : '96k', '-ar', '44100',
    '-movflags', '+faststart',
    '-t', String(total),
    out,
  );
  await run('ffmpeg', args, { maxBuffer: 16 * 1024 * 1024 });
}

// ------------------------------------------------------------------ posts
export interface RenderedFile {
  path: string;
  mime: 'video/mp4' | 'image/jpeg';
  ext: 'mp4' | 'jpg';
  info: MediaInfo;
}

const num = (i: number) => String(i + 1).padStart(2, '0');

/** Finished slides as PNG frames only (no ffmpeg needed); returns the written paths. */
export async function renderSlidesOnly(type: 'reel' | 'carousel', slides: Slide[], dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const out: string[] = [];
  for (const [i, s] of slides.entries()) {
    const png = join(dir, `slide-${num(i)}-${s.id}.png`);
    await writeFile(png, await renderSlidePng(s, type, type === 'carousel' ? { n: i + 1, total: slides.length } : null));
    out.push(png);
  }
  return out;
}

async function renderCarousel(slides: Slide[], dir: string): Promise<RenderedFile[]> {
  const files: RenderedFile[] = [];
  for (const [i, s] of slides.entries()) {
    const jpg = join(dir, `slide-${num(i)}.jpg`);
    await toJpeg(await flatten(s, 'carousel', { n: i + 1, total: slides.length }), 90).toFile(jpg);
    files.push({ path: jpg, mime: 'image/jpeg', ext: 'jpg', info: await probe(jpg) });
  }
  return files;
}

/** Voice clips for a Reel's slides (null where a slide has no line, or this machine has no text-to-speech). */
async function voiceClips(slides: Slide[], dir: string): Promise<(VoiceClip | null)[]> {
  if (!slides.some((s) => s.voice)) return slides.map(() => null);
  if (!(await hasTts())) {
    console.warn('Voice-over skipped: text-to-speech is not available here (the Reel keeps its planned timing).');
    return slides.map(() => null);
  }
  await mkdir(dir, { recursive: true });
  const clips = await synthesizeVoice(slides.map((s) => s.voice), dir);
  if (clips.length !== slides.length) throw new Error(`voice-over: ${clips.length} clips for ${slides.length} slides`);
  return clips;
}

async function renderReel(post: GeneratedPost, dir: string): Promise<RenderedFile[]> {
  const { slides } = post;
  const work = join(dir, 'layers');
  await mkdir(work, { recursive: true });
  try {
    const clips = await voiceClips(slides, join(work, 'voice'));
    const timing = fitReelTiming(
      slides.map((s) => s.seconds ?? REEL_DEFAULT_SECONDS),
      clips.map((c) => c?.seconds ?? null),
    );
    if (timing.total > REEL_RENDER_MAX_SECONDS) {
      throw new Error(`Reel would run ${timing.total.toFixed(1)} s with its voice-over; the cap is ${REEL_RENDER_MAX_SECONDS} s. Shorten the voice lines.`);
    }
    if (timing.total > REEL_MAX_SECONDS) console.warn(`Reel runs ${timing.total.toFixed(1)} s, over the planned ${REEL_MAX_SECONDS} s.`);

    const layers = await Promise.all(
      slides.map(async (s, i) => {
        const bg = join(work, `bg-${num(i)}.jpg`);
        const text = join(work, `text-${num(i)}.png`);
        const [bgImg, textPng] = await Promise.all([renderBackground(s, 'reel', REEL_BG_SCALE), renderTextPng(s, 'reel', null)]);
        await Promise.all([toJpeg(bgImg, 88).toFile(bg), writeFile(text, textPng)]);
        // A still of the finished slide, for previews and the dry-run folder.
        await toJpeg(sharp(await sharp(bg).resize(SIZES.reel.width, SIZES.reel.height).toBuffer()).composite([{ input: textPng }]), 82).toFile(join(dir, `slide-${num(i)}-${s.id}.jpg`));
        return { bg, text };
      }),
    );

    const voice = clips.flatMap((clip, i) => (clip ? [{ clip, at: timing.voiceAt[i]! }] : []));
    const audio = voice.length || post.music ? await mixReelAudio({ total: timing.total, voice, music: post.music, out: join(work, 'audio.m4a') }) : null;

    const out = join(dir, 'reel.mp4');
    await assembleReel(layers, timing.seconds, audio, out);
    return [{ path: out, mime: 'video/mp4', ext: 'mp4', info: await probe(out) }];
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Renders a post into `dir` (the MP4 or JPEGs, plus a still per Reel slide) and returns the deliverable files in order. */
export async function renderPost(post: GeneratedPost, dir: string): Promise<RenderedFile[]> {
  await mkdir(dir, { recursive: true });
  return post.type === 'reel' ? renderReel(post, dir) : renderCarousel(post.slides, dir);
}
