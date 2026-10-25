/**
 * Lead consent wording (TCPA-style written consent) and its composition from the installer list.
 *
 * ATTORNEY REVIEW REQUIRED before paid traffic: CONSENT_TEMPLATE, NO_INSTALLERS_PHRASE and ESTIMATE_EMAIL_CONSENT_TEXT
 * are starting templates, not legal advice.
 *
 * The text a person sees is composed here from the installer names the server looked up for their ZIP. The server
 * recomputes it from its own lookup (never from client text) and stores it with the lead; the database trigger
 * (supabase/migrations/0006_lead_capture.sql, leads_set_consent) recomputes it once more and rejects a mismatch.
 * The constants below must equal the migration's; consent.test.ts compares them. When the wording changes: bump the
 * versions here and add a migration that replaces leads_set_consent with the same constants.
 */

/** Label of the submit button the consent text refers to. The button must carry exactly this label. */
export const SUBMIT_LABEL = 'Get my free quotes';

export const CONSENT_TEMPLATE =
  'By clicking "Get my free quotes," I agree that RayValue and {{INSTALLER_NAMES}} may contact me about solar at the phone number and email I provided, including by calls and texts made with automated technology or prerecorded messages. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to opt out. See our Privacy Policy.';

/** Version when the text names installers (at least one active buyer serves the ZIP). */
export const CONSENT_VERSION_NAMED = '2026-10-25.1';
/** Version when no buyer serves the ZIP yet: the same template with a generic phrase instead of names. */
export const CONSENT_VERSION_AREA = '2026-10-25.2';
export const NO_INSTALLERS_PHRASE = 'solar installers serving my area';

/** ["A"] -> "A"; ["A","B"] -> "A and B"; ["A","B","C"] -> "A, B, and C" (same join as the database trigger). */
export function joinInstallerNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export interface Consent {
  version: string;
  text: string;
  /** legal_name of each installer named in the text (empty for the generic wording). */
  installers: string[];
}

/** The consent a person gets for a ZIP, from the installers serving it. */
export function consentFor(installers: readonly string[]): Consent {
  const list = installers.map((n) => n.trim()).filter(Boolean);
  const named = list.length > 0;
  return {
    version: named ? CONSENT_VERSION_NAMED : CONSENT_VERSION_AREA,
    text: CONSENT_TEMPLATE.replace('{{INSTALLER_NAMES}}', named ? joinInstallerNames(list) : NO_INSTALLERS_PHRASE),
    installers: list,
  };
}

/** Splits consent text around "Privacy Policy" so the form can render that phrase as a link. */
export function splitAtPrivacyPolicy(text: string): [string, string] | null {
  const i = text.lastIndexOf('Privacy Policy');
  return i < 0 ? null : [text.slice(0, i), text.slice(i + 'Privacy Policy'.length)];
}

/** Email-estimate opt-in (no phone). Shown next to the checkbox and stored with the request. Attorney review. */
export const ESTIMATE_EMAIL_CONSENT_VERSION = '2026-10-25.1';
export const ESTIMATE_EMAIL_CONSENT_TEXT =
  'Email me this estimate. I also agree that RayValue may email me occasional updates about solar costs and savings. I can unsubscribe at any time. See our Privacy Policy.';
