/**
 * Optional advertising / measurement tags. OFF by default: nothing loads unless the owner sets an ID.
 * Enabling any of them sets third-party cookies/identifiers, so it first requires amending CLAUDE.md rule 7,
 * the privacy policy and adding a consent banner (see docs/LAUNCH.md). IDs are public by nature.
 */
export interface AdIds {
  ga4: string | null;
  googleAds: string | null;
  metaPixel: string | null;
}

const GA4_RE = /^G-[A-Z0-9]{6,14}$/;
const ADS_RE = /^AW-\d{6,15}$/;
const META_RE = /^\d{8,20}$/;

const pick = (raw: unknown, re: RegExp): string | null => {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return re.test(s) ? s : null;
};

export function parseAdIds(env: { PUBLIC_GA4_ID?: unknown; PUBLIC_GOOGLE_ADS_ID?: unknown; PUBLIC_META_PIXEL_ID?: unknown }): AdIds {
  return { ga4: pick(env.PUBLIC_GA4_ID, GA4_RE), googleAds: pick(env.PUBLIC_GOOGLE_ADS_ID, ADS_RE), metaPixel: pick(env.PUBLIC_META_PIXEL_ID, META_RE) };
}

export const googleEnabled = (ids: AdIds): boolean => ids.ga4 !== null || ids.googleAds !== null;
export const anyAdTagEnabled = (ids: AdIds): boolean => googleEnabled(ids) || ids.metaPixel !== null;

/** Third-party origins to add to the CSP, by directive, for the enabled tags only. Empty when all are off. */
export function adCspSources(ids: AdIds): { script: string[]; connect: string[]; img: string[] } {
  const out = { script: [] as string[], connect: [] as string[], img: [] as string[] };
  if (googleEnabled(ids)) {
    out.script.push('https://www.googletagmanager.com');
    out.connect.push('https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.g.doubleclick.net', 'https://www.google.com');
    out.img.push('https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.g.doubleclick.net', 'https://www.google.com');
  }
  if (ids.metaPixel) {
    out.script.push('https://connect.facebook.net');
    out.connect.push('https://www.facebook.com', 'https://connect.facebook.net');
    out.img.push('https://www.facebook.com');
  }
  return out;
}

/**
 * Google Ads conversion actions, as "AW-123456789/AbCdEf" send_to values copied from the Ads UI. Optional: without
 * them Google Ads still gets the events through gtag but no conversion is counted. Only the two ad conversions
 * exist: finishing the calculator and submitting the quote form.
 */
export interface AdConversions {
  calc_complete: string | null;
  quote_submit: string | null;
}
const SEND_TO_RE = /^AW-\d{6,15}\/[A-Za-z0-9_-]{6,40}$/;

export function parseAdConversions(env: { PUBLIC_GOOGLE_ADS_CALC_LABEL?: unknown; PUBLIC_GOOGLE_ADS_QUOTE_LABEL?: unknown }): AdConversions {
  return { calc_complete: pick(env.PUBLIC_GOOGLE_ADS_CALC_LABEL, SEND_TO_RE), quote_submit: pick(env.PUBLIC_GOOGLE_ADS_QUOTE_LABEL, SEND_TO_RE) };
}
