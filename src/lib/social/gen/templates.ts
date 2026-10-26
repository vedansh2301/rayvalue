/**
 * Slide builders for the three generator templates (pure, no I/O). Inputs are page view models loaded through the same
 * code the site uses; every figure goes through RefBook.use() so it lands in data_refs, on slides, in the Reel
 * voice-over and in the caption alike. Captions per channel live in captions.ts, hashtags in hashtags.ts and the photo
 * behind each slide is picked in slide-photos.ts.
 *
 * Rules honoured here: 1 (no number without a data_ref), 2 (the federal credit is only ever described as ended for
 * 2026+ installs), 3 (low / likely / high ranges), 5 (no official / government wording).
 */
import { UTILITY_PAGES } from '../../utility/pages';
import type { UtilityPageVm } from '../../utility/view';
import type { Channel } from '../types';
import { creditGoneCaption, utilityCaption } from './captions';
import {
  bare,
  buildUtilityFacts,
  calculatorUrlText,
  figAmount,
  joinRange,
  paybackBig,
  paybackPhrase,
  STATE_NAME,
  usePayback,
  utilityUrlText,
  voiceRange,
  type ExampleFacts,
  type RangeFigs,
  type UtilityFacts,
} from './facts';
import { PHOTOS } from './photos';
import { fig, RefBook, type Fig } from './refs';
import { assignPhotos, type PhotoRole } from './slide-photos';
import type { GeneratedPost, MusicMood, Slide, Tile } from './types';

export const ESTIMATES_FOOTER = 'Estimates, not quotes · rayvalue.com';
export const REEL_DEFAULT_SECONDS = 4;

export interface BuildOptions {
  /** The channel the caption is written for. Slides are the same on every channel. */
  channel: Channel;
}

// ------------------------------------------------------------------ voice-over timing
/**
 * Rough time a voice line needs on screen: about 2.7 spoken words a second plus a beat. A dollar figure is spoken as
 * ~4 words ("twelve thousand three hundred dollars"), a decimal as ~3. The renderer stretches the slide to the real
 * clip; this keeps the planned Reel length honest.
 */
export function voiceSeconds(voice: string, min = REEL_DEFAULT_SECONDS): number {
  const words = voice
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .reduce((n, w) => n + (/\$\d/.test(w) ? 4 : /\d\.\d/.test(w) ? 3 : 1), 0);
  return Math.max(min, Math.round((words / 2.7 + 0.6) * 2) / 2);
}

/** A Reel slide with its voice-over line and a hold time that fits it. */
const voiced = (slide: Slide, voice: string, min = REEL_DEFAULT_SECONDS): Slide => ({ ...slide, voice, seconds: voiceSeconds(voice, min) });

/** "8.5 kW" -> "8.5 kilowatts" (spoken). The number is the same text as on screen. */
const spokenKw = (text: string) => text.replace(/ kW$/, ' kilowatts');

/** Spoken payback range without the unit: "13 to 19", "18 to more than 25", "9". */
const spokenYears = (p: RangeFigs) => {
  const lo = bare(p.low);
  const hi = bare(p.high);
  return lo === hi ? lo : `${lo} to ${hi}`;
};

// ------------------------------------------------------------------ shared slide pieces
const footerFor = (book: RefBook, dataDate: UtilityFacts['dataDate'], label = 'Rates read'): string[] => [ESTIMATES_FOOTER, ...(dataDate ? [`${label} ${book.use(dataDate)}`] : [])];

/** "FPL · Florida · 2026"; "Duke Energy Florida · 2026" (no repeated state). */
const utilityKicker = (f: UtilityFacts) => (f.short.includes(f.stateName) ? `${f.short} · 2026` : `${f.short} · ${f.stateName} · 2026`);

/** Low / likely / high tiles. Collapses to nothing when the three round to the same figure. */
function tiles(book: RefBook, r: ExampleFacts['cost'], labels: [string, string, string] = ['Low', 'Likely', 'High']): Tile[] | undefined {
  if (r.low.text === r.likely.text && r.likely.text === r.high.text) return undefined;
  return [
    { label: labels[0], value: book.use(r.low) },
    { label: labels[1], value: book.use(r.likely), emphasis: true },
    { label: labels[2], value: book.use(r.high) },
  ];
}

const homeLine = (book: RefBook, f: UtilityFacts) =>
  `${book.use(f.solar.size)} system · ${book.use(f.bill)} monthly bill${f.cityName ? ` · ${f.cityName} area` : ''}`;

