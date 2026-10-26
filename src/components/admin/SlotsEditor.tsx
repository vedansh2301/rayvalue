/**
 * Weekly posting slots editor (admin settings). Rows of weekday / time / post type; the list travels in one hidden
 * field as JSON and is validated again on the server (isValidSlot). No math: just list editing.
 */
import { useState } from 'preact/hooks';
import { isValidSlot } from '../../lib/social/schedule';
import { DOW_LABELS } from '../../lib/social/forms';
import { POST_TYPES, type PostType, type Slot } from '../../lib/social/types';

const field = 'min-h-11 rounded border border-stone-400 bg-white px-2 py-2 text-stone-900';

export default function SlotsEditor(p: { initial: Slot[] }) {
  const [slots, setSlots] = useState<Slot[]>(p.initial);
  const set = (i: number, patch: Partial<Slot>) => setSlots((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const allValid = slots.every(isValidSlot);
  return (
    <div>
      <input type="hidden" name="slots" value={JSON.stringify(slots)} />
      {slots.length === 0 && <p class="text-sm text-stone-700">No slots. Posts can still be scheduled at a chosen time.</p>}
      <ul class="space-y-2">
        {slots.map((s, i) => (
          <li key={i} class="flex flex-wrap items-end gap-2 rounded border border-stone-200 bg-white p-2">
            <div class="flex flex-col gap-1">
              <label for={`slot-dow-${i}`} class="text-xs font-medium text-stone-800">Day</label>
              <select id={`slot-dow-${i}`} class={field} value={s.dow} onChange={(e) => set(i, { dow: Number(e.currentTarget.value) })}>
                {DOW_LABELS.map((d, n) => (
                  <option key={d} value={n} selected={s.dow === n}>{d}</option>
                ))}
              </select>
            </div>
            <div class="flex flex-col gap-1">
              <label for={`slot-time-${i}`} class="text-xs font-medium text-stone-800">Time</label>
              <input id={`slot-time-${i}`} type="time" required class={field} value={s.time} onInput={(e) => set(i, { time: e.currentTarget.value })} />
            </div>
            <div class="flex flex-col gap-1">
              <label for={`slot-type-${i}`} class="text-xs font-medium text-stone-800">Post type</label>
              <select id={`slot-type-${i}`} class={field} value={s.type} onChange={(e) => set(i, { type: e.currentTarget.value as PostType })}>
                {POST_TYPES.map((t) => (
                  <option key={t} value={t} selected={s.type === t}>{t}</option>
                ))}
              </select>
            </div>
            <button type="button" class="min-h-11 rounded border border-stone-400 px-3 py-2 text-stone-900 hover:bg-stone-100" onClick={() => setSlots((x) => x.filter((_, j) => j !== i))}>
              Remove<span class="sr-only"> slot {i + 1}</span>
            </button>
          </li>
        ))}
      </ul>
      {!allValid && <p role="alert" class="mt-2 text-sm font-medium text-red-800">Every slot needs a time.</p>}
      <button type="button" class="mt-3 min-h-11 rounded border border-stone-400 bg-white px-4 py-2 font-semibold text-stone-900 hover:bg-stone-100" onClick={() => setSlots((x) => [...x, { dow: 1, time: '12:00', type: 'reel' }])}>
        Add a slot
      </button>
    </div>
  );
}
