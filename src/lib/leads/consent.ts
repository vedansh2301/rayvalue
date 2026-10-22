/**
 * The consent sentence shown next to the quote form's checkbox, and stored with every lead.
 * The database stores them with every lead via a trigger (supabase/migrations/0005_leads_consent_trigger.sql), never
 * text sent by a client. When the text changes: bump the version here and add a migration replacing the trigger
 * function with the same constants (consent.test.ts compares them).
 * Owner: legal review of this consent before paid traffic.
 */
export const CONSENT_VERSION = '2026-10-22.1';

/** The sentence before the privacy link (the form renders the link; the stored text names it). */
export const CONSENT_LEAD =
  'By submitting, you agree that RayValue and up to 3 solar installers serving your area may contact you by phone (including calls and texts using automated technology), text or email about solar quotes. Consent is not a condition of purchase. Message and data rates may apply. You can opt out at any time.';

/** Exactly what the user saw, as stored in leads.consent_text. */
export const CONSENT_TEXT = `${CONSENT_LEAD} See our Privacy Policy (/privacy).`;
