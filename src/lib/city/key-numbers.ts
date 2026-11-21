/** Key numbers for a city page (answer-first block). Formatting and selection only; see src/lib/seo/key-numbers.ts. */
import type { City, CityProduction, StateCosts, Utility } from '../../data/schemas';
import { formatUsd } from '../format';
import { maxDate } from '../seo/lastmod';
import {
  federalCreditKeyNumber,
  finishBlock,
  exportKeyNumber,
  fixedChargeKeyNumber,
  installedCostKeyNumber,
  productionKeyNumber,
  rateKeyNumber,
  type KeyNumber,
  type KeyNumbersBlock,
} from '../seo/key-numbers';
import { paybackPhrase } from './meta';
import type { ExampleRow } from './view';

export interface CityKeyNumbersInput {
  city: Pick<City, 'name'>;
  utility: Utility | null;
  /** Utility's short display name, e.g. "FPL" (copy metadata), or null. */
  utilityShort: string | null;
  production: CityProduction | null;
  costs: StateCosts | null;
  /** Example rows (illustrative bills); the middle one is used. */
  examples: readonly ExampleRow[] | null;
  analysisYears: number | null;
}

export function middleExample(examples: readonly ExampleRow[] | null): ExampleRow | null {
  if (!examples || examples.length === 0) return null;
  return examples[Math.floor((examples.length - 1) / 2)] ?? null;
}

export function cityKeyNumbers(i: CityKeyNumbersInput): KeyNumbersBlock {
  const ex = middleExample(i.examples);
  const pb = ex?.result?.paybackYears;
  const max = i.analysisYears;
  const phrase = pb && max !== null && ex ? paybackPhrase({ bill: ex.bill, low: pb.low, likely: pb.likely, high: pb.high, analysisYears: max }) : null;

  const rate = i.utility ? rateKeyNumber(i.utility) : null;
  const production = productionKeyNumber(i.production);
  const cost = installedCostKeyNumber(i.costs);
  const inputDates = maxDate(rate?.checkedOn, production?.checkedOn, cost?.checkedOn);

  const payback: KeyNumber | null = phrase && ex
    ? {
        label: `Example payback, ${formatUsd(ex.bill)}/month bill (solar only)`,
        value: phrase,
        source: { label: 'How we calculate', url: '/methodology' },
        checkedOn: inputDates,
        note: 'An illustrative bill, not a city average; no federal tax credit.',
      }
    : null;

  const answer = phrase && ex && i.utilityShort
    ? pb?.likely === null
      ? `In ${i.city.name}, an example ${formatUsd(ex.bill)}/month home on ${i.utilityShort} rates takes ${phrase} to pay back solar, with no federal tax credit.`
      : `In ${i.city.name}, an example ${formatUsd(ex.bill)}/month home on ${i.utilityShort} rates pays back solar in about ${phrase}, with no federal tax credit.`
    : null;

  return finishBlock(answer, [
    payback,
    rate,
    i.utility ? exportKeyNumber(i.utility) : null,
    production,
    cost,
    federalCreditKeyNumber(),
    i.utility ? fixedChargeKeyNumber(i.utility) : null,
  ]);
}
