/**
 * Public brand profiles and support address, as given by the owner (not derived data). Used by the footer and the
 * Organization JSON-LD `sameAs`. Override the list with PUBLIC_SOCIAL_PROFILES (comma-separated https URLs) if it changes.
 */
export const DEFAULT_SOCIAL_PROFILES = [
  { name: 'Instagram', url: 'https://www.instagram.com/rayvalue_usa/' },
  { name: 'Facebook', url: 'https://www.facebook.com/1307379799134896' },
] as const;

export const SUPPORT_EMAIL = 'support@rayvalue.com';

/** Parse a comma-separated env list into https URLs, dropping anything else. Empty/unset: the defaults. */
export function parseSocialProfiles(raw: unknown): string[] {
  const def = DEFAULT_SOCIAL_PROFILES.map((p) => p.url);
  if (typeof raw !== 'string' || raw.trim() === '') return def;
  const urls = raw.split(',').map((s) => s.trim()).filter((s) => /^https:\/\/\S+$/.test(s));
  return urls.length > 0 ? urls : def;
}

export const SOCIAL_PROFILES: string[] = parseSocialProfiles(import.meta.env?.PUBLIC_SOCIAL_PROFILES);
