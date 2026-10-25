/**
 * One icon system: 24px grid, 1.75 stroke, rounded caps, two-tone (stone-900 stroke via currentColor +
 * sun-400 accent fill). Always decorative (aria-hidden): meaning is carried by adjacent text.
 * Renders to static HTML in Astro pages (no client: directive) and works inside the Preact islands.
 * Inline SVG with presentation attributes only (hashed CSP: no style=).
 */
const ACCENT = '#fbbf24';

type Shape = readonly [d: string, accent?: boolean];

const ICONS = {
  shield: [['M12 3l7.5 3v5.5c0 4.4-3.1 7.8-7.5 9.5-4.4-1.7-7.5-5.1-7.5-9.5V6z', true], ['M8.8 12.2l2.2 2.2 4.2-4.4']],
  users: [['M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5z', true], ['M9 11.5a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z'], ['M16 5.4a3 3 0 010 5.8M17.5 14.8c2.2.5 3.5 2.2 3.5 4.7']],
  lock: [['M5.5 10.5h13v9.5h-13z', true], ['M8.5 10.5V8a3.5 3.5 0 017 0v2.5'], ['M12 14v2.5']],
  home: [['M5.5 11l6.5-6 6.5 6v8.5h-13z', true], ['M3.5 12L12 4l8.5 8'], ['M10 19.5v-5h4v5']],
  key: [['M7.5 14.5a4 4 0 110-8 4 4 0 010 8z', true], ['M11 11.5l9 0M17.5 11.5v3M20.5 11.5v2.5']],
  bolt: [['M13 3L5.5 13.5H11L10 21l8.5-11H13z', true]],
  calendar: [['M4.5 8h15v11.5h-15z', true], ['M4.5 8V6h15v2M8 4v3M16 4v3']],
  'calendar-plus': [['M4.5 8h15v11.5h-15z', true], ['M4.5 8V6h15v2M8 4v3M16 4v3M12 11v6M9 14h6']],
  search: [['M10.5 17a6.5 6.5 0 110-13 6.5 6.5 0 010 13z', true], ['M15.5 15.5l5 5']],
  clipboard: [['M6 5.5h12v15H6z', true], ['M9 5.5V4h6v1.5M9 11h6M9 14.5h4']],
  phone: [['M7 3.5h10v17H7z', true], ['M11 17.5h2']],
  scale: [['M6 8h12v3H6z', true], ['M12 4v16M8 20h8M6 11l-2.5 5h5zM18 11l-2.5 5h5z']],
  sun: [['M12 16.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z', true], ['M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4']],
  tool: [['M14.5 6a4 4 0 004.8 4.8L13 17.1a2 2 0 01-2.8 0L7 14a2 2 0 010-2.8z', true], ['M5 19l2.5-2.5']],
  chart: [['M5 16l4-4 3 3 6-7v11H5z', true], ['M4 4v16h16']],
  arrow: [['M4 12h15M13.5 6l6 6-6 6']],
  check: [['M5 12.5l4.5 4.5L19 7.5']],
  florida: [['M6 4h6.5l1.2 3H18l-1 3 1.8 2.6-.8 4.4-2.7 2.5-1.5-3-2.4-3.2L8 10 6 8z', true]],
  california: [['M7 3.5l6.5 0 .5 4.5 4 5.5-3.5 6.5-3 .5-3.5-4.5-1.5-4.5z', true]],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;

export default function Icon({ name, size = 24, class: cls }: { name: IconName; size?: number; class?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class={`shrink-0 ${cls ?? ''}`}>
      {(ICONS[name] as readonly Shape[]).map(([d, accent], i) => (
        <path key={i} d={d} fill={accent ? ACCENT : 'none'} />
      ))}
    </svg>
  );
}
