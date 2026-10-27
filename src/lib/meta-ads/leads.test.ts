import { describe, expect, it } from 'vitest';
import { breakdown, choiceKey, mapMetaLead, NONE, parseForm, sortNewest, unifyMetaLead, unifyWebsiteLead, type WebsiteLead } from './leads';

// The v1 form as GET /{page}/leadgen_forms returned it on 2026-10-27.
const form = parseForm({
  id: '991483813293141',
  name: 'RayValue solar estimate FL+CA v1',
  status: 'ACTIVE',
  leads_count: 0,
  questions: [
    { key: 'first_name', type: 'FIRST_NAME', label: 'First name' },
    { key: 'zip_code', type: 'ZIP', label: 'Zip code' },
    { key: 'homeowner', type: 'CUSTOM', label: 'Do you own your home?', options: [{ key: 'yes', value: 'Yes' }, { key: 'no', value: 'No' }] },
    {
      key: 'monthly_bill',
      type: 'CUSTOM',
      options: [
        { key: 'under_100', value: 'Under $100' },
        { key: '100_150', value: '$100–$150' },
        { key: '400_plus', value: '$400 or more' },
      ],
    },
    { key: 'timeline', type: 'CUSTOM', options: [{ key: 'asap', value: 'As soon as possible' }, { key: 'researching', value: 'Just researching' }] },
  ],
})!;

describe('parseForm', () => {
  it('keeps questions and options', () => {
    expect(form.id).toBe('991483813293141');
    expect(form.leadsCount).toBe(0);
    expect(form.questions.find((q) => q.key === 'homeowner')?.options).toEqual([{ key: 'yes', value: 'Yes' }, { key: 'no', value: 'No' }]);
  });
  it('null without an id', () => expect(parseForm({ name: 'x' })).toBeNull());
});

describe('choiceKey', () => {
  const bill = form.questions.find((q) => q.key === 'monthly_bill');
  it('maps a key or a label (dash variants, case) to the option key', () => {
    expect(choiceKey('100_150', bill)).toBe('100_150');
    expect(choiceKey('$100-$150', bill)).toBe('100_150');
    expect(choiceKey('$400 OR MORE', bill)).toBe('400_plus');
  });
  it('keeps an unknown answer as given and passes null through', () => {
    expect(choiceKey('something else', bill)).toBe('something else');
    expect(choiceKey(null, bill)).toBeNull();
    expect(choiceKey('x', undefined)).toBe('x');
  });
});

describe('mapMetaLead', () => {
  const raw = {
    id: 'L1',
    created_time: '2026-10-28T10:00:00+0000',
    ad_id: 'A',
    adset_id: 'S',
    campaign_id: 'C',
    form_id: '991483813293141',
    is_organic: false,
    platform: 'ig',
    field_data: [
      { name: 'first_name', values: ['Ana'] },
      { name: 'last_name', values: ['Diaz'] },
      { name: 'email', values: ['ana@example.com'] },
      { name: 'phone_number', values: ['+13055550100'] },
      { name: 'zip_code', values: ['33101'] },
      { name: 'homeowner', values: ['Yes'] },
      { name: 'monthly_bill', values: ['$100–$150'] },
      { name: 'timeline', values: ['asap'] },
      { name: 'extra_q', values: ['a', 'b'] },
    ],
    custom_disclaimer_responses: [{ checkbox_key: 'tcpa_consent', is_checked: '1' }],
  };
  it('maps every field, derives FL from the ZIP and reads the consent checkbox', () => {
    expect(mapMetaLead(raw, form)).toEqual({
      id: 'L1',
      createdTime: '2026-10-28T10:00:00+0000',
      formId: '991483813293141',
      formName: 'RayValue solar estimate FL+CA v1',
      adId: 'A',
      adsetId: 'S',
      campaignId: 'C',
      isOrganic: false,
      platform: 'ig',
      firstName: 'Ana',
      lastName: 'Diaz',
      email: 'ana@example.com',
      phone: '+13055550100',
      zip: '33101',
      state: 'FL',
      homeowner: 'yes',
      billBucket: '100_150',
      timeline: 'asap',
      consent: true,
      other: { extra_q: 'a, b' },
    });
  });
  it('CA ZIP, unchecked consent ("") and a full_name fallback', () => {
    const l = mapMetaLead({ id: 'L2', created_time: 't', field_data: [{ name: 'full_name', values: ['Jo Ann Lee'] }, { name: 'zip_code', values: ['94103'] }], custom_disclaimer_responses: [{ checkbox_key: 'tcpa_consent', is_checked: '' }] }, form)!;
    expect(l.state).toBe('CA');
    expect(l.consent).toBe(false);
    expect(l.firstName).toBe('Jo');
    expect(l.lastName).toBe('Ann Lee');
  });
  it('no state outside FL/CA, consent null when the checkbox is absent', () => {
    const l = mapMetaLead({ id: 'L3', created_time: 't', field_data: [{ name: 'zip_code', values: ['10001'] }] }, null)!;
    expect(l.state).toBeNull();
    expect(l.consent).toBeNull();
    expect(l.formName).toBeNull();
  });
  it('null without id or created_time', () => {
    expect(mapMetaLead({ id: 'x' }, form)).toBeNull();
    expect(mapMetaLead(null, form)).toBeNull();
  });
});

