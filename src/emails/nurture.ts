/**
 * Nurture email copy (5 emails, plain text). DRAFT for the owner to edit and for attorney review.
 *
 * Voice: plain, specific, honest about uncertainty. No invented numbers, no promised outcomes, no federal tax
 * credit claims (it does not apply to 2026+ installs), nothing urgent or pushy. Every email ends with the same
 * footer: why they get it, an unsubscribe link and the owner's mailing address. {{MAILING_ADDRESS}} is
 * substituted from NURTURE_MAILING_ADDRESS; the job refuses to send while that is unset, so the placeholder
 * can never reach a recipient.
 *
 * Schedule (src/lib/nurture/schedule.ts): 1 immediately, 2 on day 2, 3 on day 5, 4 on day 10, 5 on day 18.
 */
import { estimateLines } from '../lib/server/email';
import type { EstimateSnapshot } from '../lib/leads/validate';

export interface NurtureContext {
  siteUrl: string;
  state: 'FL' | 'CA' | null;
  snapshot: EstimateSnapshot | null;
  unsubscribeUrl: string;
  /** The real address, or null to leave the {{MAILING_ADDRESS}} placeholder (previews and tests). */
  mailingAddress: string | null;
}

export interface NurtureEmail {
  step: number;
  /** Which day, counted from sign-up, this email goes out (documentation; the schedule is in schedule.ts). */
  day: number;
  subject: string;
  text: string;
}

const STATE_NAME = { FL: 'Florida', CA: 'California' } as const;

const calcUrl = (c: NurtureContext) => (c.state ? `${c.siteUrl}/calculator/${STATE_NAME[c.state].toLowerCase()}` : c.siteUrl);
/** Quotes link prefilled with the state and tagged so the lead's source shows up as nurture email. */
export function quotesUrl(c: NurtureContext, campaign: string): string {
  const q = new URLSearchParams();
  if (c.state) q.set('state', c.state);
  q.set('utm_source', 'nurture');
  q.set('utm_medium', 'email');
  q.set('utm_campaign', campaign);
  return `${c.siteUrl}/quotes?${q.toString()}`;
}

export const footer = (c: NurtureContext): string =>
  [
    '--',
    'You are getting this because you asked RayValue for a solar estimate on rayvalue.com and agreed to occasional solar updates. We never charge homeowners.',
    `Unsubscribe in one click: ${c.unsubscribeUrl}`,
    `Delete your data or opt out of sale or sharing: ${c.siteUrl}/privacy/request`,
    `RayValue, ${c.mailingAddress ?? '{{MAILING_ADDRESS}}'}`,
  ].join('\n');

const body = (c: NurtureContext, lines: string[]): string => [...lines, '', footer(c)].join('\n');

function e1(c: NurtureContext): NurtureEmail {
  const rows = estimateLines(c.snapshot);
  return {
    step: 1,
    day: 0,
    subject: 'Your RayValue solar estimate',
    text: body(c, [
      'Here is the solar estimate you asked us to send.',
      '',
      ...(rows.length ? rows : ['We did not have a saved estimate for you, so run the calculator to get one.']),
      '',
      'These are ranges, not a quote. No federal tax credit is applied. Installer prices and your actual usage will differ.',
      `Pick up where you left off, or change your answers: ${calcUrl(c)}`,
      `How we calculate it, and every assumption we use: ${c.siteUrl}/methodology`,
    ]),
  };
}

