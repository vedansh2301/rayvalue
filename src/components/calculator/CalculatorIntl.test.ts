/** Server-render smoke tests of the shared island with the migration 0037 snapshots: German and Australian forms render in their own language and currency. */
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import au from '../../lib/calculator/__fixtures__/au-0037.json';
import de from '../../lib/calculator/__fixtures__/de-0037.json';
import { createGlobalRepo } from '../../lib/db/repo-global';
import { loadCalculatorPageData } from '../../lib/calculator/uk-page-data';
import CalculatorIntl from './CalculatorIntl';

type Tables = Record<string, Record<string, unknown>[]>;
const repo = (t: unknown) =>
  createGlobalRepo({
    env: { url: 'https://x.supabase.co/', key: 'k' },
    fetch: (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      let rows = (t as Tables)[u.pathname.replace('/rest/v1/', '')] ?? [];
      for (const [k, v] of u.searchParams) if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      return new Response(JSON.stringify(rows), { status: 200 });
    }) as unknown as typeof fetch,
  });
const render = async (country: 'DE' | 'AU', t: unknown, today = '2026-11-22') => {
  const d = await loadCalculatorPageData(country, today, repo(t));
  if (!d.ok) throw new Error('load');
  return { html: renderToString(h(CalculatorIntl, d.props)), props: d.props };
};

describe('CalculatorIntl: Germany', () => {
  it('renders in German with 16 Bundesländer, EEG rates in ct/kWh, one install period, a 10 kWh battery option, no dollar or pound signs', async () => {
    const { html } = await render('DE', de);
    expect(html.match(/<option value="de-(?!eeg)/g)).toHaveLength(16);
    expect(html.match(/name="de-offer"/g)).toHaveLength(2);
    expect(html).toContain('Bayern');
    expect(html).toContain('Ihr Bundesland');
    expect(html).toContain('Bundesland wählen');
    expect(html).toContain('EEG-Einspeisevergütung: Überschusseinspeisung (Teileinspeisung), bis 10 kW');
    expect(html).toContain('7,7 ct/kWh');
    expect(html).toContain('Volleinspeisung, bis 10 kW');
    expect(html).toContain('12,22 ct/kWh');
    expect(html).toContain('Inbetriebnahme bis 31. Dezember 2026');
    expect(html).toMatch(/Umsatzsteuer auf die Installation: 0\s%/);
    expect(html).toContain('einen Vergütungssatz für 2027 gibt es noch nicht');
    expect(html).toContain('1 Speicher (10 kWh)');
    expect(html).toContain('id="de-region"');
    expect(html).not.toMatch(/[$£]/);
    expect(html).not.toMatch(/ZIP|federal|Ofgem/i);
  });
  it('after the EEG rates end no install period is offered', async () => {
    const { html } = await render('DE', de, '2027-01-10');
    expect(html).not.toContain('de-install-');
  });
});

describe('CalculatorIntl: Australia', () => {
  it('renders in Australian English with 7 networks, cents per kWh, two install periods with the battery rebate per kWh, and a flagged secondary battery price', async () => {
    const { html } = await render('AU', au);
    expect(html.match(/<option value="au-/g)).toHaveLength(7);
    expect(html.match(/name="au-offer"/g)).toHaveLength(6);
    expect(html).toContain('Ausgrid network (NSW)');
    expect(html).toContain('New South Wales: IPART all-day benchmark (2026-27)');
    expect(html).toContain('4.95 c per kWh');
    expect(html).toContain('Victoria: legal minimum (no minimum feed-in tariff)');
    expect(html).toContain('Installed by 31 December 2026');
    expect(html).toContain('Installed 1 January 2027 to 30 June 2027');
    expect(html).toContain('Battery rebate in this period: $269 per usable kWh');
    expect(html).toContain('Battery rebate in this period: $226 per usable kWh');
    expect(html).toContain('Priced from CHOICE (a secondary source)');
    expect(html).toContain('Energy Made Easy');
    expect(html).toMatch(/<label[^>]*>[\s\S]*?North<\/strong>/);
    expect(html).not.toMatch(/[£€]/);
    expect(html).not.toMatch(/ZIP|federal tax|Ofgem/i);
    expect(html).not.toContain('VAT on the installation');
  });
  it('after 30 June 2027 no install period is offered', async () => {
    const { html } = await render('AU', au, '2027-07-02');
    expect(html).not.toContain('au-install-');
  });
});
