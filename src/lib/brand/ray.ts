/** Ray (the mascot) poses; see src/components/brand/Ray.astro. */
export type RayPose = 'mark' | 'wave' | 'point' | 'calendar' | 'magnifier' | 'confused';
export const RAY_POSES: readonly RayPose[] = ['mark', 'wave', 'point', 'calendar', 'magnifier', 'confused'];

/** Ray's face as a standalone SVG string (same artwork as Ray.astro pose "mark"), for the OG share card. */
export function rayMarkSvg(): string {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    return `M${(70 + Math.cos(a) * 43).toFixed(1)} ${(60 + Math.sin(a) * 43).toFixed(1)}L${(70 + Math.cos(a) * 53).toFixed(1)} ${(60 + Math.sin(a) * 53).toFixed(1)}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="15 5 110 110" width="220" height="220"><path d="${rays}" stroke="#f59e0b" stroke-width="6" stroke-linecap="round" fill="none"/><circle cx="70" cy="60" r="34" fill="#fbbf24" stroke="#f59e0b" stroke-width="3"/><circle cx="52" cy="68" r="5.5" fill="#fb923c" opacity="0.45"/><circle cx="88" cy="68" r="5.5" fill="#fb923c" opacity="0.45"/><circle cx="58" cy="57" r="4" fill="#1c1917"/><circle cx="82" cy="57" r="4" fill="#1c1917"/><path d="M56 70q14 14 28 0z" fill="#1c1917" stroke="#1c1917" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
}