function costSlide(book: RefBook, f: UtilityFacts): Slide {
  const c = f.solar.cost;
  const t = tiles(book, c);
  book.use(c.low);
  book.use(c.high);
  return {
    id: 'cost',
    theme: 'light',
    kicker: 'The price',
    title: `What a typical ${f.short} home pays`,
    subtitle: homeLine(book, f),
    big: joinRange(c.low.text, c.high.text),
    bigLabel: 'Installed cost, no federal tax credit',
    tiles: t,
    footer: footerFor(book, f.dataDate),
  };
}

function savingsSlide(book: RefBook, f: UtilityFacts): Slide {
  const s = f.solar.savings;
  const t = tiles(book, s);
  book.use(s.low);
  book.use(s.high);
  return {
    id: 'savings',
    theme: 'light',
    kicker: 'The payoff',
    title: 'What it cuts from the bill',
    subtitle: `Solar only, first year, ${f.short} rates`,
    big: joinRange(s.low.text, s.high.text),
    bigLabel: t ? 'Bill savings in the first year' : 'Low, likely and high cases round to the same figure',
    tiles: t,
    footer: footerFor(book, f.dataDate),
  };
}

function paybackSlide(book: RefBook, f: UtilityFacts): Slide {
  const p = f.solar.payback;
  usePayback(book, p);
  return {
    id: 'payback',
    theme: 'light',
    kicker: 'The answer',
    title: 'How long until it pays for itself',
    subtitle: `Solar only, ${f.short} rates, no federal tax credit`,
    big: paybackBig(p),
    tiles: [
      { label: 'Best case', value: p.low.text },
      { label: 'Likely', value: p.likely.text, emphasis: true },
      { label: 'Worst case', value: p.high.text },
    ],
    lines: ['Best case: low installed price, high rate increases. Worst case: the reverse.'],
    footer: footerFor(book, f.dataDate),
  };
}

function changedSlide(short: string): Slide {
  return {
    id: 'changed',
    theme: 'dark',
    kicker: 'Why it matters',
    title: 'The federal solar tax credit ended for 2026 installs',
    lines: ['So you pay back the full installed price.', `Payback now depends on ${short}’s rates, your usage and your installer’s price.`],
  };
}

function ctaSlide(book: RefBook, url: string, subtitle: string, dataDate: UtilityFacts['dataDate'], footerLabel: string): Slide {
  return {
    id: 'cta',
    theme: 'sun',
    kicker: 'Your home is different',
    title: 'Run your own numbers',
    subtitle,
    url,
    footer: footerFor(book, dataDate, footerLabel),
  };
}

/** Spoken payback line: "So it pays for itself in 13 to 19 years, most likely 15." */
function paybackVoice(book: RefBook, p: RangeFigs): string {
  usePayback(book, p);
  const range = paybackPhrase(p);
  const likely = bare(p.likely);
  return p.low.text === p.high.text ? `So it pays for itself in about ${range}.` : `So it pays for itself in ${range}, most likely ${likely}.`;
}

const CTA_VOICE = (url: string) => `Every home is different. Run your own numbers free at ${url}.`;

// ------------------------------------------------------------------ describe (alt text)
/** Plain-text description of a slide; with `withPhoto`, opens with what the background photo shows. */
export function describeSlide(s: Slide, withPhoto = true): string {
  const parts = [s.kicker, s.title, s.subtitle, s.big, s.bigLabel];
  if (s.tiles) parts.push(s.tiles.map((t) => `${t.label} ${t.value}`).join(', '));
  if (s.rows) parts.push(s.rows.map((r) => `${r.label} ${r.value}${r.hint ? ` (${r.hint.replace(/\n/g, ', ')})` : ''}`).join('; '));
  parts.push(...(s.lines ?? []), ...(s.bullets ?? []), s.url);
  const text = parts.filter((x): x is string => !!x).map((x) => x.replace(/[.:?]$/, '')).join('. ') + '.';
  return withPhoto && s.photo ? `${PHOTOS[s.photo].alt}. ${text}` : text;
}

export function truncateAlt(text: string, max = 1000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** Every string a reader sees (or hears) on a slide, for tests and the data_refs completeness check. */
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
    s.voice,
  ].filter((x): x is string => !!x);
}

/** Puts a photo behind every slide (slide id = photo role; a carousel cover is its hook). */
function withPhotos(state: 'FL' | 'CA', seed: string, slides: Slide[]): Slide[] {
  const roles = slides.map((s) => (s.id === 'cover' ? 'hook' : s.id) as PhotoRole);
  const photos = assignPhotos(state, seed, roles);
  return slides.map((s, i) => ({ ...s, photo: photos[i] }));
}

interface FinishInput {
  templateKey: string;
  target: string;
  type: GeneratedPost['type'];
  channel: Channel;
  music: MusicMood | null;
  title: string;
  caption: string;
  slides: Slide[];
  book: RefBook;
}

