import { describe, expect, it } from 'vitest';
import { actionValue, budget, dateInZone, fromMinor, lastDays, num, parseAccount, parseAdObject, parseInsightRow, parseIssues, parseList, parseMetrics } from './parse';

describe('num / fromMinor / budget', () => {
  it('reads Graph numeric strings and rejects junk', () => {
    expect(num('12.5')).toBe(12.5);
    expect(num(3)).toBe(3);
    expect(num('')).toBeNull();
    expect(num('abc')).toBeNull();
    expect(num(null)).toBeNull();
    expect(num(Number.NaN)).toBeNull();
  });
  it('converts INR minor units (offset 100) and refuses unknown currencies', () => {
    expect(fromMinor('10000', 'INR')).toBe(100);
    expect(fromMinor('84745', 'INR')).toBe(847.45);
    expect(fromMinor('10000', 'XYZ')).toBeNull();
    expect(fromMinor('10000', null)).toBeNull();
  });
  it('treats a "0" budget as no budget at that level', () => {
    expect(budget('0', 'INR')).toBeNull();
    expect(budget('10000', 'INR')).toBe(100);
    expect(budget(undefined, 'INR')).toBeNull();
  });
});

describe('parseAccount', () => {
  it('maps the account fields', () => {
    expect(parseAccount({ id: 'act_1', name: 'x', currency: 'INR', timezone_name: 'Asia/Kolkata', account_status: 1, spend_cap: '84745', amount_spent: '0' })).toEqual({
      id: 'act_1',
      name: 'x',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      accountStatus: 1,
      spendCapInr: 847.45,
      amountSpentInr: 0,
    });
  });
  it('a spend_cap of 0 means no cap', () => {
    expect(parseAccount({ id: 'act_1', currency: 'INR', spend_cap: '0' })?.spendCapInr).toBeNull();
  });
  it('null without an id', () => expect(parseAccount({ name: 'x' })).toBeNull());
});

describe('parseAdObject', () => {
  it('maps an ad set as the API returned it on 2026-10-27', () => {
    const a = parseAdObject(
      'adset',
      {
        id: '120246779987350609',
        name: 'FL residents',
        campaign_id: '120246779985410609',
        effective_status: 'ACTIVE',
        configured_status: 'ACTIVE',
        daily_budget: '10000',
        lifetime_budget: '0',
        start_time: '2026-10-28T09:30:00+0530',
        end_time: '2026-11-04T10:30:00+0530',
        optimization_goal: 'LEAD_GENERATION',
      },
      'INR',
    );
    expect(a).toMatchObject({ level: 'adset', campaignId: '120246779985410609', adsetId: null, dailyBudgetInr: 100, lifetimeBudgetInr: null, optimizationGoal: 'LEAD_GENERATION', issues: [], endTime: '2026-11-04T10:30:00+0530' });
  });
  it('campaign stop_time becomes endTime; issues are kept', () => {
    const c = parseAdObject('campaign', { id: '1', name: 'c', stop_time: 't', issues_info: [{ error_summary: 'No ads', error_message: 'Add an ad', level: 'CAMPAIGN' }] }, 'INR');
    expect(c?.endTime).toBe('t');
    expect(c?.issues).toEqual([{ summary: 'No ads', message: 'Add an ad', level: 'CAMPAIGN' }]);
  });
  it('null without an id', () => expect(parseAdObject('ad', { name: 'x' }, 'INR')).toBeNull());
});

describe('parseIssues', () => {
  it('falls back to error_type / code and drops junk', () => {
    expect(parseIssues([{ error_type: 'HARD' }, { error_code: 5 }, 'x', null])).toEqual([
      { summary: 'HARD', message: null, level: null },
      { summary: 'Error 5', message: null, level: null },
    ]);
    expect(parseIssues(undefined)).toEqual([]);
  });
});

