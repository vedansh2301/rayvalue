/**
 * Captions per channel (pure). Every figure goes through RefBook.use(), the same as on the slides.
 *
 * Both channels open on a keyword line: the phrase a homeowner would type into search ("FPL solar panel cost and
 * payback in 2026: ..."), naming the utility and/or state, "solar", "cost"/"payback" and 2026. Instagram and Facebook
 * use caption text as search keywords, and the first line is what shows before "more".
 *
 * Instagram: then short skimmable lines, the key ranges, the "estimates, not quotes" note, a "link in bio" CTA
 * (caption links are not clickable there), a save/share prompt and 3-5 relevant hashtags. Facebook: a conversational
 * post with the full clickable link (UTM-tagged), a question to drive comments and 2-3 hashtags.
 *
 * Rules: 1 (no number without a data_ref), 2 (the federal credit is only ever described as ended for 2026+ installs),
 * 3 (ranges with the likely case), 5 (no official / government wording).
 */
import type { Channel } from '../types';
import { joinRange, paybackPhrase, usePayback, utilityUrlText, type BillFacts, type ExampleFacts, type UtilityFacts } from './facts';
import { hashtagLine, hashtagsFor } from './hashtags';
import type { Fig, RefBook } from './refs';

/** The full, clickable address for a Facebook post, tagged so site analytics can tell which template sent the visit. */
export const facebookLink = (urlText: string, templateKey: string) =>
  `https://${urlText}?utm_source=facebook&utm_medium=social&utm_campaign=${encodeURIComponent(templateKey)}`;

const CREDIT_ENDED = 'the federal credit ended for 2026 installs';

/** The search-phrase first line for a utility post. "in Florida" is left out when the utility's name already says it. */
export const utilityKeywordLine = (f: Pick<UtilityFacts, 'short' | 'stateName'>) =>
  `${f.short} solar panel cost and payback in 2026: still worth it${f.short.includes(f.stateName) ? '' : ` in ${f.stateName}`} without the federal tax credit?`;

/** The search-phrase first line for a state post. */
export const stateKeywordLine = (stateName: string) => `${stateName} solar panel cost 2026: is it still worth it without the federal tax credit?`;

const andList = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''));

export interface BatteryNote {
  /** The "1" in "1 battery" (the example's battery input). */
  count: Fig;
  effect: 'longer' | 'shorter' | 'about the same';
}

/** Caption for a utility post (Reel or carousel). `battery` is set on the carousel, which has the battery slide. */
export function utilityCaption(book: RefBook, f: UtilityFacts, channel: Channel, templateKey: string, battery: BatteryNote | null = null): string {
  const c = f.solar.cost;
  const s = f.solar.savings;
  const bill = book.use(f.bill);
  const size = book.use(f.solar.size);
  const cost = joinRange(book.use(c.low), book.use(c.high));
  const costLikely = book.use(c.likely);
  const save = joinRange(book.use(s.low), book.use(s.high));
  const payback = paybackPhrase(f.solar.payback);
  const payLikely = usePayback(book, f.solar.payback);
  const date = f.dataDate ? ` (read ${book.use(f.dataDate)})` : '';
  const url = utilityUrlText(f);
  const tags = hashtagLine(hashtagsFor(channel, { state: f.state, utilitySlugs: [f.slug] }));

  if (channel === 'facebook') {
    return [
      utilityKeywordLine(f),
      `We ran the numbers for a typical ${f.short} home with a ${bill} monthly bill: ${size} of solar costs about ${cost} installed (likely ${costLikely}), takes ${save} off the bill in the first year, and pays for itself in ${payback} (${payLikely}).`,
      ...(battery
        ? [`Thinking about a battery too? In this example, adding ${book.use(battery.count)} battery makes payback ${battery.effect}, though many homeowners add one for backup power during outages.`]
        : []),
      `That’s the full price you pay back: ${CREDIT_ENDED}. These are estimates, not quotes, built from ${f.short}’s published rates${date}, and your roof, usage and installer’s price will move them.`,
      `Run your own numbers for free on ${f.short}’s rates:\n${facebookLink(url, templateKey)}`,
      'Would that payback make solar worth it for you, or are you waiting? Tell us in the comments.',
      tags,
    ].join('\n\n');
  }

  return [
    `${utilityKeywordLine(f)}\nReal ${f.short} numbers ☀️`,
    [`A typical ${f.short} home (${bill} monthly bill, ${size} system):`, `• Installed: ${cost} (likely ${costLikely})`, `• First-year savings: ${save}`, `• Payback: ${payback} (${payLikely})`].join('\n'),
    ...(battery ? [`Swipe for the battery question too: in this example, adding ${book.use(battery.count)} battery makes payback ${battery.effect}.`] : []),
    `That’s the full price you pay back: ${CREDIT_ENDED}.`,
    `Estimates, not quotes, built from ${f.short}’s published rates${date}. Your roof, usage and installer’s price will move them.`,
    `Run your own numbers (free) — link in bio · ${url}`,
    'Save this 📌 for when the quotes come in, and send it to someone pricing solar.',
    tags,
  ].join('\n\n');
}

