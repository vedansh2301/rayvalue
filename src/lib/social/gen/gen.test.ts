import { describe, expect, it } from 'vitest';
import type { Assumptions, CityProduction } from '../../../data/schemas';
import { caFixture, clone, fixtureAssumptions, fixtureCosts, fixtureUtilities } from '../../calc/test-fixtures';
import { fixtureCitiesFile } from '../../db/test-rows';
import { UTILITY_PAGES } from '../../utility/pages';
import { buildUtilityPage, typicalExample, type UtilityPageVm } from '../../utility/view';
import { captionNumbers, checksPassed, countHashtags, creditClaims, FB_LIMITS, officialWording, runChecks, untracedNumbers, type MediaForCheck } from '../checks';
import { TEMPLATE_KEYS } from '../template-keys';
import type { Channel, Slot } from '../types';
import { fitFontSize, longestLine } from './fit';
import { AUTO_DAYS, candidatesFor, countFreeSlots, isValidJob, planAuto, targetsFor } from './plan';
import { decideQueueState } from './queue';
import { batteryEffect, buildCreditGoneReel, buildUtilityPaybackCarousel, buildUtilityPaybackReel, describeSlide, REEL_MIN_SECONDS, slideTexts, truncateAlt, voiceSeconds, voiceWords } from './templates';
import { facebookLink, stateKeywordLine, utilityKeywordLine } from './captions';
import { hashtagsFor, IG_HASHTAG_MAX, IG_HASHTAG_MIN } from './hashtags';
import { PHOTOS } from './photos';
import { assignPhotos, seedHash } from './slide-photos';
import { buildUtilityFacts, formatDataDate, joinRange, paybackBig, paybackPhrase } from './facts';
import { REEL_MAX_SECONDS, REEL_TARGET_SECONDS, reelTimeline } from './timeline';
import { speakable } from './speech';
import type { GeneratedPost } from './types';

// ------------------------------------------------------------------ fixtures
const assumptions: Assumptions = { ...clone(fixtureAssumptions), utility_example_bills: { kind: 'assumption', rationale: 'synthetic fixture value', value: [150, 250, 350] } };
const prod = (slug: string, state: 'FL' | 'CA'): CityProduction => ({
  state, slug, losses: 20, annual_kwh_per_kw: 1200, monthly_kwh_per_kw: Array(12).fill(100), fetched_on: '2026-01-01',
  source_url: 'https://example.com/p', endpoint: 'https://example.com/e', params: {}, dataset_note: 'synthetic', key_kind: 'api_key',
});
const vmFor = (utilityId: string, over: Partial<Parameters<typeof buildUtilityPage>[0]> = {}): UtilityPageVm =>
  buildUtilityPage({
    meta: UTILITY_PAGES.find((p) => p.utilityId === utilityId)!,
    utilities: fixtureUtilities,
    costs: fixtureCosts,
    assumptions,
    cities: [...fixtureCitiesFile.cities, { ...fixtureCitiesFile.cities[0]!, slug: 'fx-d', name: 'Fixture D', default_utility_id: 'teco' }],
    production: [prod('fx-a', 'FL'), prod('fx-b', 'FL'), prod('fx-d', 'FL'), prod('fx-c', 'CA')],
    lookupZip: () => ({ state: 'FL' as const }),
    ...over,
  })!;

const fpl = () => vmFor('fpl');
const flVms = () => ['fpl', 'duke-fl', 'teco'].map((id) => vmFor(id));

const reelMedia = (post: GeneratedPost): MediaForCheck[] => [
  { kind: 'video', mime: 'video/mp4', width: 1080, height: 1920, duration_s: reelTimeline(post.slides.map((s) => s.seconds ?? 4)).total },
];
const carouselMedia = (post: GeneratedPost): MediaForCheck[] => post.slides.map(() => ({ kind: 'image', mime: 'image/jpeg', width: 1080, height: 1350, duration_s: null }));
const mediaFor = (p: GeneratedPost) => (p.type === 'reel' ? reelMedia(p) : carouselMedia(p));

