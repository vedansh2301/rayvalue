/**
 * Shapes shared by the social post generator (pure content builders in this folder, rendering and I/O in scripts/social/).
 * A Slide is data only: the renderer decides how it looks; builders never draw and the renderer never invents text.
 */
import type { Channel, DataRef, PostType } from '../types';
import type { PhotoKey } from './photos';

export type SlideTheme = 'sun' | 'light' | 'dark';

/** One of the low / likely / high boxes under a headline figure. */
export interface Tile {
  label: string;
  value: string;
  emphasis?: boolean;
}

/** A label with a value (and optional second line), e.g. one utility in a comparison. */
export interface Row {
  label: string;
  value: string;
  hint?: string;
}

export interface Slide {
  id: string;
  theme: SlideTheme;
  kicker?: string;
  title: string;
  subtitle?: string;
  /** The headline figure (a range); tiles repeat its low / likely / high. */
  big?: string;
  bigLabel?: string;
  tiles?: Tile[];
  rows?: Row[];
  lines?: string[];
  bullets?: string[];
  /** Call-to-action address shown as a pill, e.g. "rayvalue.com/solar/florida/fpl". */
  url?: string;
  /** Small print at the bottom (estimates disclaimer, data date). */
  footer?: string[];
  /** Reel only (default 4): how long the slide is on screen, including its half of each transition. The renderer stretches it to fit `voice`. */
  seconds?: number;
  /** Full-bleed background photo (licensed, from photos.ts). The renderer darkens it so text stays readable. */
  photo?: PhotoKey;
  /** Reel only: the voice-over line spoken while this slide is on screen. Counts as reader-visible text (rule 1). */
  voice?: string;
}

/** Background music mood for a Reel; scripts/social/audio.ts maps it to a public-domain track. */
export type MusicMood = 'upbeat' | 'calm';

export interface GeneratedPost {
  templateKey: string;
  /** What `target` was (utility slug or state code), recorded in the 'generated' event for rotation. */
  target: string;
  type: Extract<PostType, 'reel' | 'carousel'>;
  /** The one channel this post is written for (captions and hashtags differ per channel). */
  channel: Channel;
  /** Reel only; null = no music. */
  music: MusicMood | null;
  title: string;
  caption: string;
  dataRefs: DataRef[];
  slides: Slide[];
  altText: string;
}
