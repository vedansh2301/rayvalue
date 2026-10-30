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
import { batteryCaption, billSizeCaption, creditGoneCaption, flVsCaCaption, utilityCaption } from './captions';
import {
  bare,
  buildBillFacts,
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
import type { PhotoKey } from './photos';
import type { GeneratedPost, MusicMood, Slide, Tile } from './types';

export const ESTIMATES_FOOTER = 'Estimates, not quotes · rayvalue.com';
/** Planned hold for a Reel slide without a voice line. */
export const REEL_DEFAULT_SECONDS = 4;
/**
 * Minimum hold per Reel slide kind. The voice drives the pace (the renderer stretches a slide to its clip); these only
 * keep a figure slide up long enough to read its tiles, and the hook short so the first answer comes fast.
 */
export const REEL_MIN_SECONDS = { hook: 2.5, figure: 5, cta: 4 } as const;

export interface BuildOptions {
  /** The channel the caption is written for. Slides are the same on every channel. */
  channel: Channel;
}

// ------------------------------------------------------------------ voice-over timing
/**
 * Rough time a voice line needs on screen: about 3 spoken words a second (Kokoro at TTS_SPEED) plus ~1.2 s for the
 * lead-in, the tail and the cross-fade. A dollar figure is spoken as ~4 words ("twelve thousand three hundred
 * dollars"), a decimal as ~3, a year as 2. The renderer stretches the slide to the real clip; this keeps the planned
 * Reel length honest.
 */
export function voiceSeconds(voice: string, min = REEL_DEFAULT_SECONDS): number {
  const words = voice
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .reduce((n, w) => n + (/\$\d/.test(w) ? 4 : /\d\.\d/.test(w) ? 3 : /^(19|20)\d\d\b/.test(w) ? 2 : 1), 0);
  return Math.max(min, Math.ceil((words / 3 + 1.2) * 2) / 2);
}

/** A Reel slide with its voice-over line and a hold time that fits it. */
const voiced = (slide: Slide, voice: string, kind: keyof typeof REEL_MIN_SECONDS): Slide => ({ ...slide, voice, seconds: voiceSeconds(voice, REEL_MIN_SECONDS[kind]) });

/** Words in a voice line (what the "≤ ~12 words" guideline counts). */
export const voiceWords = (voice: string) => voice.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Payback years a figure stands for ("13 yrs" -> 13; "more than 25 yrs" -> Infinity), for picking ends across utilities. */
const paybackYears = (f: Fig) => (/^more than/.test(f.text) ? Infinity : figAmount(f));

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

/** On every post: the federal credit is named only as ended (rule 2). */
const CREDIT_ENDED_LINE = 'The federal tax credit ended for 2026 installs, so this is the full price.';

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
    lines: [CREDIT_ENDED_LINE],
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

/** Spoken payback line: "It pays back in 13 to 19 years, likely 15." */
function paybackVoice(book: RefBook, p: RangeFigs): string {
  usePayback(book, p);
  const range = paybackPhrase(p);
  const likely = bare(p.likely);
  return p.low.text === p.high.text ? `It pays back in about ${range}.` : `It pays back in ${range}, likely ${likely}.`;
}

/** Spoken hook: names the place, the year and that the credit is gone, in the first second or so. */
const hookVoice = (place: string) => `${place} solar in 2026: federal tax credit gone. Still worth it?`;

/** The full page address is on screen; the voice says just the site so the line stays short. */
const CTA_VOICE = 'Every home’s different. Check yours free at rayvalue.com.';

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
/** Music: upbeat. A short (about 20 s), practical "here are your numbers" Reel: hook, payback, installed cost, CTA. */
export function buildUtilityPaybackReel(vm: UtilityPageVm, opts: BuildOptions): GeneratedPost {
  const key = 'utility-payback-reel';
  const f = factsOrThrow(vm);
  const book = new RefBook();
  const c = f.solar.cost;
  const url = utilityUrlText(f);
  const slides = withPhotos(f.state, `${key}/${f.slug}`, [
    voiced(
      {
        id: 'hook',
        theme: 'sun',
        kicker: utilityKicker(f),
        title: `Is ${f.short} solar still worth it in 2026?`,
        subtitle: `${f.stateName} solar cost and payback, without the federal tax credit.`,
      },
      hookVoice(f.short),
      'hook',
    ),
    voiced(paybackSlide(book, f), paybackVoice(book, f.solar.payback), 'figure'),
    voiced(costSlide(book, f), `That’s on the full installed price: ${voiceRange(book, c.low, c.high)}.`, 'figure'),
    voiced(ctaSlide(book, url, `Free, on ${f.short}’s rates. Your bill, your roof.`, f.dataDate, 'Rates read'), CTA_VOICE, 'cta'),
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
    {
      id: 'cover',
      theme: 'sun',
      kicker: utilityKicker(f),
      title: `How long does ${f.short} solar take to pay off in 2026?`,
      subtitle: `${f.stateName} solar cost without the federal tax credit. Swipe for the real ranges.`,
    },
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
  slides.push(ctaSlide(book, utilityUrlText(f), `Free, on ${f.short}’s rates. Your bill, your roof.`, f.dataDate, 'Rates read'));
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
 * Music: calm. A short explainer about the policy change across a whole state: hook naming the state, payback by
 * utility, installed cost by utility, CTA.
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
  // Best-case and worst-case payback across the utilities (each end is one utility's own figure).
  const payLow = facts.map((x) => x.solar.payback.low).reduce((a, b) => (paybackYears(b) < paybackYears(a) ? b : a));
  const payHigh = facts.map((x) => x.solar.payback.high).reduce((a, b) => (paybackYears(b) > paybackYears(a) ? b : a));
  book.use(payLow);
  book.use(payHigh);
  const payRange = paybackPhrase({ low: payLow, likely: payLow, high: payHigh });
  const names = facts.map((x) => x.short);
  const nameList = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]!;
  const url = calculatorUrlText(state);

  const slides = withPhotos(state, `${key}/${state.toLowerCase()}`, [
    voiced(
      {
        id: 'hook',
        theme: 'sun',
        kicker: `${stateName} solar · 2026`,
        title: `${stateName} solar in 2026: still worth it?`,
        subtitle: `The federal tax credit is gone. Payback and cost with ${nameList}.`,
      },
      hookVoice(stateName),
      'hook',
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
      `Solar alone pays back in ${payRange}, by utility.`,
      'figure',
    ),
    voiced(
      {
        id: 'cost',
        theme: 'light',
        kicker: 'Installed cost',
        title: 'What that system costs',
        subtitle: sameBill ? 'Sized for the same bill, at full price' : 'Sized for each home, at full price',
        rows: costRows,
        lines: [CREDIT_ENDED_LINE],
        footer: footerFor(book, oldest, 'Oldest rate data read'),
      },
      `At full price, that’s about ${voiceRange(book, costLow, costHigh)} installed.`,
      'figure',
    ),
    voiced(ctaSlide(book, url, 'Free calculator on your utility’s rates.', oldest, 'Oldest rate data read'), CTA_VOICE, 'cta'),
  ]);

  const caption = creditGoneCaption(book, { state, stateName, facts, billNote, costLow, costHigh, urlText: url }, opts.channel);
  return finish({ templateKey: key, target: state.toLowerCase(), type: 'reel', channel: opts.channel, music: 'calm', title: `${stateName} solar without the federal credit`, caption, slides, book });
}

export const utilitySlugsForState = (state: 'FL' | 'CA') => UTILITY_PAGES.filter((p) => p.state === state).map((p) => p.slug);

// ------------------------------------------------------------------ battery-worth-it-reel
/**
 * Music: calm. "Is a battery worth adding?": hook, solar-only vs solar + 1 battery payback (the utility page's own
 * worked examples at the typical bill), installed cost of each, CTA. Whether the battery lengthens or shortens payback
 * is read from the likely cases; nothing else is claimed about it.
 */
export function buildBatteryWorthItReel(vm: UtilityPageVm, opts: BuildOptions): GeneratedPost {
  const key = 'battery-worth-it-reel';
  const f = factsOrThrow(vm);
  if (!f.battery) throw new Error(`${vm.meta.slug}: no solar + battery example with a result; nothing honest to compare`);
  const battery = f.battery;
  const book = new RefBook();
  const count: Fig = fig('calc_example', f.utilityId, 'battery_count', '1');
  book.use(count);
  const effect = batteryEffect(f.solar, battery);
  const pair = (e: ExampleFacts) => ({ label: e.label, value: paybackBig(e.payback), hint: `${usePayback(book, e.payback)}` });
  const costRow = (e: ExampleFacts) => ({ label: e.label, value: joinRange(book.use(e.cost.low), book.use(e.cost.high)), hint: `likely ${book.use(e.cost.likely)} · ${book.use(e.size)} system` });
  const url = utilityUrlText(f);

  const slides = withPhotos(f.state, `${key}/${f.slug}`, [
    voiced(
      {
        id: 'hook',
        theme: 'sun',
        kicker: utilityKicker(f),
        title: `Is a battery worth adding to ${f.short} solar in 2026?`,
        subtitle: `Payback with and without a battery, no federal tax credit.`,
      },
      `${f.short} solar in 2026: federal tax credit gone. Add a battery?`,
      'hook',
    ),
    voiced(
      {
        id: 'battery',
        theme: 'light',
        kicker: 'Payback compared',
        title: `Solar only vs solar + ${book.use(count)} battery`,
        subtitle: `Same ${book.use(f.bill)} monthly bill, ${f.short} rates`,
        rows: [pair(f.solar), pair(battery)],
        lines: [`In this example a battery makes payback ${effect}.`],
        footer: footerFor(book, f.dataDate),
      },
      `Solar only: ${paybackPhrase(f.solar.payback)}. Plus battery: ${paybackPhrase(battery.payback)}.`,
      'figure',
    ),
    voiced(
      {
        id: 'cost',
        theme: 'light',
        kicker: 'What it costs',
        title: 'Installed cost, with and without',
        subtitle: homeLine(book, f),
        rows: [costRow(f.solar), costRow(battery)],
        lines: [CREDIT_ENDED_LINE, 'Many homeowners add a battery for backup power during outages.'],
        footer: footerFor(book, f.dataDate),
      },
      `With a battery, installed: ${voiceRange(book, battery.cost.low, battery.cost.high)}.`,
      'figure',
    ),
    voiced(ctaSlide(book, url, `Free, on ${f.short}’s rates. Your bill, your roof.`, f.dataDate, 'Rates read'), CTA_VOICE, 'cta'),
  ]);
  const caption = batteryCaption(book, { ...f, battery }, count, effect, opts.channel, key);
  return finish({ templateKey: key, target: f.slug, type: 'reel', channel: opts.channel, music: 'calm', title: `${f.short}: is a battery worth adding to solar?`, caption, slides, book });
}

// ------------------------------------------------------------------ bill-size-reel
/**
 * Music: upbeat. "Does your bill change payback?": solar-only payback and installed cost at each illustrative bill on
 * the utility page (the page's examples, same rates), so a reader finds the bill closest to theirs. Needs at least two
 * bills with results.
 */
export function buildBillSizeReel(vm: UtilityPageVm, opts: BuildOptions): GeneratedPost {
  const key = 'bill-size-reel';
  const f = factsOrThrow(vm);
  const bills = buildBillFacts(vm);
  if (bills.length < 2) throw new Error(`${vm.meta.slug}: only ${bills.length} bill sizes have a result; need at least 2 to compare`);
  const book = new RefBook();
  const first = bills[0]!;
  const last = bills[bills.length - 1]!;
  const effect = batteryEffect(first.solar, last.solar);
  const url = utilityUrlText(f);
  const payRows = bills.map((b) => ({ label: `${book.use(b.bill)} monthly bill`, value: paybackBig(b.solar.payback), hint: `${usePayback(book, b.solar.payback)} · ${book.use(b.solar.size)} system` }));
  const costRows = bills.map((b) => ({ label: `${book.use(b.bill)} monthly bill`, value: joinRange(book.use(b.solar.cost.low), book.use(b.solar.cost.high)), hint: `likely ${book.use(b.solar.cost.likely)}` }));
  const costLow = bills.map((b) => b.solar.cost.low).reduce((a, b) => (figAmount(b) < figAmount(a) ? b : a));
  const costHigh = bills.map((b) => b.solar.cost.high).reduce((a, b) => (figAmount(b) > figAmount(a) ? b : a));

  const slides = withPhotos(f.state, `${key}/${f.slug}`, [
    voiced(
      {
        id: 'hook',
        theme: 'sun',
        kicker: utilityKicker(f),
        title: `${f.short} solar in 2026: does your bill size matter?`,
        subtitle: 'Payback at different monthly bills, without the federal tax credit.',
      },
      `${f.short} solar in 2026: federal tax credit gone. Bill size matter?`,
      'hook',
    ),
    voiced(
      {
        id: 'payback',
        theme: 'light',
        kicker: 'Payback, solar only',
        title: 'Payback at each bill size',
        subtitle: `${f.short} rates, no federal tax credit`,
        rows: payRows,
        footer: footerFor(book, f.dataDate),
      },
      `At ${book.use(first.bill)}: ${paybackPhrase(first.solar.payback)}. At ${book.use(last.bill)}: ${paybackPhrase(last.solar.payback)}.`,
      'figure',
    ),
    voiced(
      {
        id: 'cost',
        theme: 'light',
        kicker: 'Installed cost',
        title: 'What each system costs',
        subtitle: 'Sized to the bill, at full price',
        rows: costRows,
        lines: [CREDIT_ENDED_LINE],
        footer: footerFor(book, f.dataDate),
      },
      `At full price, that’s ${voiceRange(book, costLow, costHigh)} installed.`,
      'figure',
    ),
    voiced(ctaSlide(book, url, `Free, on ${f.short}’s rates. Your bill, your roof.`, f.dataDate, 'Rates read'), CTA_VOICE, 'cta'),
  ]);
  const caption = billSizeCaption(book, f, bills, effect, opts.channel, key);
  return finish({ templateKey: key, target: f.slug, type: 'reel', channel: opts.channel, music: 'upbeat', title: `${f.short} solar payback at different monthly bills`, caption, slides, book });
}

// ------------------------------------------------------------------ fl-vs-ca-reel
/** Best-case and worst-case payback across a state's utilities (each end is one utility's own figure). */
function stateRange(facts: readonly UtilityFacts[]): RangeFigs {
  const low = facts.map((x) => x.solar.payback.low).reduce((a, b) => (paybackYears(b) < paybackYears(a) ? b : a));
  const high = facts.map((x) => x.solar.payback.high).reduce((a, b) => (paybackYears(b) > paybackYears(a) ? b : a));
  return { low, likely: low, high };
}

/**
 * Music: upbeat. Florida and California side by side: payback range and installed-cost range across each state's
 * utilities. No target (one post covers both states). Needs at least two utilities with a worked example per state.
 */
export function buildFlVsCaReel(vms: readonly UtilityPageVm[], opts: BuildOptions): GeneratedPost {
  const key = 'fl-vs-ca-reel';
  const all = vms.map(buildUtilityFacts).filter((x): x is UtilityFacts => x !== null);
  const fl = all.filter((x) => x.state === 'FL');
  const ca = all.filter((x) => x.state === 'CA');
  if (fl.length < 2 || ca.length < 2) throw new Error(`need at least 2 utilities with a worked example in each state (FL ${fl.length}, CA ${ca.length})`);
  const book = new RefBook();
  const oldest = all.filter((x) => x.dataDate && x.verifiedOn).sort((a, b) => a.verifiedOn!.localeCompare(b.verifiedOn!))[0]?.dataDate ?? null;
  const sameBill = all.every((x) => x.bill.text === all[0]!.bill.text);
  const billNote = sameBill ? `typical home with a ${book.use(all[0]!.bill)} monthly bill` : 'typical home for each utility';
  const names = (facts: readonly UtilityFacts[]) => facts.map((x) => x.short).join(', ');
  const costLow = (facts: readonly UtilityFacts[]) => facts.map((x) => x.solar.cost.low).reduce((a, b) => (figAmount(b) < figAmount(a) ? b : a));
  const costHigh = (facts: readonly UtilityFacts[]) => facts.map((x) => x.solar.cost.high).reduce((a, b) => (figAmount(b) > figAmount(a) ? b : a));
  const flPay = stateRange(fl);
  const caPay = stateRange(ca);
  // The likely cases across a state's utilities ("likely 11.5 to 15 yrs"), one utility's own figure at each end.
  const likelyOf = (figs: Fig[], key: (f: Fig) => number, unitless = false) => {
    const lo = figs.reduce((a, b) => (key(b) < key(a) ? b : a));
    const hi = figs.reduce((a, b) => (key(b) > key(a) ? b : a));
    const a = book.use(lo);
    const b = book.use(hi);
    return a === b ? `likely ${a}` : `likely ${unitless ? bare(lo) : a} to ${b}`;
  };
  const payRow = (label: string, facts: readonly UtilityFacts[], r: RangeFigs) => {
    book.use(r.low);
    book.use(r.high);
    return { label, value: paybackBig(r), hint: `${likelyOf(facts.map((x) => x.solar.payback.likely), paybackYears, true)}\n${names(facts)}` };
  };
  const costRow = (label: string, facts: readonly UtilityFacts[]) => ({
    label,
    value: joinRange(book.use(costLow(facts)), book.use(costHigh(facts))),
    hint: `${likelyOf(facts.map((x) => x.solar.cost.likely), figAmount)}\n${names(facts)}`,
  });
  const seed = `${key}/none`;
  // Photos alternate between the two states so the Reel itself reads as a comparison.
  const flPhotos = assignPhotos('FL', seed, ['hook', 'cost']);
  const caPhotos = assignPhotos('CA', seed, ['payback', 'cta']);
  const photos: PhotoKey[] = [flPhotos[0]!, caPhotos[0]!, flPhotos[1]!, caPhotos[1]!];

  const built = [
    voiced(
      {
        id: 'hook',
        theme: 'sun',
        kicker: 'Florida vs California · 2026',
        title: 'Florida vs California solar in 2026: which pays back faster?',
        subtitle: 'Payback and cost side by side, without the federal tax credit.',
      },
      'Florida versus California solar, 2026: federal tax credit gone.',
      'hook',
    ),
    voiced(
      {
        id: 'payback',
        theme: 'light',
        kicker: 'Payback, solar only',
        title: 'How long until it pays for itself',
        subtitle: `A ${billNote}, across each state’s utilities`,
        rows: [payRow('Florida', fl, flPay), payRow('California', ca, caPay)],
        footer: footerFor(book, oldest, 'Oldest rate data read'),
      },
      `Florida: ${paybackPhrase(flPay)}. California: ${paybackPhrase(caPay)}.`,
      'figure',
    ),
    voiced(
      {
        id: 'cost',
        theme: 'light',
        kicker: 'Installed cost',
        title: 'What that system costs',
        subtitle: 'Sized for the bill, at full price',
        rows: [costRow('Florida', fl), costRow('California', ca)],
        lines: [CREDIT_ENDED_LINE],
        footer: footerFor(book, oldest, 'Oldest rate data read'),
      },
      `Installed, across both states: ${voiceRange(book, costLow(all), costHigh(all))}.`,
      'figure',
    ),
    voiced(ctaSlide(book, 'rayvalue.com/calculator', 'Free calculator on your utility’s rates.', oldest, 'Oldest rate data read'), CTA_VOICE, 'cta'),
  ].map((sl, i) => ({ ...sl, photo: photos[i] }));

  const caption = flVsCaCaption(book, { fl, ca, billNote, urlText: 'rayvalue.com/calculator' }, opts.channel);
  return finish({ templateKey: key, target: 'none', type: 'reel', channel: opts.channel, music: 'upbeat', title: 'Florida vs California solar payback and cost', caption, slides: built, book });
}
