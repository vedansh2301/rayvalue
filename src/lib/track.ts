/**
 * Send a funnel event: Vercel Web Analytics custom event (cookieless) and, only when the owner has enabled
 * them, the optional ad tags. Props are allowlisted and PII-checked first (src/lib/events.ts). Never throws.
 */
import { track } from '@vercel/analytics';
import { forwardToAdTags } from './ads/adapter';
import { sanitizeEvent } from './events';
import type { EventName } from './events';

export function trackEvent(name: EventName, props: Record<string, unknown> = {}): void {
  const clean = sanitizeEvent(name, props);
  if (!clean) return;
  try {
    track(name, clean);
  } catch {
    /* analytics must never break the page */
  }
  forwardToAdTags(name, clean);
}
