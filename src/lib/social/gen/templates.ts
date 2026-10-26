/**
 * Slide and caption builders for the three generator templates (pure, no I/O). Inputs are page view models loaded
 * through the same code the site uses; every figure goes through RefBook.use() so it lands in data_refs.
 *
 * Rules honoured here: 1 (no number without a data_ref), 2 (the federal credit is only ever described as ended for
 * 2026+ installs), 3 (low / likely / high ranges), 5 (no official / government wording).
 */
import { UTILITY_PAGES } from '../../utility/pages';
import type { UtilityPageVm } from '../../utility/view';
import { buildUtilityFacts, calculatorUrlText, joinRange, paybackBig, paybackPhrase, STATE_NAME, utilityUrlText, type ExampleFacts, type UtilityFacts } from './facts';
import { fig, RefBook } from './refs';
import type { GeneratedPost, Slide, Tile } from './types';

export const ESTIMATES_FOOTER = 'Estimates, not quotes · rayvalue.com';
export const REEL_DEFAULT_SECONDS = 4;

// ------------------------------------------------------------------ shared slide pieces
const footerFor = (book: RefBook, dataDate: UtilityFacts['dataDate'], label = 'Rates read'): string[] => [ESTIMATES_FOOTER, ...(dataDate ? [`${label} ${book.use(dataDate)}`] : [])];

/** Low / likely / high tiles. Collapses to nothing when the three round to the same figure. */
function tiles(book: RefBook, r: ExampleFacts['cost'], labels: [string, string, string] = ['Low', 'Likely', 'High']): Tile[] | undefined {
  if (r.low.text === r.likely.text && r.likely.text === r.high.text) return undefined;
  return [
    { label: labels[0], value: book.use(r.low) },
    { label: labels[1], value: book.use(r.likely), emphasis: true },
    { label: labels[2], value: book.use(r.high) },
  ];
}

/** Records all three payback figures; returns the likely one as "likely 15.5 yrs". */
function usePayback(book: RefBook, p: ExampleFacts['payback']): string {
  book.use(p.low);
  book.use(p.high);
  return `likely ${book.use(p.likely)}`;
}

const homeLine = (book: RefBook, f: UtilityFacts) =>
  `${book.use(f.solar.size)} system · ${book.use(f.bill)} monthly bill${f.cityName ? ` · ${f.cityName} area` : ''}`;

function costSlide(book: RefBook, f: UtilityFacts, seconds?: number): Slide {
  const c = f.solar.cost;
  const t = tiles(book, c);
  book.use(c.low);
  book.use(c.high);
  return {
    id: 'cost',
    theme: 'light',
    kicker: 'Installed cost',
    title: `A typical ${f.short} home`,
    subtitle: homeLine(book, f),
    big: joinRange(c.low.text, c.high.text),
    bigLabel: 'Installed cost, no federal tax credit',
    tiles: t,
    footer: footerFor(book, f.dataDate),
    seconds,
  };
}

function savingsSlide(book: RefBook, f: UtilityFacts, seconds?: number): Slide {
  const s = f.solar.savings;
  const t = tiles(book, s);
  book.use(s.low);
  book.use(s.high);
  const same = !t;
  return {
    id: 'savings',
    theme: 'light',
    kicker: 'First-year savings',
    title: 'What it takes off your bill',
    subtitle: `Solar only, first year, ${f.short} rates`,
    big: joinRange(s.low.text, s.high.text),
    bigLabel: same ? 'Low, likely and high cases round to the same figure' : 'Bill savings in the first year',
    tiles: t,
    footer: footerFor(book, f.dataDate),
    seconds,
  };
}

function paybackSlide(book: RefBook, f: UtilityFacts, seconds?: number): Slide {
  const p = f.solar.payback;
  usePayback(book, p);
  return {
    id: 'payback',
    theme: 'light',
    kicker: 'Payback',
    title: 'How long to earn it back',
    subtitle: `Solar only, ${f.short} rates, no federal tax credit`,
    big: paybackBig(p),
    tiles: [
      { label: 'Best case', value: p.low.text },
      { label: 'Likely', value: p.likely.text, emphasis: true },
      { label: 'Worst case', value: p.high.text },
    ],
    lines: ['Best case: low installed price, high rate increases. Worst case: the reverse.'],
    footer: footerFor(book, f.dataDate),
    seconds,
  };
}

