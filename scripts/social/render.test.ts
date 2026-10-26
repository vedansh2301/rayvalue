import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import type { GeneratedPost, Slide } from '../../src/lib/social/gen/types';
import { reelTimeline } from '../../src/lib/social/gen/timeline';
import { creditLine } from './layout';
import { fitReelTiming, renderPost, renderSlidePng, VOICE_LEAD, VOICE_TAIL } from './render';

const haveFfmpeg = ['ffmpeg', 'ffprobe'].every((b) => spawnSync(b, ['-version']).status === 0);

const slides: Slide[] = [
  { id: 'hook', theme: 'sun', kicker: 'Test', title: 'Is solar worth it?', subtitle: 'Fixture slide', seconds: 2 },
  { id: 'fig', theme: 'light', kicker: 'Cost', title: 'A typical home', big: '$10,000–$20,000', tiles: [{ label: 'Low', value: '$10,000' }, { label: 'Likely', value: '$15,000', emphasis: true }, { label: 'High', value: '$20,000' }], footer: ['Estimates, not quotes · rayvalue.com'], seconds: 2 },
  { id: 'cta', theme: 'dark', title: 'Run your own numbers', url: 'rayvalue.com/calculator/florida', seconds: 2, photo: 'power-lines-sunset' },
];

const post = (type: 'reel' | 'carousel'): GeneratedPost => ({
  templateKey: 'test',
  target: 'fl',
  type,
  channel: 'instagram',
  music: null,
  title: 'Test',
  caption: 'Test',
  dataRefs: [],
  slides,
  altText: 'Test',
});

const dir = mkdtempSync(join(tmpdir(), 'social-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('slide rendering (no ffmpeg needed)', () => {
  it('renders a PNG of the right size for each format', async () => {
    const reel = await renderSlidePng(slides[1]!, 'reel', null);
    const car = await renderSlidePng(slides[1]!, 'carousel', { n: 2, total: 3 });
    // PNG IHDR: width at bytes 16-19, height at 20-23
    expect([reel.readUInt32BE(16), reel.readUInt32BE(20)]).toEqual([1080, 1920]);
    expect([car.readUInt32BE(16), car.readUInt32BE(20)]).toEqual([1080, 1350]);
  });

  it('renders a photo slide and credits the photo only when its license requires it', async () => {
    const png = await renderSlidePng(slides[2]!, 'reel', null);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1920]);
    expect(creditLine(slides[2]!)).toBe('Photo: Eric Sonstroem · CC BY 2.0');
    expect(creditLine({ ...slides[2]!, photo: 'fl-broward-roof' })).toBeNull();
    expect(creditLine(slides[0]!)).toBeNull();
  });
});

describe('Reel timing', () => {
  it('keeps planned seconds without voice and stretches a slide to fit its clip', () => {
    expect(fitReelTiming([4, 4, 4], [null, null, null])).toEqual({ seconds: [4, 4, 4], voiceAt: [null, null, null], total: reelTimeline([4, 4, 4]).total });
    const t = fitReelTiming([4, 4, 4], [2, 5, 6]);
    expect(t.seconds[0]).toBe(4); // a short clip leaves the plan alone
    expect(t.seconds[1]).toBeGreaterThanOrEqual(VOICE_LEAD + 5 + VOICE_TAIL + 0.5);
    expect(t.seconds[2]).toBeGreaterThanOrEqual(VOICE_LEAD + 6 + VOICE_TAIL);
    expect(t.total).toBeCloseTo(reelTimeline(t.seconds).total, 5);
    // Clip k starts VOICE_LEAD after slide k begins to appear (its cross-fade in), and ends before the next one.
    const { offsets } = reelTimeline(t.seconds);
    expect(t.voiceAt[0]).toBe(VOICE_LEAD);
    expect(t.voiceAt[1]).toBeCloseTo(offsets[0]! + VOICE_LEAD, 5);
    expect(t.voiceAt[1]! + 5).toBeLessThanOrEqual(offsets[1]!);
  });
});

describe.skipIf(!haveFfmpeg)('ffmpeg output', () => {
  it('assembles a 1080x1920 H.264 MP4 with an audio track under the length and size limits', async () => {
    const [file] = await renderPost(post('reel'), join(dir, 'reel'));
    expect(file!.mime).toBe('video/mp4');
    expect(file!.info.width).toBe(1080);
    expect(file!.info.height).toBe(1920);
    expect(file!.info.hasAudio).toBe(true);
    expect(file!.info.durationS).toBeCloseTo(reelTimeline([2, 2, 2]).total, 0);
    expect(file!.info.bytes).toBeLessThan(50 * 1024 * 1024);
    const s = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,r_frame_rate', '-of', 'csv=p=0', file!.path]).stdout.toString().trim();
    expect(s).toBe('h264,yuv420p,30/1');
  }, 60_000);

  it('writes carousel slides as 1080x1350 JPEG', async () => {
    const files = await renderPost(post('carousel'), join(dir, 'car'));
    expect(files).toHaveLength(3);
    for (const f of files) {
      expect(f.mime).toBe('image/jpeg');
      expect([f.info.width, f.info.height]).toEqual([1080, 1350]);
      expect(f.path.endsWith('.jpg')).toBe(true);
    }
  }, 60_000);
});
