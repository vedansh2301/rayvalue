import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hasTts, mixArgs, mixReelAudio, MUSIC, musicFile, synthesizeVoice, type VoiceClip } from './audio';

const haveFfmpeg = ['ffmpeg', 'ffprobe'].every((b) => spawnSync(b, ['-version']).status === 0);
const dir = mkdtempSync(join(tmpdir(), 'social-audio-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const clip = (file: string, seconds: number): VoiceClip => ({ file, seconds });
const graph = (args: string[]) => args[args.indexOf('-filter_complex') + 1]!;

describe('music library', () => {
  it.each(Object.entries(MUSIC))('%s: a committed CC0 track with its source', (mood, t) => {
    expect(existsSync(musicFile(mood as keyof typeof MUSIC))).toBe(true);
    expect(t.license).toMatch(/^CC0/);
    expect(t.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  });
});

describe('mixArgs (the ffmpeg graph)', () => {
  const v = [
    { clip: clip('/a.wav', 2), at: 0.4 },
    { clip: clip('/b.wav', 3), at: 3.25 },
  ];

  it('is null when there is nothing to play', () => {
    expect(mixArgs({ total: 10, voice: [], music: null, out: '/o.m4a' }, null)).toBeNull();
    expect(mixArgs({ total: 0, voice: v, music: 'calm', out: '/o.m4a' }, '/m.m4a')).toBeNull();
  });

  it('voice + music: places each clip, ducks the music under the voice, normalizes and cuts to the Reel length', () => {
    const args = mixArgs({ total: 12.5, voice: v, music: 'upbeat', out: '/o.m4a' }, '/m.m4a')!;
    expect(args.filter((a) => a === '-i')).toHaveLength(3);
    expect(args.slice(args.indexOf('-stream_loop'), args.indexOf('-stream_loop') + 4)).toEqual(['-stream_loop', '-1', '-i', '/m.m4a']);
    const g = graph(args);
    expect(g).toContain('adelay=400|400');
    expect(g).toContain('adelay=3250|3250');
    expect(g).toContain('sidechaincompress');
    expect(g).toContain('volume=-13dB');
    expect(g).toContain('loudnorm=I=-14');
    expect(g).toContain('afade=t=out:st=11:d=1.5');
    expect(args.slice(-5)).toEqual(['-t', '12.5', '-movflags', '+faststart', '/o.m4a']);
  });

  it('voice only: no music input, no ducking', () => {
    const g = graph(mixArgs({ total: 8, voice: v, music: null, out: '/o.m4a' }, null)!);
    expect(g).not.toContain('sidechaincompress');
    expect(g).toContain('[vo]loudnorm');
  });

  it('music only: the bed plays louder', () => {
    const g = graph(mixArgs({ total: 8, voice: [], music: 'calm', out: '/o.m4a' }, '/m.m4a')!);
    expect(g).toContain('[0:a]');
    expect(g).toContain('volume=-4dB');
    expect(g).toContain('[bed]loudnorm');
  });

  it('drops clips that start after the end or are empty', () => {
    const args = mixArgs({ total: 3, voice: [...v, { clip: clip('/c.wav', 0), at: 1 }], music: null, out: '/o.m4a' }, null)!;
    expect(args.filter((a) => a === '-i')).toHaveLength(1);
  });
});

describe('synthesizeVoice', () => {
  it('returns null for every missing or empty line without running the engine', async () => {
    expect(await synthesizeVoice([undefined, '', '   '.trim()], dir)).toEqual([null, null, null]);
  });
});

describe.skipIf(!haveFfmpeg)('mixReelAudio (ffmpeg)', () => {
  it('writes an AAC track of the Reel length, near -14 LUFS', async () => {
    const tone = join(dir, 'tone.wav');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1.5', '-ar', '24000', '-ac', '1', tone]);
    const out = join(dir, 'mix.m4a');
    expect(await mixReelAudio({ total: 5, voice: [{ clip: clip(tone, 1.5), at: 0.5 }, { clip: clip(tone, 1.5), at: 2.5 }], music: 'calm', out })).toBe(out);
    const info = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,channels', '-of', 'json', out], { encoding: 'utf8' });
    const j = JSON.parse(info.stdout) as { streams: { codec_name: string; channels: number }[]; format: { duration: string } };
    expect(j.streams[0]).toMatchObject({ codec_name: 'aac', channels: 2 });
    expect(Number(j.format.duration)).toBeCloseTo(5, 0);
    const ebu = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', out, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(ebu)?.[1]);
    expect(lufs).toBeGreaterThan(-17);
    expect(lufs).toBeLessThan(-11);
  });

  it('music only works too', async () => {
    const out = join(dir, 'music.m4a');
    expect(await mixReelAudio({ total: 3, voice: [], music: 'upbeat', out })).toBe(out);
  });

  it('null = no audio when there is neither voice nor music', async () => {
    expect(await mixReelAudio({ total: 3, voice: [], music: null, out: join(dir, 'none.m4a') })).toBeNull();
  });
});

// Opt-in (SOCIAL_TTS_TEST=1) and only where the Kokoro venv + model are installed (scripts/social/tts-setup.sh):
// the model takes every CPU core for a few seconds, which slows the rest of a parallel `npm test` into timeouts.
describe.skipIf(process.env.SOCIAL_TTS_TEST !== '1' || !(await hasTts()))('synthesizeVoice (Kokoro)', () => {
  it('speaks a line into a WAV clip', async () => {
    const [none, c] = await synthesizeVoice([undefined, 'PG&E: $30,900 to $53,500.'], dir);
    expect(none).toBeNull();
    expect(c!.seconds).toBeGreaterThan(2);
    expect(c!.seconds).toBeLessThan(10);
    expect(existsSync(c!.file)).toBe(true);
  }, 120_000);
});
