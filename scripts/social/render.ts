/** Rendering: Slide -> PNG (satori + resvg) -> JPEG / H.264 MP4 (ffmpeg). ffmpeg and ffprobe must be on PATH (GitHub's ubuntu runners ship both). */
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { reelTimeline, XFADE_SECONDS } from '../../src/lib/social/gen/timeline';
import type { Slide } from '../../src/lib/social/gen/types';
import { REEL_DEFAULT_SECONDS } from '../../src/lib/social/gen/templates';
import { SIZES, slideElement, type Format } from './layout';

const run = promisify(execFile);
const require = createRequire(import.meta.url);

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

/** One slide as PNG bytes. `page` adds the "n / N" counter (carousel). */
export async function renderSlidePng(slide: Slide, format: Format, page: { n: number; total: number } | null): Promise<Buffer> {
  const { width, height } = SIZES[format];
  const svg = await satori(slideElement(slide, format, page) as never, { width, height, fonts: await fonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng());
}

export async function hasFfmpeg(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/** PNG file -> baseline-compatible JPEG (Instagram only accepts JPEG). */
export async function pngToJpeg(png: string, jpg: string): Promise<void> {
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-frames:v', '1', '-q:v', '2', '-pix_fmt', 'yuvj420p', '-update', '1', jpg]);
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

/**
 * Slide PNGs -> one MP4: H.264 yuv420p, 30 fps, faststart, crossfades between slides and a silent AAC track
 * (Instagram prefers a file with an audio stream).
 */
export async function assembleReel(pngs: string[], slides: Slide[], out: string): Promise<void> {
  const seconds = slides.map((s) => s.seconds ?? REEL_DEFAULT_SECONDS);
  const { offsets, total } = reelTimeline(seconds);
  const args = ['-y', '-loglevel', 'error'];
  pngs.forEach((png, i) => args.push('-loop', '1', '-framerate', '30', '-t', String(seconds[i]), '-i', png));
  args.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

  const chain: string[] = pngs.map((_, i) => `[${i}:v]fps=30,format=yuv420p,setsar=1[v${i}]`);
  let last = 'v0';
  offsets.forEach((off, k) => {
    const next = `x${k + 1}`;
    chain.push(`[${last}][v${k + 1}]xfade=transition=fade:duration=${XFADE_SECONDS}:offset=${off}[${next}]`);
    last = next;
  });
  args.push(
    '-filter_complex', chain.join(';'),
    '-map', `[${last}]`, '-map', `${pngs.length}:a`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    '-t', String(total),
    out,
  );
  await run('ffmpeg', args, { maxBuffer: 16 * 1024 * 1024 });
}

export interface RenderedFile {
  path: string;
  mime: 'video/mp4' | 'image/jpeg';
  ext: 'mp4' | 'jpg';
  info: MediaInfo;
}

/** PNG frames only (no ffmpeg needed); returns the written paths. */
export async function renderSlidesOnly(type: 'reel' | 'carousel', slides: Slide[], dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const out: string[] = [];
  for (const [i, s] of slides.entries()) {
    const png = join(dir, `slide-${String(i + 1).padStart(2, '0')}-${s.id}.png`);
    await writeFile(png, await renderSlidePng(s, type, type === 'carousel' ? { n: i + 1, total: slides.length } : null));
    out.push(png);
  }
  return out;
}

/** Renders every slide of a post into `dir` (PNG frames plus the final MP4 or JPEGs) and returns the deliverable files in order. */
export async function renderPost(type: 'reel' | 'carousel', slides: Slide[], dir: string): Promise<RenderedFile[]> {
  await mkdir(dir, { recursive: true });
  const pad = (n: number) => String(n + 1).padStart(2, '0');
  const pngs = await renderSlidesOnly(type, slides, dir);
  if (type === 'reel') {
    const out = join(dir, 'reel.mp4');
    await assembleReel(pngs, slides, out);
    return [{ path: out, mime: 'video/mp4', ext: 'mp4', info: await probe(out) }];
  }
  const files: RenderedFile[] = [];
  for (const [i, png] of pngs.entries()) {
    const jpg = join(dir, `slide-${pad(i)}.jpg`);
    await pngToJpeg(png, jpg);
    files.push({ path: jpg, mime: 'image/jpeg', ext: 'jpg', info: await probe(jpg) });
  }
  return files;
}
