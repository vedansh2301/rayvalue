/** `--auto` planning (pure): which template + target to generate next to fill the open posting slots. */
import { UTILITY_PAGES } from '../../utility/pages';
import { upcomingSlots } from '../schedule';
import { TEMPLATE_KEYS, templateByKey } from '../template-keys';
import type { PostType, Slot } from '../types';

export const AUTO_DAYS = 7;
export const COOLDOWN_DAYS = 21;
/** Safety cap so a misconfigured slot list cannot fill the queue in one night. */
export const MAX_PER_RUN = 6;

export const STATE_TARGETS = ['fl', 'ca'] as const;

export interface Job {
  template: string;
  target: string;
}

/** A 'generated' social_events row, reduced to what rotation needs. */
export interface HistoryItem extends Job {
  at: string;
}

/** Valid targets for a template, in rotation order. */
export function targetsFor(templateKey: string): string[] {
  const t = templateByKey(templateKey);
  if (!t) return [];
  if (t.target === 'utility') return UTILITY_PAGES.map((p) => p.slug);
  if (t.target === 'state') return [...STATE_TARGETS];
  return ['none'];
}

export const isValidJob = (j: Job) => targetsFor(j.template).includes(j.target);

/** Every template + target for one post type, with the templates interleaved so equal-age candidates alternate. */
export function candidatesFor(type: PostType): Job[] {
  const lists = TEMPLATE_KEYS.filter((t) => t.type === type).map((t) => targetsFor(t.key).map((target) => ({ template: t.key, target })));
  const out: Job[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) out.push(l[i]!);
  return out;
}

/** Open slots for `type` over the next `days` days: scheduled in the settings, minus those a post already occupies. */
export function countFreeSlots(slots: Slot[], type: PostType, timeZone: string, taken: (string | null)[], now: Date, days = AUTO_DAYS): number {
  const used = new Set(taken.filter((t): t is string => !!t).map((t) => Math.floor(new Date(t).getTime() / 60000)));
  return upcomingSlots(slots, type, timeZone, now, days).filter((d) => !used.has(Math.floor(d.getTime() / 60000))).length;
}

export interface AutoPlanInput {
  freeSlots: Partial<Record<PostType, number>>;
  history: HistoryItem[];
  now: Date;
  cooldownDays?: number;
  maxPerRun?: number;
}

/**
 * For each post type with open slots, the least recently generated template + target pairs, skipping any pair
 * generated within the cooldown. Never-generated pairs come first, in interleaved template order.
 */
export function planAuto(input: AutoPlanInput): Job[] {
  const cooldownMs = (input.cooldownDays ?? COOLDOWN_DAYS) * 86_400_000;
  const last = new Map<string, number>();
  for (const h of input.history) {
    const t = new Date(h.at).getTime();
    const k = `${h.template}|${h.target}`;
    if (Number.isFinite(t) && t > (last.get(k) ?? -Infinity)) last.set(k, t);
  }
  const out: Job[] = [];
  for (const type of ['reel', 'carousel'] as const) {
    const want = Math.max(0, input.freeSlots[type] ?? 0);
    if (!want) continue;
    const eligible = candidatesFor(type)
      .map((j, order) => ({ j, order, at: last.get(`${j.template}|${j.target}`) ?? -Infinity }))
      .filter((c) => input.now.getTime() - c.at >= cooldownMs)
      .sort((a, b) => a.at - b.at || a.order - b.order);
    out.push(...eligible.slice(0, want).map((c) => c.j));
  }
  return out.slice(0, input.maxPerRun ?? MAX_PER_RUN);
}
