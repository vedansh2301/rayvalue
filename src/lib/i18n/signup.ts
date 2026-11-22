/**
 * Texts of the email sign-up (payback report + deadline alerts) for the calculator countries: English and German.
 * Labels and the consent sentence only; no figures. The consent sentence stored with a signup is built here from the
 * country, language and topics (the server rebuilds it itself and never stores text sent by the browser).
 */
import { resolveUiLang } from './ui';

/** Countries that can collect an email (calculator countries). Order = display order. */
export const SIGNUP_COUNTRIES = ['US', 'GB', 'DE', 'AU'] as const;
export type SignupCountry = (typeof SIGNUP_COUNTRIES)[number];
export const SIGNUP_TOPICS = ['report', 'deadline_alerts'] as const;
export type SignupTopic = (typeof SIGNUP_TOPICS)[number];
export type SignupLocale = 'en' | 'de';

/** Consent sentence split around the privacy-policy link text, so a form can render the link inside the stored sentence. */
export interface ConsentParts {
  before: string;
  link: string;
  after: string;
}

export interface SignupText {
  country: Record<SignupCountry, { name: string; inName: string }>;
  consent: (country: SignupCountry, topics: readonly SignupTopic[]) => ConsentParts;
  emailLabel: string;
  emailOptionalLabel: string;
  emailPlaceholder: string;
  confirmNote: string;
  alertsAlsoLabel: (country: SignupCountry) => string;
  buttons: { report: string; alerts: string; sending: string };
  done: { confirm: string };
  errors: { email: string; consent: string; country: string; generic: string; tooMany: string };
  estimateBox: { heading: string; sub: string };
  blog: { heading: string; sub: string; countryLabel: string };
  home: { alertsOnlyHeading: string; reportHeading: string; alertsSub: string; reportSub: string; optionalNote: string };
}

const EN: SignupText = {
  country: {
    US: { name: 'the United States', inName: 'the United States' },
    GB: { name: 'the United Kingdom', inName: 'the United Kingdom' },
    DE: { name: 'Germany', inName: 'Germany' },
    AU: { name: 'Australia', inName: 'Australia' },
  },
  consent(c, topics) {
    const where = EN.country[c].inName;
    const report = topics.includes('report');
    const alerts = topics.includes('deadline_alerts');
    const what = report
      ? alerts
        ? `Email me my payback report and alerts when a deadline or rate change affects solar in ${where}.`
        : 'Email me this payback estimate.'
      : `Email me alerts when a deadline or rate change affects solar in ${where}.`;
    return { before: `${what} Unsubscribe any time. See our `, link: 'Privacy Policy', after: '.' };
  },
  emailLabel: 'Email address',
  emailOptionalLabel: 'Email address (optional)',
  emailPlaceholder: 'you@example.com',
  confirmNote: 'We send one email first so you can confirm your address. Nothing else is sent until you do.',
  alertsAlsoLabel: (c) => `Also email me alerts when a deadline or rate change affects solar in ${EN.country[c].inName}.`,
  buttons: { report: 'Email me this estimate', alerts: 'Alert me', sending: 'Sending…' },
  done: { confirm: 'Almost done. Check your inbox (and spam folder) and click the link in our email to confirm your address.' },
  errors: {
    email: 'Enter a valid email address, like name@example.com.',
    consent: 'Check the box to agree to receive the email.',
    country: 'Choose a country.',
    generic: 'We could not save that. Please try again in a moment.',
    tooMany: 'Too many requests. Please wait a few minutes and try again.',
  },
  estimateBox: {
    heading: 'Email me this estimate',
    sub: 'We email you a link that reopens this estimate with your answers filled in, so you can change them later. No quote requests and no installer contact.',
  },
  blog: { heading: 'Deadline alerts for your country', sub: 'One email when a rate, grant or tax rule changes the maths. Nothing else.', countryLabel: 'Country' },
  home: {
    alertsOnlyHeading: 'Get deadline alerts',
    reportHeading: 'Email me my report and deadline alerts',
    alertsSub: 'We have no installer partners for this area, so we do not offer quotes. We can email you when a deadline or rate change affects solar.',
    reportSub: 'We have no installer partners here, so we do not offer quotes. We can email you a link to your report and tell you when a deadline or rate change affects solar.',
    optionalNote: 'Optional. Leave it empty to carry on without giving an email.',
  },
};

