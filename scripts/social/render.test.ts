import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import type { Slide } from '../../src/lib/social/gen/types';
import { reelTimeline } from '../../src/lib/social/gen/timeline';
import { renderPost, renderSlidePng } from './render';

const haveFfmpeg = ['ffmpeg', 'ffprobe'].every((b) => spawnSync(b, ['-version']).status === 0);

const slides: Slide[] = [
  { id: 'hook', theme: 'sun', kicker: 'Test', title: 'Is solar worth it?', subtitle: 'Fixture slide', seconds: 2 },
  { id: 'fig', theme: 'light', kicker: 'Cost', title: 'A typical home', big: '$10,000–$20,000', tiles: [{ label: 'Low', value: '$10,000' }, { label: 'Likely', value: '$15,000', emphasis: true }, { label: 'High', value: '$20,000' }], footer: ['Estimates, not quotes · rayvalue.com'], seconds: 2 },
  { id: 'cta', theme: 'dark', title: 'Run your own numbers at', url: 'rayvalue.com/calculator/florida', seconds: 2 },
];

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
});

describe.skipIf(!haveFfmpeg)('ffmpeg output', () => {
  it('assembles a 1080x1920 H.264 MP4 with an audio track under the length and size limits', async () => {
    const [file] = await renderPost('reel', slides, join(dir, 'reel'));
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
    const files = await renderPost('carousel', slides, join(dir, 'car'));
    expect(files).toHaveLength(3);
    for (const f of files) {
      expect(f.mime).toBe('image/jpeg');
      expect([f.info.width, f.info.height]).toEqual([1080, 1350]);
      expect(f.path.endsWith('.jpg')).toBe(true);
    }
  }, 60_000);
});