const web = (over: Partial<WebsiteLead> = {}): WebsiteLead => ({
  id: 'W1',
  created_at: '2026-10-27T10:00:00Z',
  status: 'nurture',
  source: 'results',
  state: 'CA',
  zip: '94103',
  homeowner: true,
  bill_bucket: '200_300',
  timeline: '1_3_months',
  first_name: 'Sam',
  last_name: null,
  email: 's@example.com',
  phone: '+14155550100',
  utm_source: 'facebook',
  utm_medium: 'paid',
  utm_campaign: 'fl_reel',
  fbclid: 'x',
  landing_page: '/calculator/florida',
  ...over,
});

describe('unify + breakdown', () => {
  const meta = mapMetaLead({ id: 'L1', created_time: '2026-10-28T10:00:00+0000', field_data: [{ name: 'zip_code', values: ['33101'] }, { name: 'homeowner', values: ['No'] }] }, form)!;
  const rows = sortNewest([unifyWebsiteLead(web()), unifyWebsiteLead(web({ id: 'W2', created_at: '2026-10-26T00:00:00Z', utm_campaign: null, homeowner: false })), unifyMetaLead(meta)]);
  it('sorts newest first and marks the origin', () => {
    expect(rows.map((r) => r.id)).toEqual(['L1', 'W1', 'W2']);
    expect(rows[0]).toMatchObject({ origin: 'meta_form', source: 'meta_instant_form', state: 'FL', homeowner: 'no', utmCampaign: null, status: 'meta_form (not routed)' });
    expect(rows[1]).toMatchObject({ origin: 'website', homeowner: 'yes', utmCampaign: 'fl_reel', detail: 'landed /calculator/florida · fbclid' });
  });
  it('counts by field with Meta / website split, empty values as (none)', () => {
    expect(breakdown(rows, 'utmCampaign')).toEqual([
      { value: NONE, total: 2, meta: 1, website: 1 },
      { value: 'fl_reel', total: 1, meta: 0, website: 1 },
    ]);
    expect(breakdown(rows, 'homeowner')).toEqual([
      { value: 'no', total: 2, meta: 1, website: 1 },
      { value: 'yes', total: 1, meta: 0, website: 1 },
    ]);
    expect(breakdown([], 'state')).toEqual([]);
  });
  it('organic Meta leads get their own source', () => {
    const organic = mapMetaLead({ id: 'O', created_time: 't', is_organic: true }, form)!;
    expect(unifyMetaLead(organic).source).toBe('meta_form_organic');
  });
});
