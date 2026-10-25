import { describe, expect, it } from 'vitest';
import { billMeets, chooseBuyers, countByBuyer, coversZip, dedupeCutoff, findDuplicate, ineligibleReason, isSuppressed, statusAfterRouting, utcDayStart, withinBusinessHours, type Buyer, type RoutableLead } from './eligibility';

const buyer = (o: Partial<Buyer> & { id: string }): Buyer => ({
  created_at: '2026-01-01T00:00:00Z',
  name: o.id,
  legal_name: `${o.id} LLC`,
  states: ['FL'],
  zips: [],
  active: true,
  accepted_timelines: ['asap', '1_3_months', '3_6_months'],
  min_bill_bucket: null,
  homeowner_only: true,
  exclusive: false,
  daily_cap: null,
  price: null,
  delivery_method: 'email',
  delivery_target: 'a@b.co',
  delivery_target_env: null,
  webhook_secret_env: null,
  fallback_email_env: null,
  business_hours: null,
  ...o,
});
const lead: RoutableLead = { zip: '33101', state: 'FL', homeowner: true, timeline: 'asap', bill_bucket: '200_300', consented_installers: ['a LLC', 'b LLC', 'c LLC', 'd LLC', 'x LLC'] };
const none = new Map<string, number>();

describe('coversZip / billMeets', () => {
  it('explicit ZIP list wins, empty list = whole state', () => {
    expect(coversZip({ zips: ['33101'], states: ['CA'] }, '33101', 'FL')).toBe(true);
    expect(coversZip({ zips: ['33102'], states: ['FL'] }, '33101', 'FL')).toBe(false);
    expect(coversZip({ zips: [], states: ['FL'] }, '33101', 'FL')).toBe(true);
    expect(coversZip({ zips: [], states: ['CA'] }, '33101', 'FL')).toBe(false);
  });
  it('bill minimum', () => {
    expect(billMeets('200_300', null)).toBe(true);
    expect(billMeets('200_300', '150_200')).toBe(true);
    expect(billMeets('150_200', '200_300')).toBe(false);
    expect(billMeets(null, '150_200')).toBe(false);
  });
});

describe('ineligibleReason', () => {
  it('reports the first failing rule', () => {
    expect(ineligibleReason(buyer({ id: 'a' }), lead, 0)).toBeNull();
    expect(ineligibleReason(buyer({ id: 'a', active: false }), lead, 0)).toBe('inactive');
    expect(ineligibleReason(buyer({ id: 'a', states: ['CA'] }), lead, 0)).toBe('zip');
    expect(ineligibleReason(buyer({ id: 'zz' }), lead, 0)).toBe('no_consent');
    expect(ineligibleReason(buyer({ id: 'a' }), { ...lead, homeowner: false }, 0)).toBe('not_homeowner');
    expect(ineligibleReason(buyer({ id: 'a', homeowner_only: false }), { ...lead, homeowner: false }, 0)).toBeNull();
    expect(ineligibleReason(buyer({ id: 'a', accepted_timelines: ['asap'] }), { ...lead, timeline: '3_6_months' }, 0)).toBe('timeline');
    expect(ineligibleReason(buyer({ id: 'a', min_bill_bucket: '300_400' }), lead, 0)).toBe('bill');
    expect(ineligibleReason(buyer({ id: 'a', daily_cap: 2 }), lead, 2)).toBe('daily_cap');
    expect(ineligibleReason(buyer({ id: 'a', daily_cap: 2 }), lead, 1)).toBeNull();
  });
  it('a buyer the person did not consent to is never eligible', () => {
    expect(ineligibleReason(buyer({ id: 'a' }), { ...lead, consented_installers: [] }, 0)).toBe('no_consent');
  });
});

