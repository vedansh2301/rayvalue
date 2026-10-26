/** Reel timing (pure): xfade offsets for a chain of slides that each hold for `seconds` including their half of each transition. */
export const XFADE_SECONDS = 0.5;
/**
 * Planned Reel length: aim for 18-25 s. Instagram ranks Reels on completion and first-day watch time was ~5-9 s, so
 * short wins. Above this the renderer warns; above REEL_RENDER_MAX_SECONDS (render.ts, 30 s) it refuses.
 */
export const REEL_TARGET_SECONDS = { min: 18, max: 25 } as const;
export const REEL_MAX_SECONDS = REEL_TARGET_SECONDS.max;

export interface ReelTimeline {
  /** xfade offset for the transition into slide k (k = 1 .. n-1), at index k-1. */
  offsets: number[];
  total: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function reelTimeline(seconds: readonly number[], xfade = XFADE_SECONDS): ReelTimeline {
  if (seconds.length === 0) return { offsets: [], total: 0 };
  const offsets: number[] = [];
  let sum = 0;
  for (let k = 1; k < seconds.length; k++) {
    sum += seconds[k - 1]!;
    offsets.push(r3(sum - k * xfade));
  }
  const all = sum + seconds[seconds.length - 1]!;
  return { offsets, total: r3(all - (seconds.length - 1) * xfade) };
}