type Build = (channel: Channel) => GeneratedPost;
const builders: [string, Build][] = [
  ['utility-payback-reel', (channel) => buildUtilityPaybackReel(fpl(), { channel })],
  ['utility-payback-carousel', (channel) => buildUtilityPaybackCarousel(fpl(), { channel })],
  ['credit-gone-reel', (channel) => buildCreditGoneReel('FL', flVms(), { channel })],
];
const CHANNELS: Channel[] = ['instagram', 'facebook'];
/** Names a fixture post can be about (state or utility). */
const PLACES = /\b(Florida|California|FPL|Duke Energy Florida|TECO|PG&E|SCE|SDG&E)\b/;
/** Reel slide kind -> its minimum hold (REEL_MIN_SECONDS). */
const reelKind = (id: string): keyof typeof REEL_MIN_SECONDS => (id === 'hook' ? 'hook' : id === 'cta' ? 'cta' : 'figure');
const posts: [string, Channel, () => GeneratedPost][] = builders.flatMap(([key, build]) => CHANNELS.map((c): [string, Channel, () => GeneratedPost] => [key, c, () => build(c)]));

// ------------------------------------------------------------------ templates
describe.each(posts)('%s (%s)', (key, channel, build) => {
  const post = build();
  const check = (channels: Channel[] = [post.channel]) =>
    runChecks({ type: post.type, caption: post.caption, data_refs: post.dataRefs, numbers_confirmed: false, media: mediaFor(post), channels });
  const voices = post.slides.flatMap((s) => (s.voice ? [s.voice] : []));

  it('is a known template key of the matching type, for its channel', () => {
    const t = TEMPLATE_KEYS.find((x) => x.key === key)!;
    expect(post.templateKey).toBe(key);
    expect(post.type).toBe(t.type);
    expect(post.channel).toBe(channel);
    expect(isValidJob({ template: key, target: post.target })).toBe(true);
    expect(post.music).toBe(post.type === 'reel' ? (key === 'credit-gone-reel' ? 'calm' : 'upbeat') : null);
  });

  it('caption passes every pre-publish check for its channel (checksPassed)', () => {
    const results = check();
    expect(results.filter((r) => !r.ok && r.level === 'error')).toEqual([]);
    expect(checksPassed(results)).toBe(true);
  });

  it('fits caption limits and opens on a searchable keyword line (place + solar + cost/payback + 2026)', () => {
    expect(post.caption.length).toBeLessThanOrEqual(2200);
    expect(post.title.length).toBeLessThanOrEqual(120);
    const first = post.caption.split('\n')[0]!;
    expect(first.length).toBeLessThanOrEqual(120);
    expect(first).toMatch(PLACES);
    expect(first).toMatch(/\bsolar\b/i);
    expect(first).toMatch(/\b(cost|payback)\b/i);
    expect(first).toMatch(/\b2026\b/);
    // it names the credit only as gone (rule 2)
    expect(first).toMatch(/without the federal tax credit/);
    expect(first).toBe(key === 'credit-gone-reel' ? stateKeywordLine('Florida') : utilityKeywordLine({ short: 'FPL', stateName: 'Florida' }));
    expect(post.caption).toMatch(/[Ee]stimates, not quotes/);
    expect(post.caption).toMatch(/likely/);
  });

  it('the first slide shows the key search words on screen', () => {
    const hook = post.slides[0]!;
    const onScreen = [hook.kicker, hook.title, hook.subtitle].join(' ');
    expect(onScreen).toMatch(PLACES);
    expect(onScreen).toMatch(/\bsolar\b/i);
    expect(onScreen).toMatch(/\b2026\b/);
    expect(hook.title).toMatch(/2026/);
  });

  if (channel === 'instagram') {
    it('Instagram: 3-5 relevant hashtags at the end, "link in bio" CTA, a save prompt, at most 3 emoji', () => {
      const tags = countHashtags(post.caption);
      expect(tags).toBeGreaterThanOrEqual(3);
      expect(tags).toBeLessThanOrEqual(5);
      expect(post.caption).toMatch(/#solarpanels\b/);
      expect(post.caption.split('\n\n').pop()).toMatch(/^(#[a-z0-9]+ ?)+$/);
      expect(post.caption).toMatch(/Run your own numbers \(free\) — link in bio · rayvalue\.com\//);
      expect(post.caption).toMatch(/Save this/);
      expect(post.caption).not.toMatch(/https?:\/\//);
      expect((post.caption.match(/\p{Extended_Pictographic}/gu) ?? []).length).toBeLessThanOrEqual(3);
      expect(post.caption).toMatch(/#(fpl|dukeenergy|teco)\b/);
      expect(post.caption).toMatch(/#floridasolar\b/);
      expect(post.caption).not.toMatch(/#\w*(taxcredit|itc)\b/i);
    });
  } else {
    it('Facebook: at most 3 hashtags, a clickable UTM link on its own line, a question, no "link in bio"', () => {
      expect(countHashtags(post.caption)).toBeGreaterThanOrEqual(2);
      expect(countHashtags(post.caption)).toBeLessThanOrEqual(3);
      expect(post.caption).not.toMatch(/link in bio/i);
      const link = post.caption.split('\n').find((l) => l.startsWith('https://'));
      expect(link).toBe(`https://${post.slides[post.slides.length - 1]!.url}?utm_source=facebook&utm_medium=social&utm_campaign=${key}`);
      expect(post.caption).toMatch(/\?[^\n]*comments/);
    });
  }

  it('every number in the caption, on the slides AND in the voice-over has a data_ref', () => {
    expect(captionNumbers(post.caption).length).toBeGreaterThan(0);
    expect(untracedNumbers(post.caption, post.dataRefs)).toEqual([]);
    const onSlides = post.slides.flatMap(slideTexts).join('\n');
    expect(untracedNumbers(onSlides, post.dataRefs)).toEqual([]);
    expect(untracedNumbers(voices.join('\n'), post.dataRefs)).toEqual([]);
  });

  it('every slide has a photo, adjacent slides never share one, and the alt text says what the photos show', () => {
    for (const s of post.slides) expect(s.photo && PHOTOS[s.photo], s.id).toBeTruthy();
    for (let i = 1; i < post.slides.length; i++) expect(post.slides[i]!.photo).not.toBe(post.slides[i - 1]!.photo);
    const first = post.slides[0]!.photo!;
    expect(first.startsWith('fl-')).toBe(true);
    expect(post.slides[post.slides.length - 1]!.photo!.startsWith('fl-')).toBe(true);
    expect(post.altText).toContain(PHOTOS[first].alt);
    if (post.type === 'carousel') expect(describeSlide(post.slides[0]!)).toContain(PHOTOS[first].alt);
  });

  it('Reels: every slide has a punchy voice line (about 12 words), the hook first, a CTA last, 18-25 s planned', () => {
    if (post.type !== 'reel') {
      expect(voices).toEqual([]);
      return;
    }
    for (const s of post.slides) {
      expect(s.voice, s.id).toBeTruthy();
      expect(voiceWords(s.voice!), s.voice).toBeLessThanOrEqual(12);
      expect(s.seconds).toBe(voiceSeconds(s.voice!, REEL_MIN_SECONDS[reelKind(s.id)]));
      // ranges are spoken "X to Y", never with a dash
      expect(s.voice).not.toMatch(/\d–/);
    }
    // The hook names the place and the year in its first words, and says the credit is gone.
    expect(post.slides[0]!.voice).toMatch(/^(Florida|FPL) solar in 2026: federal tax credit gone\./);
    expect(post.slides[post.slides.length - 1]!.voice).toMatch(/free at rayvalue\.com\.$/);
    const total = reelTimeline(post.slides.map((s) => s.seconds ?? 4)).total;
    expect(total).toBeGreaterThanOrEqual(REEL_TARGET_SECONDS.min);
    expect(total).toBeLessThanOrEqual(REEL_TARGET_SECONDS.max);
  });

  it('data_refs are well formed and value is the shown text', () => {
    expect(post.dataRefs.length).toBeGreaterThan(0);
    // no stray refs: every number a ref records is actually shown somewhere (slide or caption)
    const shownNumbers = new Set(captionNumbers(post.slides.flatMap(slideTexts).join('\n') + '\n' + post.caption));
    for (const r of post.dataRefs) {
      expect(r.table && r.id && r.field && r.value).toBeTruthy();
      for (const n of captionNumbers(r.value)) expect(shownNumbers.has(n), `${r.table}/${r.id}/${r.field} = ${r.value}`).toBe(true);
    }
  });

  it('never presents the federal credit as available, no official wording, no $0 credit figure', () => {
    const everything = [post.caption, ...post.slides.flatMap(slideTexts)].join('\n');
    expect(creditClaims(post.caption)).toEqual([]);
    // the voice-over must say the credit ended or is gone every time it names it
    expect(creditClaims(voices.join('\n'))).toEqual([]);
    // slides may say "no federal tax credit"; any other sentence naming the credit must say it ended
    expect(creditClaims(everything).filter((c) => !/\bno\b/i.test(c))).toEqual([]);
    expect(officialWording(everything)).toEqual([]);
    expect(post.slides.some((s) => slideTexts(s).join(' ').includes('ended for 2026')) || post.slides.some((s) => /federal credit ended for 2026/.test(s.title))).toBe(true);
  });

  it('slide count and timing fit the format', () => {
    if (post.type === 'reel') {
      // hook -> payback -> installed cost -> CTA
      expect(post.slides.map((s) => s.id)).toEqual(['hook', 'payback', 'cost', 'cta']);
      expect(reelTimeline(post.slides.map((s) => s.seconds ?? 4)).total).toBeLessThanOrEqual(REEL_MAX_SECONDS);
      expect(REEL_MAX_SECONDS).toBeLessThanOrEqual(30);
      expect(REEL_MAX_SECONDS).toBeLessThanOrEqual(FB_LIMITS.reelSeconds.max);
    } else {
      expect(post.slides.length).toBeGreaterThanOrEqual(5);
      expect(post.slides.length).toBeLessThanOrEqual(6);
    }
  });

  it('shows low / likely / high ranges and the estimates footer on figure slides', () => {
    const figure = post.slides.filter((s) => s.big || s.rows);
    expect(figure.length).toBeGreaterThan(0);
    for (const s of figure) expect(s.footer?.join(' ')).toContain('Estimates, not quotes');
    const text = post.slides.flatMap(slideTexts).join(' ');
    expect(text).toMatch(/Likely|likely/);
  });

  it('has the CTA with the page path', () => {
    const last = post.slides[post.slides.length - 1]!;
    expect(last.url).toMatch(/^rayvalue\.com\/(solar\/(florida|california)\/[a-z-]+|calculator\/(florida|california))$/);
  });

  it('alt text is within the database limit', () => {
    expect(post.altText.length).toBeGreaterThan(20);
    expect(post.altText.length).toBeLessThanOrEqual(1000);
  });

  it('is deterministic for the same data', () => {
    expect(build()).toEqual(post);
  });
});

describe('per-channel posts', () => {
  it('share slides across channels; only the caption differs', () => {
    for (const [, build] of builders) {
      const ig = build('instagram');
      const fb = build('facebook');
      expect(fb.slides).toEqual(ig.slides);
      expect(fb.caption).not.toBe(ig.caption);
    }
  });

  it('every utility Reel stays short: 4 voiced slides, about 12 words a line, 18-25 s planned, keyword hook on screen', () => {
    const pge = vmFor('pge', { production: [prod('fx-c', 'CA')], lookupZip: () => ({ state: 'CA' as const }) });
    for (const vm of [...flVms(), pge]) {
      const post = buildUtilityPaybackReel(vm, { channel: 'instagram' });
      expect(post.slides).toHaveLength(4);
      // a long utility name ("Duke Energy Florida") may push the hook one word over
      for (const s of post.slides) expect(voiceWords(s.voice!), s.voice).toBeLessThanOrEqual(13);
      const total = reelTimeline(post.slides.map((s) => s.seconds!)).total;
      expect(total).toBeGreaterThanOrEqual(REEL_TARGET_SECONDS.min);
      expect(total).toBeLessThanOrEqual(REEL_TARGET_SECONDS.max);
      expect(post.slides[0]!.title).toContain(vm.meta.short);
      expect(post.caption.split('\n')[0]).toContain(`${vm.meta.short} solar panel cost and payback in 2026`);
      expect(untracedNumbers(post.slides.flatMap(slideTexts).join('\n') + post.caption, post.dataRefs)).toEqual([]);
    }
  });

  it('rotates photos by target so posts for different utilities do not look identical', () => {
    const sets = ['fpl', 'duke-fl', 'teco'].map((id) => buildUtilityPaybackReel(vmFor(id), { channel: 'instagram' }).slides.map((s) => s.photo).join(','));
    expect(new Set(sets).size).toBeGreaterThan(1);
  });

  it('California posts use California photos and tags', () => {
    const ca = assignPhotos('CA', 'utility-payback-reel/pge', ['hook', 'cost', 'savings', 'payback', 'changed', 'cta']);
    expect(ca[0]!.startsWith('ca-')).toBe(true);
    expect(ca[5]!.startsWith('ca-')).toBe(true);
    expect(new Set(ca).size).toBe(ca.length);
    expect(hashtagsFor('instagram', { state: 'CA', utilitySlugs: ['pge'] })).toEqual(['californiasolar', 'solarpanels', 'pge', 'solarenergy']);
    expect(hashtagsFor('instagram', { state: 'FL', utilitySlugs: ['fpl', 'duke-energy-florida', 'teco'] })).toEqual(['floridasolar', 'solarpanels', 'fpl', 'dukeenergy', 'teco']);
    for (const slugs of [[], ['sce'], ['pge', 'sce', 'sdge']]) {
      const n = hashtagsFor('instagram', { state: 'CA', utilitySlugs: slugs }).length;
      expect(n).toBeGreaterThanOrEqual(IG_HASHTAG_MIN);
      expect(n).toBeLessThanOrEqual(IG_HASHTAG_MAX);
    }
    expect(hashtagsFor('facebook', { state: 'CA', utilitySlugs: ['sdge'] })).toEqual(['CaliforniaSolar', 'SDGE', 'SolarEnergy']);
    expect(hashtagsFor('facebook', { state: 'FL', utilitySlugs: ['fpl', 'teco'] })).toEqual(['FloridaSolar', 'Homeowners', 'SolarEnergy']);
  });

  it('photo picks are deterministic and avoid repeats even past the pool', () => {
    expect(seedHash('abc')).toBe(seedHash('abc'));
    const many = assignPhotos('FL', 'x', ['hook', 'payback', 'payback', 'payback', 'payback', 'payback', 'payback', 'cta']);
    for (let i = 1; i < many.length; i++) expect(many[i]).not.toBe(many[i - 1]);
    expect(facebookLink('rayvalue.com/solar/florida/fpl', 'utility-payback-reel')).toBe(
      'https://rayvalue.com/solar/florida/fpl?utm_source=facebook&utm_medium=social&utm_campaign=utility-payback-reel',
    );
  });

  it('voiceSeconds grows with the line and respects the minimum', () => {
    expect(voiceSeconds('Hi.', 3)).toBe(3);
    expect(voiceSeconds('A typical FPL home needs about 8.5 kilowatts of solar: $12,300 to $16,100 installed.')).toBeGreaterThan(voiceSeconds('Every home is different.'));
  });
});

describe('utility facts use the same numbers as the utility page', () => {
  it('typical example = the page glance example, formatted like the page', () => {
    const vm = fpl();
    const f = buildUtilityFacts(vm)!;
    const t = typicalExample(vm.examples, vm.indexable)!;
    expect(t.bill).toBe(250);
    expect(f.solar.cost.low.text).toBe(`$${t.result.cost.low.toLocaleString('en-US')}`);
    expect(f.solar.size.text).toBe(`${t.result.size.likely} kW`);
    expect(f.solar.payback.likely.text).toBe(`${t.result.paybackYears.likely} yrs`);
    expect(f.pagePath).toBe('/solar/florida/fpl');
  });

  it('returns null (and the builders throw) when the page has no real example', () => {
    const vm = vmFor('fpl', { production: [] });
    expect(buildUtilityFacts(vm)).toBeNull();
    expect(() => buildUtilityPaybackReel(vm, { channel: 'instagram' })).toThrow(/nothing honest/);
  });

  it('credit-gone needs at least two utilities with examples', () => {
    expect(() => buildCreditGoneReel('CA', [vmFor('pge', { production: [prod('fx-c', 'CA')], lookupZip: () => ({ state: 'CA' as const }) })], { channel: 'instagram' })).toThrow(/at least 2/);
    expect(caFixture.id).toBe('pge');
  });

  it('formats data dates and ranges', () => {
    expect(formatDataDate('2026-10-22')).toBe('Oct 22, 2026');
    expect(formatDataDate(null)).toBeNull();
    expect(formatDataDate('nope')).toBeNull();
    expect(joinRange('$1,400', '$1,400')).toBe('$1,400');
    expect(joinRange('$1,000', '$1,600')).toBe('$1,000–$1,600');
  });

  it('payback beyond the analysis period reads "more than N" and traces to analysis_years', () => {
    const f = buildUtilityFacts(fpl())!;
    const p = { ...f.solar.payback, high: { text: 'more than 25 yrs', ref: { table: 'model_assumptions', id: 'analysis_years', field: 'value', value: '25' } } };
    expect(paybackPhrase(p)).toMatch(/ to more than 25 years$/);
    expect(paybackBig(p)).toMatch(/ to more than 25 years$/);
  });

  it('battery effect compares likely payback', () => {
    const f = buildUtilityFacts(fpl())!;
    expect(f.battery).not.toBeNull();
    expect(batteryEffect(f.solar, { ...f.battery!, paybackLikelyYears: 99 })).toBe('longer');
    expect(batteryEffect(f.solar, { ...f.battery!, paybackLikelyYears: 0.5 })).toBe('shorter');
    expect(batteryEffect(f.solar, { ...f.battery!, paybackLikelyYears: f.solar.paybackLikelyYears })).toBe('about the same');
  });
});

describe('alt text helpers', () => {
  it('describes a slide and truncates at a word boundary', () => {
    const s = buildUtilityPaybackReel(fpl(), { channel: 'instagram' }).slides.find((x) => x.id === 'cost')!;
    expect(describeSlide(s)).toContain('Installed cost');
    expect(describeSlide(s)).toContain(PHOTOS[s.photo!].alt);
    expect(describeSlide(s, false)).not.toContain(PHOTOS[s.photo!].alt);
    expect(truncateAlt('word '.repeat(400)).length).toBeLessThanOrEqual(1000);
    expect(truncateAlt('short')).toBe('short');
  });
});

// ------------------------------------------------------------------ timeline, fit
describe('reelTimeline', () => {
  it('chains xfade offsets and totals', () => {
    expect(reelTimeline([4, 4, 4], 0.5)).toEqual({ offsets: [3.5, 7], total: 11 });
    expect(reelTimeline([3, 4, 4.5, 4, 4, 4])).toEqual({ offsets: [2.5, 6, 10, 13.5, 17], total: 21 });
    expect(reelTimeline([5])).toEqual({ offsets: [], total: 5 });
    expect(reelTimeline([])).toEqual({ offsets: [], total: 0 });
  });
});

describe('fitFontSize', () => {
  it('shrinks long text and respects the bounds', () => {
    expect(fitFontSize('$1', 800, 100, 40)).toBe(100);
    expect(fitFontSize('$35,800–$53,500', 840, 132, 60)).toBeLessThan(132);
    expect(fitFontSize('x'.repeat(200), 800, 100, 40)).toBe(40);
  });
  it('two lines allow a bigger size for text with spaces', () => {
    expect(longestLine('more than 25 yrs', 2)).toBeLessThan(16);
    expect(fitFontSize('more than 25 yrs', 250, 58, 36, 2)).toBeGreaterThan(fitFontSize('more than 25 yrs', 250, 58, 36, 1));
  });
});

// ------------------------------------------------------------------ --auto planning
const slots: Slot[] = [
  { dow: 1, time: '18:00', type: 'reel' },
  { dow: 2, time: '12:00', type: 'carousel' },
  { dow: 3, time: '18:00', type: 'reel' },
  { dow: 4, time: '12:00', type: 'carousel' },
  { dow: 5, time: '18:00', type: 'reel' },
];
const NOW = new Date('2026-11-01T15:00:00Z'); // a Sunday

describe('rotation', () => {
  it('knows its targets', () => {
    expect(targetsFor('utility-payback-reel')).toEqual(UTILITY_PAGES.map((p) => p.slug));
    expect(targetsFor('credit-gone-reel')).toEqual(['fl', 'ca']);
    expect(targetsFor('nope')).toEqual([]);
    expect(isValidJob({ template: 'credit-gone-reel', target: 'fpl' })).toBe(false);
    expect(isValidJob({ template: 'utility-payback-carousel', target: 'sce' })).toBe(true);
  });

  it('interleaves templates so equal-age candidates alternate', () => {
    const c = candidatesFor('reel');
    expect(c.slice(0, 4).map((j) => `${j.template}/${j.target}`)).toEqual([
      'utility-payback-reel/fpl', 'credit-gone-reel/fl', 'utility-payback-reel/duke-energy-florida', 'credit-gone-reel/ca',
    ]);
    expect(c).toHaveLength(8);
    expect(candidatesFor('carousel')).toHaveLength(6);
    expect(candidatesFor('story')).toEqual([]);
  });

  it('counts open slots in the next 7 days, minus occupied ones', () => {
    expect(countFreeSlots(slots, 'reel', 'America/New_York', [], NOW, AUTO_DAYS)).toBe(3);
    expect(countFreeSlots(slots, 'carousel', 'America/New_York', [], NOW, AUTO_DAYS)).toBe(2);
    // Mon 2 Nov 2026 18:00 ET = 23:00Z (EST)
    expect(countFreeSlots(slots, 'reel', 'America/New_York', ['2026-11-02T23:00:00Z'], NOW, AUTO_DAYS)).toBe(2);
    expect(countFreeSlots(slots, 'story', 'America/New_York', [], NOW)).toBe(0);
  });

  it('fills open slots with distinct, never-generated pairs first', () => {
    const jobs = planAuto({ freeSlots: { reel: 3, carousel: 2 }, history: [], now: NOW });
    expect(jobs).toHaveLength(5);
    expect(new Set(jobs.map((j) => `${j.template}/${j.target}`)).size).toBe(5);
    expect(jobs.filter((j) => j.template === 'credit-gone-reel')).toHaveLength(1);
    expect(jobs.slice(0, 3).map((j) => j.template)).toEqual(['utility-payback-reel', 'credit-gone-reel', 'utility-payback-reel']);
  });

  it('skips a template + target generated in the last 21 days, allows older ones', () => {
    const day = 86_400_000;
    const history = [
      { template: 'utility-payback-reel', target: 'fpl', at: new Date(NOW.getTime() - 20 * day).toISOString() },
      { template: 'credit-gone-reel', target: 'fl', at: new Date(NOW.getTime() - 22 * day).toISOString() },
    ];
    const jobs = planAuto({ freeSlots: { reel: 8 }, history, now: NOW, maxPerRun: 20 });
    const keys = jobs.map((j) => `${j.template}/${j.target}`);
    expect(keys).not.toContain('utility-payback-reel/fpl');
    expect(keys).toContain('credit-gone-reel/fl');
    // the oldest (22-day) pair is picked after the never-generated ones
    expect(keys.indexOf('credit-gone-reel/fl')).toBe(keys.length - 1);
  });

  it('returns nothing when no slots are open or everything is cooling down, and caps a run', () => {
    expect(planAuto({ freeSlots: {}, history: [], now: NOW })).toEqual([]);
    const all = [...candidatesFor('reel'), ...candidatesFor('carousel')].map((j) => ({ ...j, at: NOW.toISOString() }));
    expect(planAuto({ freeSlots: { reel: 3, carousel: 2 }, history: all, now: NOW })).toEqual([]);
    expect(planAuto({ freeSlots: { reel: 8, carousel: 6 }, history: [], now: NOW })).toHaveLength(6);
    expect(planAuto({ freeSlots: { reel: 8, carousel: 6 }, history: [], now: NOW, maxPerRun: 2 })).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ queue state
describe('decideQueueState', () => {
  const settings = { auto_publish: true, paused: false, timezone: 'America/New_York', slots };
  const base = { checksPassed: true, type: 'reel' as const, settings, taken: [] as string[], now: NOW };

  it('schedules a passing post at the next free slot of its type', () => {
    const d = decideQueueState(base);
    expect(d.status).toBe('scheduled');
    expect(d.scheduledAt?.toISOString()).toBe('2026-11-02T23:00:00.000Z');
  });
  it('skips taken slots', () => {
    expect(decideQueueState({ ...base, taken: ['2026-11-02T23:00:00Z'] }).scheduledAt?.toISOString()).toBe('2026-11-04T23:00:00.000Z');
  });
  it('failing checks or auto-publish off -> review; paused -> draft; no free slot -> draft', () => {
    expect(decideQueueState({ ...base, checksPassed: false })).toEqual({ status: 'review', scheduledAt: null });
    expect(decideQueueState({ ...base, settings: { ...settings, auto_publish: false } })).toEqual({ status: 'review', scheduledAt: null });
    expect(decideQueueState({ ...base, settings: { ...settings, paused: true } })).toEqual({ status: 'draft', scheduledAt: null });
    expect(decideQueueState({ ...base, settings: { ...settings, slots: [] } })).toEqual({ status: 'draft', scheduledAt: null });
    // --draft: always a draft with no slot, even when it would schedule
    expect(decideQueueState({ ...base, draft: true })).toEqual({ status: 'draft', scheduledAt: null });
  });
});

// ------------------------------------------------------------------ voice-over speech (what the TTS engine reads)
describe('speakable() on every Reel voice line', () => {
  const pge = () => vmFor('pge', { production: [prod('fx-c', 'CA')], lookupZip: () => ({ state: 'CA' as const }) });
  const reels: [string, () => GeneratedPost][] = [
    ['utility-payback-reel/fpl', () => buildUtilityPaybackReel(fpl(), { channel: 'instagram' })],
    ['utility-payback-reel/pge', () => buildUtilityPaybackReel(pge(), { channel: 'instagram' })],
    ['credit-gone-reel/fl', () => buildCreditGoneReel('FL', flVms(), { channel: 'facebook' })],
  ];
  it.each(reels)('%s: no digits, symbols or raw acronyms left for the engine to guess at', (_k, build) => {
    const lines = build().slides.flatMap((s) => (s.voice ? [s.voice] : []));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const said = speakable(line);
      expect(said, line).not.toMatch(/[\d$&%/–—’]/);
      expect(said, line).not.toMatch(/\b[A-Z]{2,}\b/);
      expect(said.length, line).toBeGreaterThan(0);
    }
  });
});