describe('parseMetrics', () => {
  const row = {
    spend: '412.30',
    impressions: '20000',
    reach: '15000',
    frequency: '1.333',
    cpm: '20.61',
    inline_link_clicks: '120',
    inline_link_click_ctr: '0.6',
    actions: [
      { action_type: 'lead', value: '5' },
      { action_type: 'onsite_conversion.lead_grouped', value: '4' },
      { action_type: 'video_view', value: '900' },
    ],
    cost_per_action_type: [{ action_type: 'onsite_conversion.lead_grouped', value: '103.07' }],
    video_thruplay_watched_actions: [{ action_type: 'video_view', value: '300' }],
    cost_per_thruplay: [{ action_type: 'video_view', value: '1.37' }],
    instagram_profile_visits: '7',
  };
  it('reads every metric, preferring onsite_conversion.lead_grouped for leads', () => {
    expect(parseMetrics(row)).toEqual({
      spendInr: 412.3,
      impressions: 20000,
      reach: 15000,
      frequency: 1.333,
      cpmInr: 20.61,
      linkClicks: 120,
      ctrPct: 0.6,
      leads: 4,
      leadsActionType: 'onsite_conversion.lead_grouped',
      costPerLeadInr: 103.07,
      thruplays: 300,
      costPerThruplayInr: 1.37,
      igProfileVisits: 7,
    });
  });
  it('a row with spend but no lead / ThruPlay actions means 0 of them (Meta omits zeros)', () => {
    const m = parseMetrics({ spend: '50' });
    expect(m.leads).toBe(0);
    expect(m.thruplays).toBe(0);
    expect(m.linkClicks).toBe(0);
    expect(m.costPerLeadInr).toBeNull();
    expect(m.costPerThruplayInr).toBeNull();
    expect(m.igProfileVisits).toBeNull();
  });
  it('without spend nothing is assumed', () => {
    const m = parseMetrics({});
    expect(m.leads).toBeNull();
    expect(m.thruplays).toBeNull();
  });
  it('derives cost per lead / ThruPlay from spend when Meta omits it', () => {
    const m = parseMetrics({ spend: '100', actions: [{ action_type: 'lead', value: '3' }], video_thruplay_watched_actions: [{ action_type: 'video_view', value: '8' }] });
    expect(m.leadsActionType).toBe('lead');
    expect(m.costPerLeadInr).toBe(33.33);
    expect(m.costPerThruplayInr).toBe(12.5);
  });
  it('actionValue finds one type', () => {
    expect(actionValue(row.actions, 'lead')).toBe(5);
    expect(actionValue(row.actions, 'nope')).toBeUndefined();
    expect(actionValue('x', 'lead')).toBeUndefined();
  });
});

describe('parseInsightRow / parseList', () => {
  it('uses the level id fields', () => {
    const r = parseInsightRow('adset', { adset_id: '9', adset_name: 'n', campaign_id: '1', spend: '1', date_start: '2026-10-27', date_stop: '2026-10-27' });
    expect(r).toMatchObject({ level: 'adset', id: '9', name: 'n', dateStart: '2026-10-27', spendInr: 1 });
    expect(parseInsightRow('ad', { adset_id: '9' })).toBeNull();
  });
  it('parseList drops malformed items and handles a missing data array', () => {
    expect(parseList({ data: [{ account_id: '1' }, {}, null] }, (x) => parseInsightRow('account', x))).toHaveLength(1);
    expect(parseList({ data: [] }, (x) => x)).toEqual([]);
    expect(parseList(null, (x) => x)).toEqual([]);
  });
});

describe('dates in the ad account time zone', () => {
  it('dateInZone shifts across midnight', () => {
    const d = new Date('2026-10-27T20:00:00Z'); // 01:30 on the 28th in Kolkata
    expect(dateInZone(d, 'Asia/Kolkata')).toBe('2026-10-28');
    expect(dateInZone(d, 'UTC')).toBe('2026-10-27');
  });
  it('lastDays is inclusive of today', () => {
    expect(lastDays(new Date('2026-10-27T20:00:00Z'), 'Asia/Kolkata', 7)).toEqual({ since: '2026-10-22', until: '2026-10-28' });
    expect(lastDays(new Date('2026-03-02T05:00:00Z'), 'UTC', 3)).toEqual({ since: '2026-02-28', until: '2026-03-02' });
  });
});
