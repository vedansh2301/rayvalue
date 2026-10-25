/**
 * Public contact address (PUBLIC_CONTACT_EMAIL, build time; public by nature). The owner sets it
 * in the Vercel project env; it is never invented in code. While it is unset:
 *  - /contact points to the privacy request form instead of an email address, and
 *  - the rate-alerts signup is not rendered and /api/subscribe refuses signups,
 * because collecting emails without a way to ask for deletion is not acceptable.
 */

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** A trimmed, plausible email address, or null (unset, blank or malformed). */
export function parseContactEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s.length > 0 && s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}

export const CONTACT_EMAIL: string | null = parseContactEmail(import.meta.env.PUBLIC_CONTACT_EMAIL);

/** Rate-alert signups are offered only when there is a contact address for deletion requests. */
export const ALERTS_ENABLED: boolean = CONTACT_EMAIL !== null;