function changedSlide(short: string, seconds?: number): Slide {
  return {
    id: 'changed',
    theme: 'dark',
    kicker: 'What changed',
    title: 'The federal solar tax credit ended for 2026 installs',
    lines: ['So you pay back the full installed price.', `Payback now depends on ${short}’s rates, your usage and your installer’s price.`],
    seconds,
  };
}

function ctaSlide(book: RefBook, url: string, dataDate: UtilityFacts['dataDate'], footerLabel: string, seconds?: number): Slide {
  return {
    id: 'cta',
    theme: 'sun',
    kicker: 'Your home is different',
    title: 'Run your own numbers',
    subtitle: 'Free calculator on your utility’s rates. Link in bio.',
    url,
    footer: footerFor(book, dataDate, footerLabel),
    seconds,
  };
}

// ------------------------------------------------------------------ captions
const hashtagWord = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function utilityHashtags(f: UtilityFacts): string {
  const state = f.state === 'FL' ? 'floridasolar' : 'californiasolar';
  return [...new Set(['solar', 'solarpower', state, 'solarpayback', 'homeenergy', hashtagWord(f.short)])].map((t) => `#${t}`).join(' ');
}

/** The sentence that carries the payback figures; shared by the Reel and the carousel captions. */
function utilityCaption(book: RefBook, f: UtilityFacts): string {
  const c = f.solar.cost;
  const p = f.solar.payback;
  const date = f.dataDate ? ` (read ${book.use(f.dataDate)})` : '';
  const body = [
    `Is solar worth it with ${f.short} in 2026?`,
    `For a typical home with a ${book.use(f.bill)} monthly bill, a ${book.use(f.solar.size)} solar system costs about ${joinRange(book.use(c.low), book.use(c.high))} installed (likely ${book.use(c.likely)}) and pays for itself in ${paybackPhrase(p)} (${usePayback(book, p)}).`,
    `The federal solar tax credit ended for 2026 installs, so that is the full price you pay back. These are estimates, not quotes, built from ${f.short}’s published rates${date}.`,
    `Run your own numbers: link in bio, or ${utilityUrlText(f)}`,
    utilityHashtags(f),
  ];
  return body.join('\n\n');
}

// ------------------------------------------------------------------ describe (alt text)
export function describeSlide(s: Slide): string {
  const parts = [s.kicker, s.title, s.subtitle, s.big, s.bigLabel];
  if (s.tiles) parts.push(s.tiles.map((t) => `${t.label} ${t.value}`).join(', '));
  if (s.rows) parts.push(s.rows.map((r) => `${r.label} ${r.value}${r.hint ? ` (${r.hint.replace(/\n/g, ', ')})` : ''}`).join('; '));
  parts.push(...(s.lines ?? []), ...(s.bullets ?? []), s.url);
  return parts.filter((x): x is string => !!x).map((x) => x.replace(/[.:]$/, '')).join('. ') + '.';
}