export interface CreditGoneCaptionInput {
  state: 'FL' | 'CA';
  stateName: string;
  facts: readonly UtilityFacts[];
  /** "typical home with a $250 monthly bill" (already recorded) or "typical home for each utility". */
  billNote: string;
  /** Lowest installed-cost low and highest installed-cost high across the utilities. */
  costLow: Fig;
  costHigh: Fig;
  urlText: string;
}

export function creditGoneCaption(book: RefBook, x: CreditGoneCaptionInput, channel: Channel): string {
  const prices = joinRange(book.use(x.costLow), book.use(x.costHigh));
  const tags = hashtagLine(hashtagsFor(channel, { state: x.state, utilitySlugs: x.facts.map((u) => u.slug) }));

  if (channel === 'facebook') {
    const list = x.facts.map((u) => `${paybackPhrase(u.solar.payback)} with ${u.short} (${usePayback(book, u.solar.payback)})`);
    const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
    return [
      stateKeywordLine(x.stateName),
      `We ran the numbers on ${andList(x.facts.map((u) => u.short))} rates, for a ${x.billNote}. Solar alone pays for itself in ${joined}.`,
      `Installed prices run about ${prices} across these utilities, and that’s the full price you pay back: ${CREDIT_ENDED}.`,
      'These are estimates, not quotes. Your roof, bill and installer’s price will move them.',
      `See the numbers for your own home, free:\n${facebookLink(x.urlText, 'credit-gone-reel')}`,
      `Is solar still on your list in ${x.stateName}, or are you holding off? Tell us in the comments.`,
      tags,
    ].join('\n\n');
  }

  return [
    `${stateKeywordLine(x.stateName)}\nSolar payback with ${andList(x.facts.map((u) => u.short))}, in real numbers ☀️`,
    [`Solar-only payback for a ${x.billNote}:`, ...x.facts.map((u) => `• ${u.short}: ${paybackPhrase(u.solar.payback)} (${usePayback(book, u.solar.payback)})`)].join('\n'),
    `Installed prices run about ${prices} across these utilities. That’s the full price you pay back: ${CREDIT_ENDED}.`,
    'Estimates, not quotes, built from each utility’s published rates. Your roof, bill and installer’s price will move them.',
    `Run your own numbers (free) — link in bio · ${x.urlText}`,
    `Save this 📌 and share it with someone pricing solar in ${x.stateName}.`,
    tags,
  ].join('\n\n');
}

// ------------------------------------------------------------------ battery-worth-it-reel
/** Search-phrase first line for the battery post. */
export const batteryKeywordLine = (f: Pick<UtilityFacts, 'short'>) =>
  `${f.short} solar and battery payback in 2026: is a battery worth adding without the federal tax credit?`;

export function batteryCaption(book: RefBook, f: UtilityFacts & { battery: ExampleFacts }, count: Fig, effect: BatteryNote['effect'], channel: Channel, templateKey: string): string {
  const bill = book.use(f.bill);
  const n = book.use(count);
  const line = (e: ExampleFacts) => `${paybackPhrase(e.payback)} (${usePayback(book, e.payback)}), installed ${joinRange(book.use(e.cost.low), book.use(e.cost.high))}`;
  const solar = line(f.solar);
  const batt = line(f.battery);
  const date = f.dataDate ? ` (read ${book.use(f.dataDate)})` : '';
  const url = utilityUrlText(f);
  const tags = hashtagLine(hashtagsFor(channel, { state: f.state, utilitySlugs: [f.slug] }));
  const verdict = `In this example, adding ${n} battery makes payback ${effect}. Many homeowners add one for backup power during outages, so payback is not the only reason.`;

  if (channel === 'facebook') {
    return [
      batteryKeywordLine(f),
      `Is a battery worth adding to solar on ${f.short}’s rates? For a typical ${f.short} home with a ${bill} monthly bill, solar alone pays back in ${solar}. Solar plus ${n} battery: ${batt}.`,
      verdict,
      `That’s the full price you pay back: ${CREDIT_ENDED}. These are estimates, not quotes, built from ${f.short}’s published rates${date}, and your roof, usage and installer’s price will move them.`,
      `Compare solar with and without a battery for your own home, free:\n${facebookLink(url, templateKey)}`,
      'Would you add a battery for backup power, or skip it? Tell us in the comments.',
      tags,
    ].join('\n\n');
  }
  return [
    `${batteryKeywordLine(f)}\nReal ${f.short} numbers ☀️`,
    [`A typical ${f.short} home (${bill} monthly bill):`, `• Solar only: ${solar}`, `• Solar + ${n} battery: ${batt}`].join('\n'),
    verdict,
    `That’s the full price you pay back: ${CREDIT_ENDED}.`,
    `Estimates, not quotes, built from ${f.short}’s published rates${date}. Your roof, usage and installer’s price will move them.`,
    `Run your own numbers (free) — link in bio · ${url}`,
    'Save this 📌 for when the battery quote comes in, and send it to someone pricing solar.',
    tags,
  ].join('\n\n');
}