describe('chooseBuyers', () => {
  it('takes at most 3, highest price first, unknown price last', () => {
    const bs = [buyer({ id: 'a', price: 20 }), buyer({ id: 'b', price: null }), buyer({ id: 'c', price: '35.50' }), buyer({ id: 'd', price: 10 }), buyer({ id: 'x', price: 5 })];
    expect(chooseBuyers(bs, lead, none).buyers.map((b) => b.id)).toEqual(['c', 'a', 'd']);
  });
  it('exclusive top buyer gets it alone', () => {
    const bs = [buyer({ id: 'a', price: 20 }), buyer({ id: 'b', price: 50, exclusive: true })];
    expect(chooseBuyers(bs, lead, none)).toMatchObject({ exclusive: true, buyers: [{ id: 'b' }] });
  });
  it('an exclusive buyer that is not top-ranked is skipped from the shared set', () => {
    const bs = [buyer({ id: 'a', price: 50 }), buyer({ id: 'b', price: 20, exclusive: true }), buyer({ id: 'c', price: 10 })];
    expect(chooseBuyers(bs, lead, none).buyers.map((b) => b.id)).toEqual(['a', 'c']);
  });
  it('daily cap excludes a full buyer; nobody eligible -> empty', () => {
    const bs = [buyer({ id: 'a', daily_cap: 1 })];
    expect(chooseBuyers(bs, lead, new Map([['a', 1]])).buyers).toEqual([]);
    expect(chooseBuyers([], lead, none)).toEqual({ buyers: [], exclusive: false });
  });
  it('ties break by age then id (deterministic)', () => {
    const bs = [buyer({ id: 'b', created_at: '2026-02-01T00:00:00Z' }), buyer({ id: 'a', created_at: '2026-03-01T00:00:00Z' }), buyer({ id: 'c', created_at: '2026-02-01T00:00:00Z' })];
    expect(chooseBuyers(bs, lead, none).buyers.map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('countByBuyer / utcDayStart', () => {
  it('counts non-abandoned deliveries per buyer', () => {
    const m = countByBuyer([{ buyer_id: 'a', status: 'delivered' }, { buyer_id: 'a', status: 'failed' }, { buyer_id: 'a', status: 'abandoned' }, { buyer_id: 'b', status: 'queued' }]);
    expect([m.get('a'), m.get('b')]).toEqual([2, 1]);
  });
  it('UTC day start', () => expect(utcDayStart(new Date('2026-10-26T23:59:59Z'))).toBe('2026-10-26T00:00:00.000Z'));
});

describe('withinBusinessHours', () => {
  const hours = { timezone: 'America/New_York', days: [1, 2, 3, 4, 5], open: '09:00', close: '17:00' };
  it('null = always; otherwise in the buyer timezone', () => {
    expect(withinBusinessHours(null, new Date())).toBe(true);
    expect(withinBusinessHours(hours, new Date('2026-10-26T15:00:00Z'))).toBe(true); // Mon 11:00 ET
    expect(withinBusinessHours(hours, new Date('2026-10-26T23:00:00Z'))).toBe(false); // Mon 19:00 ET
    expect(withinBusinessHours(hours, new Date('2026-10-25T15:00:00Z'))).toBe(false); // Sunday
  });
  it('malformed hours = closed', () => expect(withinBusinessHours({ nope: 1 }, new Date())).toBe(false));
});

describe('findDuplicate', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const prior = (o: Partial<{ id: string; created_at: string; status: string; phone: string; email: string }>) => ({ id: 'p', created_at: '2026-10-20T00:00:00Z', status: 'sent', phone: '+13052010123', email: 'a@x.co', ...o });
  it('same phone or same email (any case) within 30 days', () => {
    expect(findDuplicate([prior({})], { phone: '+13052010123', email: 'zzz@x.co' }, now)?.id).toBe('p');
    expect(findDuplicate([prior({})], { phone: '+19998887777', email: 'A@X.co' }, now)?.id).toBe('p');
    expect(findDuplicate([prior({})], { phone: '+19998887777', email: 'zzz@x.co' }, now)).toBeNull();
  });
  it('older than 30 days is not a duplicate; duplicates/disqualified priors are ignored', () => {
    expect(findDuplicate([prior({ created_at: '2026-09-20T00:00:00Z' })], { phone: '+13052010123', email: 'q@x.co' }, now)).toBeNull();
    expect(findDuplicate([prior({ status: 'duplicate' }), prior({ status: 'disqualified' })], { phone: '+13052010123', email: 'q@x.co' }, now)).toBeNull();
  });
  it('points at the earliest original', () => {
    expect(findDuplicate([prior({ id: 'late', created_at: '2026-10-25T00:00:00Z' }), prior({ id: 'early', created_at: '2026-10-10T00:00:00Z' })], { phone: '+13052010123', email: 'q@x.co' }, now)?.id).toBe('early');
  });
  it('cutoff is 30 days back', () => expect(dedupeCutoff(now)).toBe('2026-09-26T12:00:00.000Z'));
});

describe('isSuppressed', () => {
  it('do_not_sell and delete requests on the lead email or a same-phone email suppress; rejected do not', () => {
    const emails = ['a@x.co', 'other@x.co'];
    expect(isSuppressed([{ email: 'A@x.co', request: 'do_not_sell', status: 'new' }], emails)).toBe(true);
    expect(isSuppressed([{ email: 'other@x.co', request: 'delete', status: 'done' }], emails)).toBe(true);
    expect(isSuppressed([{ email: 'a@x.co', request: 'access', status: 'new' }], emails)).toBe(false);
    expect(isSuppressed([{ email: 'a@x.co', request: 'do_not_sell', status: 'rejected' }], emails)).toBe(false);
    expect(isSuppressed([{ email: 'zz@x.co', request: 'do_not_sell', status: 'new' }], emails)).toBe(false);
  });
});

describe('statusAfterRouting', () => {
  it('maps outcomes', () => {
    expect(statusAfterRouting({ kind: 'no_buyers' })).toEqual({ status: 'new', reason: 'no_eligible_buyer' });
    expect(statusAfterRouting({ kind: 'results', delivered: 1, queued: 0, failed: 2 }).status).toBe('sent');
    expect(statusAfterRouting({ kind: 'results', delivered: 0, queued: 1, failed: 0 }).status).toBe('sent');
    expect(statusAfterRouting({ kind: 'results', delivered: 0, queued: 0, failed: 2 })).toEqual({ status: 'new', reason: 'delivery_failed' });
  });
});
