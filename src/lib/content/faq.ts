/**
 * Visible FAQ content (Phase 3.2). One source for the on-page text AND the FAQPage JSON-LD, so the structured data
 * can never describe answers that are not on the page. Plain text only (no HTML).
 *
 * Answers must stay consistent with /methodology and /privacy (and the consent wording in src/lib/leads/consent.ts):
 * no promised outcomes, no invented numbers. Owner: review before launch (legal review of the contact/consent answers).
 * Phase 5 reuses this: add items here, pick them by id.
 */
export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export const FAQ: FaqItem[] = [
  {
    id: 'free',
    question: 'Is RayValue really free?',
    answer:
      'Yes. The calculator needs no sign-up, and asking for installer quotes costs you nothing and does not obligate you to buy anything. Homeowners never pay RayValue.',
  },
  {
    id: 'money',
    question: 'How do you make money?',
    answer:
      'Installers pay RayValue for introductions to homeowners who ask to hear from them, and some pages include affiliate links, which are labeled. Those relationships do not change the calculator’s math: every rate, cost and assumption it uses is listed on the methodology page.',
  },
  {
    id: 'contact',
    question: 'Who will contact me if I ask for quotes, and how many?',
    answer:
      'Only RayValue and the installers named in the consent wording next to the button, which lists the installers serving your ZIP code, up to 3 of them. If fewer serve your area you will hear from fewer, and if none do yet, we save your request and do not share it with any installer until one serves your area. You can see exactly who is named before you submit.',
  },
  {
    id: 'spam',
    question: 'Will I get spam calls?',
    answer:
      'We share your request only with the installers named in the consent wording and never sell it to other marketers or data brokers. Those installers and RayValue may contact you about solar quotes by phone, text and email, including with automated technology or prerecorded messages, so you should expect calls from them after you submit. You can opt out at any time: reply STOP to a text, tell the installer directly, or use our privacy request form, including the Do Not Sell or Share option.',
  },
  {
    id: 'without-credit',
    question: 'Does solar still make sense without the federal tax credit?',
    answer:
      'For some homes it does and for others it does not, which is why the calculator exists. The federal residential credit has ended for new installs, so we apply none. Whether solar pays back depends on your utility’s rates, how much power you use, how much sun your roof gets and what an installer charges, and some results show that it will not pay back within the analysis period.',
  },
  {
    id: 'buy-loan-lease',
    question: 'Buying vs a loan vs a lease or PPA: what is the difference?',
    answer:
      'If you pay cash or take a loan, you own the system. Cash has the highest upfront cost; a loan spreads the cost over time and adds interest. With a lease or a power purchase agreement (PPA), a company owns the system and you pay a monthly amount (lease) or a price per kilowatt-hour produced (PPA). The calculator estimates buying with cash and does not include loan interest or financing costs. Results also explain how a lease or PPA compares.',
  },
  {
    id: 'accuracy',
    question: 'How accurate is the calculator?',
    answer:
      'It gives estimates, shown as low, likely and high ranges, not quotes. It uses your utility’s published rates, a solar production model for your location, and cost ranges for your state, and it lists every assumption. It does not include financing costs, maintenance, or inverter and battery replacement, and your installer’s price and your actual usage will differ.',
  },
];

/** Items by id, in the order given (throws on an unknown id so a typo fails the build/tests, not silently). */
export function faqItems(ids: readonly string[]): FaqItem[] {
  return ids.map((id) => {
    const item = FAQ.find((f) => f.id === id);
    if (!item) throw new Error(`unknown FAQ id: ${id}`);
    return item;
  });
}

/** Homepage shows the four highest-intent questions (the rest are on /quotes and in the guides); the quotes page shows the ones about getting quotes. */
export const HOME_FAQ_IDS = ['without-credit', 'accuracy', 'free', 'money'] as const;
export const QUOTES_FAQ_IDS = ['free', 'money', 'contact', 'spam', 'accuracy'] as const;