// ------------------------------------------------------------------ bill-size-reel
export const billKeywordLine = (f: Pick<UtilityFacts, 'short'>) => `${f.short} solar payback in 2026: does your monthly bill change it, without the federal tax credit?`;

export function billSizeCaption(book: RefBook, f: UtilityFacts, bills: readonly BillFacts[], effect: BatteryNote['effect'], channel: Channel, templateKey: string): string {
  const first = bills[0]!;
  const last = bills[bills.length - 1]!;
  const date = f.dataDate ? ` (read ${book.use(f.dataDate)})` : '';
  const url = utilityUrlText(f);
  const tags = hashtagLine(hashtagsFor(channel, { state: f.state, utilitySlugs: [f.slug] }));
  const rows = bills.map((b) => `${book.use(b.bill)} a month: ${paybackPhrase(b.solar.payback)} (${usePayback(book, b.solar.payback)}), ${book.use(b.solar.size)} system, installed ${joinRange(book.use(b.solar.cost.low), book.use(b.solar.cost.high))}`);
  const same = effect === 'about the same';
  const verdict = `In this example, the ${book.use(last.bill)} bill pays back ${same ? 'in about the same time as' : `${effect === 'longer' ? 'more slowly' : 'faster'} than`} the ${book.use(first.bill)} bill${same ? ': the system is sized to the bill, so payback barely moves' : ''}.`;

  if (channel === 'facebook') {
    return [
      billKeywordLine(f),
      `Does the size of your electric bill change how fast solar pays for itself? We ran ${f.short}’s rates at ${andList(bills.map((b) => book.use(b.bill)))} a month, solar only:`,
      rows.map((r) => `• ${r}`).join('\n'),
      verdict,
      `That’s the full price you pay back: ${CREDIT_ENDED}. These are estimates, not quotes, built from ${f.short}’s published rates${date}, and your roof and installer’s price will move them.`,
      `Try your own bill, free:\n${facebookLink(url, templateKey)}`,
      'What does your monthly bill look like? Tell us in the comments.',
      tags,
    ].join('\n\n');
  }
  return [
    `${billKeywordLine(f)}\nReal ${f.short} numbers ☀️`,
    [`Solar only on ${f.short}’s rates:`, ...rows.map((r) => `• ${r}`)].join('\n'),
    verdict,
    `That’s the full price you pay back: ${CREDIT_ENDED}.`,
    `Estimates, not quotes, built from ${f.short}’s published rates${date}. Your roof and installer’s price will move them.`,
    `Run your own numbers (free) — link in bio · ${url}`,
    'Save this 📌 and send it to someone with a big electric bill.',
    tags,
  ].join('\n\n');
}

// ------------------------------------------------------------------ fl-vs-ca-reel
export const flVsCaKeywordLine = () => 'Florida vs California solar panel cost and payback in 2026, without the federal tax credit';

export interface FlVsCaCaptionInput {
  fl: readonly UtilityFacts[];
  ca: readonly UtilityFacts[];
  billNote: string;
  urlText: string;
}

export function flVsCaCaption(book: RefBook, x: FlVsCaCaptionInput, channel: Channel): string {
  const state = (facts: readonly UtilityFacts[], name: string) =>
    [`${name}:`, ...facts.map((u) => `• ${u.short}: ${paybackPhrase(u.solar.payback)} (${usePayback(book, u.solar.payback)}), installed ${joinRange(book.use(u.solar.cost.low), book.use(u.solar.cost.high))}`)].join('\n');
  const tags = hashtagLine(hashtagsFor(channel, { state: 'FL', utilitySlugs: [], states: ['FL', 'CA'] }));
  const body = [state(x.fl, 'Florida'), state(x.ca, 'California')].join('\n\n');

  if (channel === 'facebook') {
    return [
      flVsCaKeywordLine(),
      `Which state pays solar back faster? We ran each utility’s published rates for a ${x.billNote}. Solar alone:`,
      body,
      `That’s the full price you pay back: ${CREDIT_ENDED}. These are estimates, not quotes. Your roof, bill and installer’s price will move them.`,
      `See the numbers for your own home, free:\n${facebookLink(x.urlText, 'fl-vs-ca-reel')}`,
      'Florida or California, which one surprised you? Tell us in the comments.',
      tags,
    ].join('\n\n');
  }
  return [
    `${flVsCaKeywordLine()}\nReal numbers, side by side ☀️`,
    body,
    `That’s the full price you pay back: ${CREDIT_ENDED}.`,
    'Estimates, not quotes, built from each utility’s published rates. Your roof, bill and installer’s price will move them.',
    `Run your own numbers (free) — link in bio · ${x.urlText}`,
    'Save this 📌 and send it to someone pricing solar in either state.',
    tags,
  ].join('\n\n');
}
