/**
 * Reel audio: voice-over (text-to-speech) and background music, mixed into one track. render.ts relies only on the
 * exported signatures.
 *
 * Voice: Kokoro v1.0 (Apache-2.0) through kokoro-onnx, run offline by scripts/social/tts.py in its own Python venv.
 * Everything lives in TTS_DIR (default ~/.cache/rayvalue-tts; set up by scripts/social/tts-setup.sh):
 *   venv/bin/python   with kokoro-onnx + soundfile
 *   kokoro-v1.0.onnx  voices-v1.0.bin
 * Missing anything = no TTS (hasTts() false): the Reel still renders, with music only.
 *
 * Music: CC0 tracks by Komiku, from Wikimedia Commons (MUSIC below), stored as 90 s excerpts loudness-normalized to
 * about -16 LUFS. Under the voice the bed sits ~13 dB down and ducks further while words are spoken; the final mix
 * is normalized to -14 LUFS / -1.5 dBTP (where Instagram and Facebook play Reels).
 */
import { execFile } from 'node:child_process';
import { access, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { speakable } from '../../src/lib/social/gen/speech';
import type { MusicMood } from '../../src/lib/social/gen/types';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

export const TTS_DIR = process.env.SOCIAL_TTS_DIR || join(homedir(), '.cache', 'rayvalue-tts');
/** Kokoro voice (af_heart: the model's best-graded American English voice). */
export const TTS_VOICE = process.env.SOCIAL_TTS_VOICE || 'af_heart';
/** Slightly brisk, Reel pace. */
export const TTS_SPEED = 1.05;

/** Model files with their exact release sizes (github.com/thewh1teagle/kokoro-onnx, release model-files-v1.0). */
export const TTS_FILES = {
  model: { file: 'kokoro-v1.0.onnx', bytes: 325_532_387, sha256: '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5' },
  voices: { file: 'voices-v1.0.bin', bytes: 28_214_398, sha256: 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d' },
} as const;

const python = () => join(TTS_DIR, 'venv', 'bin', 'python');
const modelPath = (k: keyof typeof TTS_FILES) => join(TTS_DIR, TTS_FILES[k].file);

export interface MusicTrack {
  file: string;
  title: string;
  artist: string;
  license: string;
  sourceUrl: string;
}

/** Public-domain (CC0) beds, one per mood. `file` is relative to this folder. */
export const MUSIC: Record<MusicMood, MusicTrack> = {
  upbeat: {
    file: 'music/upbeat-komiku-travel-to-the-horizon.m4a',
    title: 'Travel to the Horizon',
    artist: 'Komiku',
    license: 'CC0 1.0 (public domain dedication)',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Komiku_-_43_-_Travel_to_the_Horizon.ogg',
  },
  calm: {
    file: 'music/calm-komiku-quiet-saturday.m4a',
    title: 'Quiet Saturday',
    artist: 'Komiku',
    license: 'CC0 1.0 (public domain dedication)',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Komiku_-_57_-_Quiet_Saturday.ogg',
  },
};
export const musicFile = (mood: MusicMood) => join(HERE, MUSIC[mood].file);

export interface VoiceClip {
  /** WAV file. */
  file: string;
  seconds: number;
}

let ttsReady: Promise<boolean> | null = null;

/** True when text-to-speech can run on this machine (venv with kokoro-onnx, and both model files at full size). */
export async function hasTts(): Promise<boolean> {
  return (ttsReady ??= (async () => {
    try {
      await access(python());
      for (const k of Object.keys(TTS_FILES) as (keyof typeof TTS_FILES)[]) {
        if ((await stat(modelPath(k))).size !== TTS_FILES[k].bytes) return false;
      }
      await run(python(), ['-I', '-c', 'import kokoro_onnx, soundfile'], { timeout: 60_000 });
      return true;
    } catch {
      return false;
    }
  })());
}

/** One clip per line (null where the line is missing/empty), written into `dir`. Throws if TTS is set up but fails. */
export async function synthesizeVoice(lines: (string | undefined)[], dir: string): Promise<(VoiceClip | null)[]> {
  const items = lines.flatMap((line, i) => {
    const text = line ? speakable(line) : '';
    return text ? [{ i, text, out: join(dir, `voice-${String(i + 1).padStart(2, '0')}.wav`) }] : [];
  });
  const result: (VoiceClip | null)[] = lines.map(() => null);
  if (items.length === 0 || !(await hasTts())) return result;

  const job = join(dir, 'tts-job.json');
  await writeFile(
    job,
    JSON.stringify({ model: modelPath('model'), voices: modelPath('voices'), voice: TTS_VOICE, speed: TTS_SPEED, items: items.map(({ text, out }) => ({ text, out })) }),
  );
  try {
    const { stdout } = await run(python(), ['-I', join(HERE, 'tts.py'), job], { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 });
    const clips = JSON.parse(stdout) as VoiceClip[];
    if (clips.length !== items.length) throw new Error(`tts.py returned ${clips.length} clips for ${items.length} lines`);
    items.forEach((it, k) => (result[it.i] = clips[k]!));
  } finally {
    await rm(job, { force: true });
  }
  return result;
}

export interface MixInput {
  /** Reel length in seconds. */
  total: number;
  /** Each clip and the second it starts at. */
  voice: { clip: VoiceClip; at: number }[];
  music: MusicMood | null;
  /** Output audio file (.m4a, AAC). */
  out: string;
}

/** Music level under the voice (dB) and on its own. */
const BED_DB = -13;
const MUSIC_ONLY_DB = -4;
const FADE_IN = 0.4;
const FADE_OUT = 1.5;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * ffmpeg arguments (after the inputs' `-i`s are known) for the mix; exported for tests. Inputs: voice clips first,
 * in order, then the music file (if any). Returns null when there is nothing to mix.
 */
export function mixArgs(input: MixInput, musicPath: string | null): string[] | null {
  const total = r3(input.total);
  const voice = input.voice.filter((v) => v.clip.seconds > 0 && v.at < total);
  if (!(total > 0) || (voice.length === 0 && !musicPath)) return null;

  const args = ['-y', '-loglevel', 'error'];
  voice.forEach((v) => args.push('-i', v.clip.file));
  if (musicPath) args.push('-stream_loop', '-1', '-i', musicPath);

  const f: string[] = [];
  const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  voice.forEach((v, i) => {
    const ms = Math.max(0, Math.round(v.at * 1000));
    f.push(`[${i}:a]${fmt},adelay=${ms}|${ms}[v${i}]`);
  });
  const fadeOut = `afade=t=out:st=${r3(Math.max(0, total - FADE_OUT))}:d=${FADE_OUT}`;
  if (voice.length) {
    const vin = voice.map((_, i) => `[v${i}]`).join('');
    f.push(`${vin}amix=inputs=${voice.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=0:${total}[vo]`);
  }
  if (musicPath) {
    const m = voice.length;
    const level = voice.length ? BED_DB : MUSIC_ONLY_DB;
    f.push(`[${m}:a]${fmt},atrim=0:${total},asetpts=N/SR/TB,volume=${level}dB,afade=t=in:d=${FADE_IN},${fadeOut}[bed]`);
  }
  let last: string;
  if (voice.length && musicPath) {
    f.push('[vo]asplit=2[vmix][vkey]');
    f.push('[bed][vkey]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350[ducked]');
    f.push('[ducked][vmix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[pre]');
    last = 'pre';
  } else {
    last = voice.length ? 'vo' : 'bed';
  }
  f.push(`[${last}]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,atrim=0:${total}[out]`);

  args.push('-filter_complex', f.join(';'), '-map', '[out]', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-t', String(total), '-movflags', '+faststart', input.out);
  return args;
}

/** Writes the final Reel audio track to `out`: voice on top, music ducked under it, loudness-normalized. Null = no audio (caller adds silence). */
export async function mixReelAudio(input: MixInput): Promise<string | null> {
  const args = mixArgs(input, input.music ? musicFile(input.music) : null);
  if (!args) return null;
  await run('ffmpeg', args, { maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60_000 });
  return input.out;
}
