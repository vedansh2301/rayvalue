/**
 * Shapes shared by the social post generator (pure content builders in this folder, rendering and I/O in scripts/social/).
 * A Slide is data only: the renderer decides how it looks; builders never draw and the renderer never invents text.
 */
import type { DataRef, PostType } from '../types';

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
  /** Reel only (default 4): how long the slide is on screen, including its half of each transition. */
  seconds?: number;
}

export interface GeneratedPost {
  templateKey: string;
  /** What `target` was (utility slug or state code), recorded in the 'generated' event for rotation. */
  target: string;
  type: Extract<PostType, 'reel' | 'carousel'>;
  title: string;
  caption: string;
  dataRefs: DataRef[];
  slides: Slide[];
  altText: string;
}
