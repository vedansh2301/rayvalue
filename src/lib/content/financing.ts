/**
 * Plain-language lease / PPA explanation (Phase 3.4), shown in calculator results. Explanatory only: any figures
 * come from the database via src/lib/calc/lease-ppa.ts and are shown only when the owner has entered them.
 * Owner: review before launch (the tax-benefit sentence is worth a quick check with a tax professional).
 */
import type { Note } from './fl-battery';

export const FINANCING_TITLE = 'Buying vs leasing or a power purchase agreement (PPA)';

export const FINANCING_NOTES: Note[] = [
  {
    heading: 'How a lease or PPA works',
    body: 'A company owns the solar system on your roof. With a lease you pay a monthly amount. With a PPA you pay a set price for each kilowatt-hour the system produces. Either way you usually pay little or nothing upfront.',
  },
  {
    heading: 'Why the price can be lower',
    body: 'The company that owns the system may still be able to use federal tax benefits that are no longer available to homeowners who buy. That can show up as a lower monthly payment or kWh price. These rules can change, so ask the installer what is built into the price.',
  },
  {
    heading: 'What to compare',
    body: 'The yearly increase in the payment (the escalator), the contract length, what happens if you sell the home, who handles repairs and monitoring, and whether the company files a lien or notice against your property. The total you pay over the contract is what to compare with the net savings of buying.',
  },
];

/** Shown when no verified lease/PPA pricing is available. */
export const FINANCING_NO_NUMBERS =
  'We do not show lease or PPA prices yet because we have not verified a source for typical market terms. Ask installers to quote a purchase and a lease or PPA for the same system, then compare the total you would pay over the contract with the net savings above.';

/** Shown with numbers. */
export const FINANCING_WITH_NUMBERS_BASIS =
  'These figures use the same system as the purchase estimate above, assume the contract runs for the full analysis period, and subtract the payments from your bill savings. They are not a quote, and they leave out contract terms such as buyout and transfer fees.';