const DE: SignupText = {
  country: {
    US: { name: 'die USA', inName: 'den USA' },
    GB: { name: 'Großbritannien', inName: 'Großbritannien' },
    DE: { name: 'Deutschland', inName: 'Deutschland' },
    AU: { name: 'Australien', inName: 'Australien' },
  },
  consent(c, topics) {
    const where = DE.country[c].inName;
    const report = topics.includes('report');
    const alerts = topics.includes('deadline_alerts');
    const what = report
      ? alerts
        ? `Senden Sie mir meinen Amortisationsbericht und Hinweise, wenn eine Frist oder eine Preisänderung Solarstrom in ${where} betrifft.`
        : 'Senden Sie mir diese Amortisationsschätzung per E-Mail.'
      : `Senden Sie mir Hinweise, wenn eine Frist oder eine Preisänderung Solarstrom in ${where} betrifft.`;
    return { before: `${what} Abmeldung jederzeit möglich. Siehe unsere `, link: 'Datenschutzerklärung', after: '.' };
  },
  emailLabel: 'E-Mail-Adresse',
  emailOptionalLabel: 'E-Mail-Adresse (optional)',
  emailPlaceholder: 'sie@beispiel.de',
  confirmNote: 'Wir senden zuerst eine E-Mail, mit der Sie Ihre Adresse bestätigen. Bis dahin senden wir nichts weiter.',
  alertsAlsoLabel: (c) => `Senden Sie mir außerdem Hinweise, wenn eine Frist oder eine Preisänderung Solarstrom in ${DE.country[c].inName} betrifft.`,
  buttons: { report: 'Schätzung per E-Mail senden', alerts: 'Benachrichtigen', sending: 'Wird gesendet…' },
  done: { confirm: 'Fast geschafft. Schauen Sie in Ihr Postfach (auch in den Spam-Ordner) und bestätigen Sie Ihre Adresse mit dem Link in unserer E-Mail.' },
  errors: {
    email: 'Geben Sie eine gültige E-Mail-Adresse ein, zum Beispiel name@beispiel.de.',
    consent: 'Bitte setzen Sie das Häkchen, um dem Erhalt der E-Mail zuzustimmen.',
    country: 'Bitte wählen Sie ein Land.',
    generic: 'Das konnten wir nicht speichern. Bitte versuchen Sie es gleich noch einmal.',
    tooMany: 'Zu viele Anfragen. Bitte warten Sie ein paar Minuten und versuchen Sie es erneut.',
  },
  estimateBox: {
    heading: 'Schätzung per E-Mail erhalten',
    sub: 'Wir senden Ihnen einen Link, der diese Schätzung mit Ihren Angaben wieder öffnet, damit Sie sie später ändern können. Keine Angebotsanfrage und kein Kontakt durch Installateure.',
  },
  blog: { heading: 'Fristen-Hinweise für Ihr Land', sub: 'Eine E-Mail, wenn eine Frist, Förderung oder Steuerregel die Rechnung ändert. Sonst nichts.', countryLabel: 'Land' },
  home: {
    alertsOnlyHeading: 'Fristen-Hinweise erhalten',
    reportHeading: 'Bericht und Fristen-Hinweise per E-Mail',
    alertsSub: 'Wir haben hier keine Installationspartner und vermitteln deshalb keine Angebote. Wir können Ihnen aber schreiben, wenn eine Frist oder Preisänderung Solarstrom betrifft.',
    reportSub: 'Wir haben hier keine Installationspartner und vermitteln deshalb keine Angebote. Wir senden Ihnen gern einen Link zu Ihrem Bericht und schreiben Ihnen, wenn eine Frist oder Preisänderung Solarstrom betrifft.',
    optionalNote: 'Optional. Lassen Sie das Feld leer, um ohne E-Mail-Adresse weiterzugehen.',
  },
};

export const signupLocale = (lang?: string | null): SignupLocale => (resolveUiLang(lang) === 'de' ? 'de' : 'en');
/** Sign-up texts for a BCP47 tag: German for de*, English otherwise. */
export const signupText = (lang?: string | null): SignupText => (signupLocale(lang) === 'de' ? DE : EN);

/** The full consent sentence as stored with a signup. */
export function consentSentence(lang: string | null | undefined, country: SignupCountry, topics: readonly SignupTopic[]): string {
  const p = signupText(lang).consent(country, topics);
  return `${p.before}${p.link}${p.after}`;
}

/** Bump when the wording above changes (the stored version identifies which text a person saw). */
export const SIGNUP_CONSENT_VERSION = '2026-11-23.1';