export function truncateAlt(text: string, max = 1000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** Every string a reader sees on a slide, for tests and the data_refs completeness check. */
export function slideTexts(s: Slide): string[] {
  return [
    s.kicker,
    s.title,
    s.subtitle,
    s.big,
    s.bigLabel,
    ...(s.tiles ?? []).flatMap((t) => [t.label, t.value]),
    ...(s.rows ?? []).flatMap((r) => [r.label, r.value, r.hint]),
    ...(s.lines ?? []),
    ...(s.bullets ?? []),
    s.url,
    ...(s.footer ?? []),
  ].filter((x): x is string => !!x);
}

function finish(templateKey: string, target: string, type: GeneratedPost['type'], title: string, caption: string, slides: Slide[], book: RefBook): GeneratedPost {
  const altText = type === 'reel' ? truncateAlt(`Video with ${slides.length} slides. ${slides.map(describeSlide).join(' ')}`) : truncateAlt(slides.map(describeSlide).join(' '));
  return { templateKey, target, type, title: title.slice(0, 120), caption, dataRefs: book.refs, slides, altText };
}

// ------------------------------------------------------------------ utility-payback-reel
export function buildUtilityPaybackReel(vm: UtilityPageVm): GeneratedPost {
  const f = buildUtilityFacts(vm);
  if (!f) throw new Error(`${vm.meta.slug}: no worked example with a result; nothing honest to post`);
  const book = new RefBook();
  const slides: Slide[] = [
    { id: 'hook', theme: 'sun', kicker: `${f.stateName} solar · 2026`, title: `Is solar worth it with ${f.short}?`, subtitle: 'Payback with no federal tax credit.', seconds: 3 },
    costSlide(book, f),
    savingsSlide(book, f),
    paybackSlide(book, f, 4.5),
    changedSlide(f.short),
    ctaSlide(book, utilityUrlText(f), f.dataDate, 'Rates read'),
  ];
  const caption = utilityCaption(book, f);
  return finish('utility-payback-reel', f.slug, 'reel', `${f.short} solar payback with no federal credit`, caption, slides, book);
}

// ------------------------------------------------------------------ utility-payback-carousel
/** "longer" / "shorter" / "about the same": how the battery moves the likely payback in this example. */
export function batteryEffect(solar: ExampleFacts, battery: ExampleFacts): 'longer' | 'shorter' | 'about the same' {
  const a = solar.paybackLikelyYears ?? Infinity;
  const b = battery.paybackLikelyYears ?? Infinity;
  return b > a ? 'longer' : b < a ? 'shorter' : 'about the same';
}

function batteryRow(book: RefBook, e: ExampleFacts) {
  const likely = usePayback(book, e.payback);
  return { label: e.label, value: paybackBig(e.payback), hint: `${likely}\ninstalled ${joinRange(book.use(e.cost.low), book.use(e.cost.high))}` };
}

export function buildUtilityPaybackCarousel(vm: UtilityPageVm): GeneratedPost {
  const f = buildUtilityFacts(vm);
  if (!f) throw new Error(`${vm.meta.slug}: no worked example with a result; nothing honest to post`);
  const book = new RefBook();
  const slides: Slide[] = [
    { id: 'cover', theme: 'sun', kicker: `${f.stateName} solar · 2026`, title: `Solar with ${f.short}: how long to pay back?`, subtitle: 'Swipe for the numbers. No federal tax credit.' },
    costSlide(book, f),
    savingsSlide(book, f),
    paybackSlide(book, f),
  ];
  if (f.battery) {
    book.use(fig('calc_example', f.utilityId, 'battery_count', '1')); // the "1" in "solar + 1 battery" is the example's battery input
    slides.push({
      id: 'battery',
      theme: 'light',
      kicker: 'What about a battery?',
      title: 'Solar only vs solar + 1 battery',
      subtitle: `Same ${book.use(f.bill)} monthly bill, ${f.short} rates`,
      rows: [batteryRow(book, f.solar), batteryRow(book, f.battery)],
      lines: [`In this example a battery makes payback ${batteryEffect(f.solar, f.battery)}. Many homeowners add one for backup power during outages.`],
      footer: footerFor(book, f.dataDate),
    });
  }
  slides.push(changedSlide(f.short), ctaSlide(book, utilityUrlText(f), f.dataDate, 'Rates read'));
  const caption = utilityCaption(book, f);
  return finish('utility-payback-carousel', f.slug, 'carousel', `${f.short} solar payback, slide by slide`, caption, slides, book);
}

// ------------------------------------------------------------------ credit-gone-reel
const stateHashtags = (state: 'FL' | 'CA') => ['solar', 'solarpower', state === 'FL' ? 'floridasolar' : 'californiasolar', 'solarpayback', 'homeenergy'].map((t) => `#${t}`).join(' ');

/** vms: the state's utility pages (as loaded for the site). Utilities without a worked example are skipped; at least two are needed. */
export function buildCreditGoneReel(state: 'FL' | 'CA', vms: readonly UtilityPageVm[]): GeneratedPost {
  const facts = vms.filter((v) => v.meta.state === state).map(buildUtilityFacts).filter((x): x is UtilityFacts => x !== null);
  if (facts.length < 2) throw new Error(`${state}: only ${facts.length} utilities have a worked example; need at least 2 to compare`);
  const stateName = STATE_NAME[state];
  const book = new RefBook();
  const oldest = facts.filter((x) => x.dataDate && x.verifiedOn).sort((a, b) => a.verifiedOn!.localeCompare(b.verifiedOn!))[0]?.dataDate ?? null;
  const sameBill = facts.every((x) => x.bill.text === facts[0]!.bill.text);
  const billNote = sameBill ? `typical home with a ${book.use(facts[0]!.bill)} monthly bill` : 'typical home for each utility';

  const paybackRows = facts.map((x) => {
    const likely = usePayback(book, x.solar.payback);
    return { label: x.short, value: paybackBig(x.solar.payback), hint: `${likely}${sameBill ? '' : ` · ${book.use(x.bill)} a month`}` };
  });
  const costRows = facts.map((x) => {
    const c = x.solar.cost;
    return { label: x.short, value: joinRange(book.use(c.low), book.use(c.high)), hint: `likely ${book.use(c.likely)} · ${book.use(x.solar.size)} system` };
  });

  const slides: Slide[] = [
    { id: 'hook', theme: 'sun', kicker: `${stateName} solar · 2026`, title: 'The federal solar tax credit is gone.', subtitle: `Does solar still pay back in ${stateName}?`, seconds: 3.5 },
    {
      id: 'changed',
      theme: 'dark',
      kicker: 'What changed',
      title: 'The federal credit ended for 2026 installs',
      lines: ['The full installed price is yours to pay back.', `Here is how that looks on the rates of the ${stateName} utilities we cover.`],
      seconds: 4.5,
    },
    {
      id: 'payback',
      theme: 'light',
      kicker: 'Payback, solar only',
      title: 'How long to earn it back',
      subtitle: `A ${billNote}`,
      rows: paybackRows,
      footer: footerFor(book, oldest, 'Oldest rate data read'),
      seconds: 5,
    },
    {
      id: 'cost',
      theme: 'light',
      kicker: 'Installed cost',
      title: 'What that system costs',
      subtitle: 'Sized for the same bill, before any incentive',
      rows: costRows,
      footer: footerFor(book, oldest, 'Oldest rate data read'),
      seconds: 5,
    },
    {
      id: 'moves',
      theme: 'light',
      kicker: 'Your number will differ',
      title: 'What moves your payback',
      bullets: ['Your bill and how much power you use', 'Shade and roof direction', 'Your installer’s price', 'Changes to your utility’s rates'],
      seconds: 4,
    },
    ctaSlide(book, calculatorUrlText(state), oldest, 'Oldest rate data read'),
  ];

  const caption = [
    `${stateName} solar without the federal tax credit: does it still pay back?`,
    `The federal solar tax credit ended for 2026 installs. For a ${billNote}, solar-only payback runs ${facts
      .map((x) => `${x.short} ${paybackPhrase(x.solar.payback)} (${usePayback(book, x.solar.payback)})`)
      .join(', ')}.`,
    'These are estimates, not quotes, built from each utility’s published rates. Your roof, bill and installer’s price will move them.',
    `Run your own numbers: link in bio, or ${calculatorUrlText(state)}`,
    stateHashtags(state),
  ].join('\n\n');

  return finish('credit-gone-reel', state.toLowerCase(), 'reel', `${stateName} solar without the federal credit`, caption, slides, book);
}

export const utilitySlugsForState = (state: 'FL' | 'CA') => UTILITY_PAGES.filter((p) => p.state === state).map((p) => p.slug);
