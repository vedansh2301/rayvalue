/** Location tags for social posts (pure). Rows: public.social_locations (supabase/migrations/0017_social_locations.sql). */
import type { SocialLocation } from './types';

export const LOCATION_KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isLocationKey = (s: unknown): s is string => typeof s === 'string' && s.length <= 40 && LOCATION_KEY_RE.test(s);

/**
 * The location a generated post for `target` (utility slug or state code) is tagged with: the first row by key that lists
 * the target and has a verified place id. null when none does (the post goes out untagged).
 */
export function locationKeyForTarget(rows: readonly Pick<SocialLocation, 'key' | 'targets' | 'fb_place_id'>[], target: string): string | null {
  if (!target) return null;
  const hit = [...rows].sort((a, b) => a.key.localeCompare(b.key)).find((r) => r.fb_place_id && Array.isArray(r.targets) && r.targets.includes(target));
  return hit?.key ?? null;
}
