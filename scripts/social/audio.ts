/**
 * Reel audio: voice-over (text-to-speech) and background music, mixed into one track. CONTRACT STUB: the audio work
 * replaces these bodies; render.ts relies only on these signatures.
 */
import type { MusicMood } from '../../src/lib/social/gen/types';

export interface VoiceClip {
  /** WAV file. */
  file: string;
  seconds: number;
}

/** True when text-to-speech can run on this machine. */
export async function hasTts(): Promise<boolean> {
  return false;
}

/** One clip per line (null where the line is missing/empty), written into `dir`. */
export async function synthesizeVoice(lines: (string | undefined)[], _dir: string): Promise<(VoiceClip | null)[]> {
  return lines.map(() => null);
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

/** Writes the final Reel audio track to `out`: voice on top, music ducked under it, loudness-normalized. Null = no audio (caller adds silence). */
export async function mixReelAudio(_input: MixInput): Promise<string | null> {
  return null;
}
