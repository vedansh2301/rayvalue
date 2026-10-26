import { describe, expect, it } from 'vitest';
import type { Assumptions, CityProduction } from '../../../data/schemas';
import { caFixture, clone, fixtureAssumptions, fixtureCosts, fixtureUtilities } from '../../calc/test-fixtures';
import { fixtureCitiesFile } from '../../db/test-rows';
import { UTILITY_PAGES } from '../../utility/pages';
import { buildUtilityPage, typicalExample, type UtilityPageVm } from '../../utility/view';
import { captionNumbers, checksPassed, countHashtags, creditClaims, officialWording, runChecks, untracedNumbers, type MediaForCheck } from '../checks';
import { TEMPLATE_KEYS } from '../template-keys';
import type { Slot } from '../types';
import { fitFontSize, longestLine } from './fit';
import { AUTO_DAYS, candidatesFor, countFreeSlots, isValidJob, planAuto, targetsFor } from './plan';
import { decideQueueState } from './queue';
import { batteryEffect, buildCreditGoneReel, buildUtilityPaybackCarousel, buildUtilityPaybackReel, describeSlide, slideTexts, truncateAlt } from './templates';
import { buildUtilityFacts, formatDataDate, joinRange, paybackBig, paybackPhrase } from './facts';
import { REEL_MAX_SECONDS, reelTimeline } from './timeline';
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

const posts: [string, () => GeneratedPost][] = [
  ['utility-payback-reel', () => buildUtilityPaybackReel(fpl())],
  ['utility-payback-carousel', () => buildUtilityPaybackCarousel(fpl())],
  ['credit-gone-reel', () => buildCreditGoneReel('FL', flVms())],
];

// ------------------------------------------------------------------ templates
describe.each(posts)('%s', (key, build) => {
  const post = build();
  const check = () =>
    runChecks({ type: post.type, caption: post.caption, data_refs: post.dataRefs, numbers_confirmed: false, media: mediaFor(post) });

  it('is a known template key of the matching type', () => {
    const t = TEMPLATE_KEYS.find((x) => x.key === key)!;
    expect(post.templateKey).toBe(key);
    expect(post.type).toBe(t.type);
    expect(isValidJob({ template: key, target: post.target })).toBe(true);
  });

  it('caption passes every pre-publish check (checksPassed)', () => {
    const results = check();
    expect(results.filter((r) => !r.ok && r.level === 'error')).toEqual([]);
    expect(checksPassed(results)).toBe(true);
  });

  it('has 3-8 hashtags, a soft "link in bio" CTA and fits Instagram limits', () => {
    expect(countHashtags(post.caption)).toBeGreaterThanOrEqual(3);
    expect(countHashtags(post.caption)).toBeLessThanOrEqual(8);
    expect(post.caption).toMatch(/link in bio/i);
    expect(post.caption.length).toBeLessThanOrEqual(2200);
    expect(post.title.length).toBeLessThanOrEqual(120);
  });

  it('every number in the caption AND on the slides has a data_ref', () => {
    expect(captionNumbers(post.caption).length).toBeGreaterThan(0);
    expect(untracedNumbers(post.caption, post.dataRefs)).toEqual([]);
    const onSlides = post.slides.flatMap(slideTexts).join('\n');
    expect(untracedNumbers(onSlides, post.dataRefs)).toEqual([]);
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
    // slides may say "no federal tax credit"; any other sentence naming the credit must say it ended
    expect(creditClaims(everything).filter((c) => !/\bno\b/i.test(c))).toEqual([]);
    expect(officialWording(everything)).toEqual([]);
    expect(post.slides.some((s) => slideTexts(s).join(' ').includes('ended for 2026')) || post.slides.some((s) => /federal credit ended for 2026/.test(s.title))).toBe(true);
  });

  it('slide count and timing fit the format', () => {
    if (post.type === 'reel') {
      expect(post.slides.length).toBeGreaterThanOrEqual(5);
      expect(post.slides.length).toBeLessThanOrEqual(6);
      expect(reelTimeline(post.slides.map((s) => s.seconds ?? 4)).total).toBeLessThanOrEqual(REEL_MAX_SECONDS);
    } else {
      expect(post.slides.length).toBeGreaterThanOrEqual(5);
      expect(post.slides.length).toBeLessThanOrEqual(7);
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
    expect(() => buildUtilityPaybackReel(vm)).toThrow(/nothing honest/);
  });

  it('credit-gone needs at least two utilities with examples', () => {
    expect(() => buildCreditGoneReel('CA', [vmFor('pge', { production: [prod('fx-c', 'CA')], lookupZip: () => ({ state: 'CA' as const }) })])).toThrow(/at least 2/);
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
    const s = buildUtilityPaybackReel(fpl()).slides[1]!;
    expect(describeSlide(s)).toContain('Installed cost');
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
  });
});
