/**
 * Browser side of the optional GA4 / Google Ads / Meta pixel adapter. A no-op unless an ID is configured
 * (src/lib/ads/config.ts); never called with personal data (events are sanitized in src/lib/events.ts).
 * Scripts are injected from fixed Google/Meta origins that astro.config.mjs adds to the CSP only when enabled.
 */
import { stripQuery } from '../analytics';
import { googleEnabled, type AdIds } from './config';

type Fn = (...args: unknown[]) => void;
interface AdWindow {
  dataLayer?: unknown[];
  gtag?: Fn;
  fbq?: Fn & { queue?: unknown[][]; loaded?: boolean };
}
const w = (): AdWindow => window as unknown as AdWindow;

function loadScript(src: string) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

export function initAdTags(ids: AdIds): void {
  if (typeof window === 'undefined') return;
  const win = w();
  if (googleEnabled(ids)) {
    const first = (ids.ga4 ?? ids.googleAds) as string;
    win.dataLayer = win.dataLayer ?? [];
    win.gtag = function gtag() {
      // gtag.js requires the real `arguments` object in the queue, not an array.
      // eslint-disable-next-line prefer-rest-params
      win.dataLayer!.push(arguments);
    };
    win.gtag('js', new Date());
    // The page URL is reported without its query string (shared calculator links carry ZIP and bill).
    const common = { page_location: stripQuery(location.href), allow_google_signals: false, allow_ad_personalization_signals: false };
    if (ids.ga4) win.gtag('config', ids.ga4, common);
    if (ids.googleAds) win.gtag('config', ids.googleAds, { ...common, allow_enhanced_conversions: false });
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(first)}`);
  }
  if (ids.metaPixel) {
    const q: unknown[][] = [];
    const fbq = function fbq(...args: unknown[]) {
      const f = win.fbq as (Fn & { callMethod?: Fn; queue?: unknown[][] }) | undefined;
      if (f?.callMethod) f.callMethod(...args);
      else q.push(args);
    } as Fn & { queue?: unknown[][]; loaded?: boolean };
    fbq.queue = q;
    fbq.loaded = true;
    win.fbq = fbq;
    fbq('set', 'autoConfig', false, ids.metaPixel); // no automatic form-field matching
    fbq('init', ids.metaPixel);
    fbq('track', 'PageView');
    loadScript('https://connect.facebook.net/en_US/fbevents.js');
  }
}

/** Forward an already-sanitized funnel event to whichever tags are loaded. */
export function forwardToAdTags(name: string, props: Record<string, string | number | boolean>): void {
  if (typeof window === 'undefined') return;
  const win = w();
  try {
    win.gtag?.('event', name, props);
    win.fbq?.('trackCustom', name, props);
  } catch {
    /* ad tags must never break the page */
  }
}
