/**
 * Funnel events (CLAUDE.md rule 7: Vercel Web Analytics custom events; no PII ever).
 * Every event has a fixed allowlist of properties; anything else is dropped before it leaves the page, and string
 * values must look like short tokens (no '@', no spaces, no long digit runs), so a name, email, phone number or
 * address cannot be sent even by mistake. Pure and unit tested; the sender is src/lib/track.ts.
 */
export const EVENT_PROPS = {
  calc_start: ['state'],
  calc_step: ['state', 'step'],
  calc_complete: ['state', 'battery', 'shading'],
  results_cta_click: ['state', 'placement'],
  quote_form_start: ['source', 'state'],
  /** Fired once per submission on /quotes/thank-you. */
  quote_submit: ['source', 'state'],
  /** Fired by the quote form when the SMS code is approved (only when Twilio Verify is configured). */
  phone_verified: ['source', 'state'],
  call_click: ['placement'],
} as const satisfies Record<string, readonly string[]>;

export type EventName = keyof typeof EVENT_PROPS;
export type EventProps = Record<string, string | number | boolean>;

export const isEventName = (n: unknown): n is EventName => typeof n === 'string' && Object.hasOwn(EVENT_PROPS, n);

const TOKEN_RE = /^[A-Za-z0-9_:/-]{1,40}$/;
const LONG_DIGITS_RE = /\d{5,}/;

/** Keep only allowlisted, token-shaped props. Returns null for an unknown event name. */
export function sanitizeEvent(name: string, props: Record<string, unknown> = {}): EventProps | null {
  if (!isEventName(name)) return null;
  const allowed: readonly string[] = EVENT_PROPS[name];
  const out: EventProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (!allowed.includes(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1000) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && TOKEN_RE.test(v) && !LONG_DIGITS_RE.test(v)) out[k] = v;
  }
  return out;
}
