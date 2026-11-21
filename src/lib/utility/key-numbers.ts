/** Key numbers for a utility page (answer-first block): rates, export credit, fixed charge, the 25D rule. */
import type { Utility } from '../../data/schemas';
import { exportKeyNumber, federalCreditKeyNumber, finishBlock, fixedChargeKeyNumber, rateKeyNumber, type KeyNumbersBlock } from '../seo/key-numbers';

export function utilityKeyNumbers(u: Utility, short: string): KeyNumbersBlock {
  const rate = rateKeyNumber(u);
  const answer = rate
    ? `${short} ${u.rate_type === 'tou_summary' ? 'bills time-of-use rates' : 'bills tiered rates'} and ${u.metering_type === 'nem3_net_billing' ? 'credits solar exports through NEM 3.0 net billing' : 'credits solar exports through retail net metering'}; the federal 25D credit is not available for 2026+ installs.`
    : null;
  return finishBlock(answer, [rate, exportKeyNumber(u), fixedChargeKeyNumber(u), federalCreditKeyNumber()]);
}
