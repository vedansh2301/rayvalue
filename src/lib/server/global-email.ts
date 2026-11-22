/**
 * Emails of the global sign-up (plain text, English and German). Two messages:
 *  - confirmation (double opt-in): a confirm link, plus the reopen-my-estimate link when a report was asked for;
 *  - report: the reopen link only, for an address that is already confirmed.
 * No figure is computed or quoted here: the link opens the calculator with the person's answers filled in and the
 * calculator shows the low / likely / high ranges itself. SERVER ONLY (sent through the Resend adapter in email.ts).
 */
import type { SignupCountry, SignupLocale, SignupTopic } from '../i18n/signup';
import { signupText } from '../i18n/signup';
import type { EmailMessage } from './email';
import { unsubscribeHeaders } from './email';

export interface GlobalEmailInput {
  to: string;
  country: SignupCountry;
  locale: SignupLocale;
  topics: readonly SignupTopic[];
  confirmUrl: string;
  unsubscribeUrl: string;
  /** Link that reopens the estimate (only when the report was asked for). */
  reportUrl: string | null;
  siteUrl: string;
  mailingAddress: string | null;
}

interface Copy {
  confirmSubject: string;
  reportSubject: string;
  hello: string;
  asked: (where: string, topics: readonly SignupTopic[]) => string;
  confirmLine: string;
  reportLine: string;
  reportNote: string;
  alertsNote: string;
  ignore: string;
  unsubscribe: string;
  methodology: string;
  reportOnlyIntro: string;
}

const COPY: Record<SignupLocale, Copy> = {
  en: {
    confirmSubject: 'Confirm your email address for RayValue',
    reportSubject: 'Your RayValue estimate link',
    hello: 'Hello,',
    asked: (where, topics) =>
      topics.includes('report') && topics.includes('deadline_alerts')
        ? `Someone (hopefully you) asked RayValue to email this address a link to a solar payback estimate, and alerts when a deadline or rate change affects solar in ${where}.`
        : topics.includes('report')
          ? 'Someone (hopefully you) asked RayValue to email this address a link to a solar payback estimate.'
          : `Someone (hopefully you) asked RayValue to email this address alerts when a deadline or rate change affects solar in ${where}.`,
    confirmLine: 'Please confirm your address (one click):',
    reportLine: 'Reopen your estimate with your answers filled in:',
    reportNote: 'The figures are calculated on that page when it opens, as low, likely and high ranges. They are not a quote and not in this email.',
    alertsNote: 'Until you confirm, we send nothing else. After you confirm, we will email you only when a deadline or rate change affects solar where you are.',
    ignore: 'If this was not you, ignore this email. We will not email you again.',
    unsubscribe: 'Unsubscribe or delete your data:',
    methodology: 'How we calculate:',
    reportOnlyIntro: 'You asked us to email you a link to your solar payback estimate.',
  },
  de: {
    confirmSubject: 'Bitte bestätigen Sie Ihre E-Mail-Adresse bei RayValue',
    reportSubject: 'Ihr RayValue-Link zur Schätzung',
    hello: 'Guten Tag,',
    asked: (where, topics) =>
      topics.includes('report') && topics.includes('deadline_alerts')
        ? `Jemand (hoffentlich Sie) hat RayValue gebeten, an diese Adresse einen Link zu einer Solar-Amortisationsschätzung zu senden, außerdem Hinweise, wenn eine Frist oder Preisänderung Solarstrom in ${where} betrifft.`
        : topics.includes('report')
          ? 'Jemand (hoffentlich Sie) hat RayValue gebeten, an diese Adresse einen Link zu einer Solar-Amortisationsschätzung zu senden.'
          : `Jemand (hoffentlich Sie) hat RayValue gebeten, an diese Adresse Hinweise zu senden, wenn eine Frist oder Preisänderung Solarstrom in ${where} betrifft.`,
    confirmLine: 'Bitte bestätigen Sie Ihre Adresse (ein Klick):',
    reportLine: 'Schätzung mit Ihren Angaben erneut öffnen:',
    reportNote: 'Die Zahlen werden beim Öffnen der Seite berechnet, als niedrige, wahrscheinliche und hohe Spanne. Sie sind kein Angebot und stehen nicht in dieser E-Mail.',
    alertsNote: 'Bis zur Bestätigung senden wir nichts weiter. Danach schreiben wir Ihnen nur, wenn eine Frist oder Preisänderung Solarstrom an Ihrem Ort betrifft.',
    ignore: 'Wenn Sie das nicht waren, ignorieren Sie diese E-Mail. Wir schreiben Ihnen dann nicht wieder.',
    unsubscribe: 'Abmelden oder Daten löschen:',
    methodology: 'So rechnen wir:',
    reportOnlyIntro: 'Sie haben uns gebeten, Ihnen einen Link zu Ihrer Solar-Amortisationsschätzung zu senden.',
  },
};

const footer = (c: Copy, i: GlobalEmailInput): string[] => [
  '',
  `${c.methodology} ${i.siteUrl}/methodology`,
  `${c.unsubscribe} ${i.unsubscribeUrl}`,
  ...(i.mailingAddress ? [`RayValue, ${i.mailingAddress}`] : []),
];

/** Double opt-in email. Contains the reopen link too when a report was asked for. */
export function buildConfirmationEmail(i: GlobalEmailInput): EmailMessage {
  const c = COPY[i.locale];
  const where = signupText(i.locale).country[i.country].inName;
  const report = i.topics.includes('report') && i.reportUrl;
  return {
    to: i.to,
    subject: c.confirmSubject,
    text: [
      c.hello,
      '',
      c.asked(where, i.topics),
      '',
      c.confirmLine,
      i.confirmUrl,
      ...(report ? ['', c.reportLine, i.reportUrl!, c.reportNote] : []),
      ...(i.topics.includes('deadline_alerts') ? ['', c.alertsNote] : []),
      '',
      c.ignore,
      ...footer(c, i),
    ].join('\n'),
    headers: unsubscribeHeaders(i.unsubscribeUrl),
  };
}

/** The reopen-my-estimate email for an address that is already confirmed. */
export function buildReportEmail(i: GlobalEmailInput): EmailMessage {
  const c = COPY[i.locale];
  return {
    to: i.to,
    subject: c.reportSubject,
    text: [c.hello, '', c.reportOnlyIntro, '', c.reportLine, i.reportUrl ?? `${i.siteUrl}/`, c.reportNote, ...footer(c, i)].join('\n'),
    headers: unsubscribeHeaders(i.unsubscribeUrl),
  };
}