function finish(p: FinishInput): GeneratedPost {
  const { slides } = p;
  const photoAlts = [...new Set(slides.flatMap((s) => (s.photo ? [PHOTOS[s.photo].alt] : [])))];
  const altText =
    p.type === 'reel'
      ? truncateAlt(`Video with ${slides.length} slides over photos: ${photoAlts.join('; ')}. ${slides.map((s) => describeSlide(s, false)).join(' ')}`)
      : truncateAlt(slides.map((s) => describeSlide(s)).join(' '));
  return {
    templateKey: p.templateKey,
    target: p.target,
    type: p.type,
    channel: p.channel,
    music: p.type === 'reel' ? p.music : null,
    title: p.title.slice(0, 120),
    caption: p.caption,
    dataRefs: p.book.refs,
    slides,
    altText,
  };
}

function factsOrThrow(vm: UtilityPageVm): UtilityFacts {
  const f = buildUtilityFacts(vm);
  if (!f) throw new Error(`${vm.meta.slug}: no worked example with a result; nothing honest to post`);
  return f;
}

// ------------------------------------------------------------------ utility-payback-reel
/** Music: upbeat. A short, practical "here are your numbers" Reel. */
export function buildUtilityPaybackReel(vm: UtilityPageVm, opts: BuildOptions): GeneratedPost {
  const key = 'utility-payback-reel';
  const f = factsOrThrow(vm);
  const book = new RefBook();
  const c = f.solar.cost;
  const s = f.solar.savings;
  const url = utilityUrlText(f);
  const slides = withPhotos(f.state, `${key}/${f.slug}`, [
    voiced(
      { id: 'hook', theme: 'sun', kicker: utilityKicker(f), title: 'No federal tax credit. Does solar still pay off?', subtitle: `The real numbers for a typical ${f.short} home.` },
      `Thinking about solar with ${f.short}? The federal tax credit is gone — here’s what it really costs now.`,
      3,
    ),
    voiced(costSlide(book, f), `A typical ${f.short} home needs about ${spokenKw(book.use(f.solar.size))} of solar: ${voiceRange(book, c.low, c.high)} installed.`),
    voiced(savingsSlide(book, f), `In year one, that takes about ${voiceRange(book, s.low, s.high)} off the bill.`),
    voiced(paybackSlide(book, f), paybackVoice(book, f.solar.payback)),
    voiced(changedSlide(f.short), 'The federal tax credit ended for 2026 installs, so that’s the full price you pay back.'),
    voiced(ctaSlide(book, url, `Free, on ${f.short}’s rates. Your bill, your roof.`, f.dataDate, 'Rates read'), CTA_VOICE(url)),
  ]);
  const caption = utilityCaption(book, f, opts.channel, key);
  return finish({ templateKey: key, target: f.slug, type: 'reel', channel: opts.channel, music: 'upbeat', title: `${f.short} solar payback with no federal credit`, caption, slides, book });
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

export function buildUtilityPaybackCarousel(vm: UtilityPageVm, opts: BuildOptions): GeneratedPost {
  const key = 'utility-payback-carousel';
  const f = factsOrThrow(vm);
  const book = new RefBook();
  const slides: Slide[] = [
    { id: 'cover', theme: 'sun', kicker: utilityKicker(f), title: `How long does solar take to pay off with ${f.short} now?`, subtitle: 'The federal credit is gone. Swipe for the real ranges.' },
    costSlide(book, f),
    savingsSlide(book, f),
    paybackSlide(book, f),
  ];
  // The "1" in "solar + 1 battery" is the example's battery input.
  const batteryCount: Fig = fig('calc_example', f.utilityId, 'battery_count', '1');
  if (f.battery) {
    book.use(batteryCount);
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
  slides.push(changedSlide(f.short), ctaSlide(book, utilityUrlText(f), `Free, on ${f.short}’s rates. Your bill, your roof.`, f.dataDate, 'Rates read'));
  const caption = utilityCaption(book, f, opts.channel, key, f.battery ? { count: batteryCount, effect: batteryEffect(f.solar, f.battery) } : null);
  return finish({
    templateKey: key,
    target: f.slug,
    type: 'carousel',
    channel: opts.channel,
    music: null,
    title: `${f.short} solar payback, slide by slide`,
    caption,
    slides: withPhotos(f.state, `${key}/${f.slug}`, slides),
    book,
  });
}

// ------------------------------------------------------------------ credit-gone-reel
/**
 * Music: calm. An explainer about a policy change across a whole state reads better unhurried than hyped.
 * vms: the state's utility pages (as loaded for the site). Utilities without a worked example are skipped; at least
 * two are needed.
 */
export function buildCreditGoneReel(state: 'FL' | 'CA', vms: readonly UtilityPageVm[], opts: BuildOptions): GeneratedPost {
  const key = 'credit-gone-reel';
  const facts = vms.filter((v) => v.meta.state === state).map(buildUtilityFacts).filter((x): x is UtilityFacts => x !== null);
  if (facts.length < 2) throw new Error(`${state}: only ${facts.length} utilities have a worked example; need at least 2 to compare`);
  const stateName = STATE_NAME[state];
  const book = new RefBook();
  const oldest = facts.filter((x) => x.dataDate && x.verifiedOn).sort((a, b) => a.verifiedOn!.localeCompare(b.verifiedOn!))[0]?.dataDate ?? null;
  const sameBill = facts.every((x) => x.bill.text === facts[0]!.bill.text);
  const billNote = sameBill ? `typical home with a ${book.use(facts[0]!.bill)} monthly bill` : 'typical home for each utility';
  // Lowest and highest installed price across the utilities (each is one utility's own figure).
  const costLow = facts.map((x) => x.solar.cost.low).reduce((a, b) => (figAmount(b) < figAmount(a) ? b : a));
  const costHigh = facts.map((x) => x.solar.cost.high).reduce((a, b) => (figAmount(b) > figAmount(a) ? b : a));

  const paybackRows = facts.map((x) => {
    const likely = usePayback(book, x.solar.payback);
    return { label: x.short, value: paybackBig(x.solar.payback), hint: `${likely}${sameBill ? '' : ` · ${book.use(x.bill)} a month`}` };
  });
  const costRows = facts.map((x) => {
    const c = x.solar.cost;
    return { label: x.short, value: joinRange(book.use(c.low), book.use(c.high)), hint: `likely ${book.use(c.likely)} · ${book.use(x.solar.size)} system` };
  });
  const spokenPaybacks = facts.map((x, i) => `${x.short}, ${i === 0 ? paybackPhrase(x.solar.payback) : spokenYears(x.solar.payback)}`);
  const paybackList = spokenPaybacks.length > 1 ? `${spokenPaybacks.slice(0, -1).join('; ')}; and ${spokenPaybacks[spokenPaybacks.length - 1]}` : spokenPaybacks[0];
  const url = calculatorUrlText(state);

  const slides = withPhotos(state, `${key}/${state.toLowerCase()}`, [
    voiced(
      { id: 'hook', theme: 'sun', kicker: `${stateName} solar · 2026`, title: 'The federal solar tax credit is gone.', subtitle: `So does solar still pay off in ${stateName}?` },
      `Thinking about solar in ${stateName}? The federal tax credit is gone — here’s what it really costs now.`,
      3,
    ),
    voiced(
      {
        id: 'changed',
        theme: 'dark',
        kicker: 'What changed',
        title: 'The federal credit ended for 2026 installs',
        lines: ['The full installed price is yours to pay back.', `Here is how that looks on the rates of the ${stateName} utilities we cover.`],
      },
      'It ended for 2026 installs, so you now pay back the full installed price yourself.',
    ),
    voiced(
      {
        id: 'payback',
        theme: 'light',
        kicker: 'Payback, solar only',
        title: 'How long until it pays for itself',
        subtitle: `A ${billNote}`,
        rows: paybackRows,
        footer: footerFor(book, oldest, 'Oldest rate data read'),
      },
      `Payback on solar alone: ${paybackList}.`,
    ),
    voiced(
      {
        id: 'cost',
        theme: 'light',
        kicker: 'Installed cost',
        title: 'What that system costs',
        subtitle: sameBill ? 'Sized for the same bill, at full price' : 'Sized for each home, at full price',
        rows: costRows,
        footer: footerFor(book, oldest, 'Oldest rate data read'),
      },
      `${sameBill ? 'A system for that bill' : 'A system for each home'} runs about ${voiceRange(book, costLow, costHigh)} installed, depending on the utility.`,
    ),
    voiced(
      {
        id: 'moves',
        theme: 'light',
        kicker: 'Your number will differ',
        title: 'What moves your payback',
        bullets: ['Your bill and how much power you use', 'Shade and roof direction', 'Your installer’s price', 'Changes to your utility’s rates'],
      },
      'Your number will differ: your bill, shade, roof direction and installer’s price all move it.',
    ),
    voiced(ctaSlide(book, url, 'Free calculator on your utility’s rates.', oldest, 'Oldest rate data read'), CTA_VOICE(url)),
  ]);

  const caption = creditGoneCaption(book, { state, stateName, facts, billNote, costLow, costHigh, urlText: url }, opts.channel);
  return finish({ templateKey: key, target: state.toLowerCase(), type: 'reel', channel: opts.channel, music: 'calm', title: `${stateName} solar without the federal credit`, caption, slides, book });
}

export const utilitySlugsForState = (state: 'FL' | 'CA') => UTILITY_PAGES.filter((p) => p.state === state).map((p) => p.slug);