const e2 = (c: NurtureContext): NurtureEmail => ({
  step: 2,
  day: 2,
  subject: 'How to read a solar quote',
  text: body(c, [
    'A solar quote is easy to misread. When you get one, check these things before you compare prices:',
    '',
    '1. System size in kilowatts, and how much power the installer says it will make in a year. Ask what that estimate is based on.',
    '2. The price per watt, so you can compare quotes of different sizes fairly.',
    '3. Exactly which panels, inverter and (if any) battery are included, and the warranty on each.',
    '4. What the price covers: permits, utility paperwork, installation and any roof work. Ask what could change the price later.',
    '5. Cash price versus the financed price. A loan or lease changes what you pay in total; ask for both.',
    '6. The installer’s state license, which you can check with your state’s licensing board.',
    '',
    'Put the quotes side by side next to the ranges from your estimate. If a quote is far outside them, ask why. There may be a good reason, such as a shaded roof or a larger system.',
    `Our methodology, so you can see how the ranges are built: ${c.siteUrl}/methodology`,
  ]),
});

const e3 = (c: NurtureContext): NurtureEmail => ({
  step: 3,
  day: 5,
  subject: 'Buy, lease or PPA: what is the difference?',
  text: body(c, [
    'There are three common ways to get solar on your roof, and they are not the same deal.',
    '',
    'Buy (cash or loan): you own the system. Cash costs the most up front. A loan spreads the cost out and adds interest. Savings on your bill are yours after you cover the cost.',
    'Lease: a company owns the system and you pay it a fixed monthly amount. Ask whether that amount goes up every year.',
    'PPA (power purchase agreement): a company owns the system and you pay a price per kilowatt-hour it produces. Ask what the price per kilowatt-hour is and how it changes.',
    '',
    'With a lease or PPA you usually pay less up front, but you also own less of the benefit. Compare the total you would pay over the contract against what your bill would have been. Ask what happens if you sell your home.',
    `Our estimate assumes you buy with cash and applies no federal tax credit. Run it with your own numbers: ${calcUrl(c)}`,
  ]),
});

const e4 = (c: NurtureContext): NurtureEmail => {
  const fl = 'Florida: the case for a battery is mostly about outages. A battery can keep chosen circuits, such as the fridge, lights and internet, running through a storm outage, and solar alone usually shuts off when the grid goes down. In our Florida model a battery adds cost but no extra savings on your bill, so it is a resilience purchase, not a payback one.';
  const ca = 'California: the state’s current net billing rules (often called NEM 3.0) pay less for solar power you send to the grid than the older rules did. That makes it matter more how much of your solar you use yourself, and a battery can help with that by storing daytime power for the evening. Whether it pays back depends on your rate plan and the installed price, so ask for quotes with and without one.';
  return {
    step: 4,
    day: 10,
    subject: c.state === 'FL' ? 'Is a battery worth it in Florida?' : c.state === 'CA' ? 'Is a battery worth it in California?' : 'Is a battery worth it with solar?',
    text: body(c, [
      'Whether a battery is worth it depends on where you live and why you want one.',
      '',
      ...(c.state === 'FL' ? [fl] : c.state === 'CA' ? [ca] : [fl, '', ca]),
      '',
      'Either way, a battery costs extra. Decide first what you want it to do, then price it separately in the quotes you collect.',
      `Run the calculator with and without a battery: ${calcUrl(c)}`,
    ]),
  };
};

const e5 = (c: NurtureContext): NurtureEmail => ({
  step: 5,
  day: 18,
  subject: 'Ready for real numbers?',
  text: body(c, [
    'An estimate tells you what to expect. A quote tells you what an installer will actually charge for your roof.',
    '',
    'If you are ready, we can introduce you to up to 3 local installers. It is free for you, with no obligation to buy. The form shows you exactly which installers will contact you before you submit, and only those installers will.',
    `Get quotes: ${quotesUrl(c, 'nurture_5')}`,
    '',
    'Not ready? That is fine. This is the last email in this series, and you can unsubscribe at any time.',
  ]),
});

export const NURTURE_EMAILS: readonly ((c: NurtureContext) => NurtureEmail)[] = [e1, e2, e3, e4, e5];

export function renderNurtureEmail(step: number, c: NurtureContext): NurtureEmail | null {
  const f = NURTURE_EMAILS[step - 1];
  return f ? f(c) : null;
}
