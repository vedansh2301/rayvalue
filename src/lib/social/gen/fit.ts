/**
 * Text fitting for the slide renderer (pure). satori does not measure text for us, so font sizes are chosen from the
 * character count with a deliberately wide Inter-bold average (digits and capitals run about 0.62 em).
 */
export const AVG_CHAR_EM = 0.62;

/** Length of the longest line when `text` is split into at most `maxLines` lines at spaces (greedy-optimal for 1 or 2 lines). */
export function longestLine(text: string, maxLines: 1 | 2): number {
  if (maxLines === 1 || !text.includes(' ')) return text.length;
  const words = text.split(' ');
  let best = text.length;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    best = Math.min(best, Math.max(a, b));
  }
  return best;
}

/** Largest font size (px) <= maxSize at which `text` fits in `maxWidth` on `maxLines` lines, never below minSize. */
export function fitFontSize(text: string, maxWidth: number, maxSize: number, minSize: number, maxLines: 1 | 2 = 1): number {
  const chars = Math.max(1, longestLine(text, maxLines));
  return Math.max(minSize, Math.min(maxSize, Math.floor(maxWidth / (chars * AVG_CHAR_EM))));
}
