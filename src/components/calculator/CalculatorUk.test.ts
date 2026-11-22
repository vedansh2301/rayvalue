/** Server-render smoke test of the UK island with the migration 0035 snapshot: the form renders in en-GB with every region, offer and install choice. */
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import snapshot from '../../lib/calculator/__fixtures__/gb-0035.json';
import { createGlobalRepo } from '../../lib/db/repo-global';
import { loadUkPageData } from '../../lib/calculator/uk-page-data';
import CalculatorUk from './CalculatorUk';

const tables = snapshot as unknown as Record<string, Record<string, unknown>[]>;
const fakeFetch = (async (input: RequestInfo | URL) => {
  const u = new URL(String(input));
  let rows = tables[u.pathname.replace('/rest/v1/', '')] ?? [];
  for (const [k, v] of u.searchParams) if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3));
  return new Response(JSON.stringify(rows), { status: 200 });
}) as unknown as typeof fetch;
const repo = () => createGlobalRepo({ env: { url: 'https://x.supabase.co/', key: 'k' }, fetch: fakeFetch });

describe('CalculatorUk (server render)', () => {
  it('renders the form with 14 regions, the export offers with their pence rates, both VAT install choices, and a battery option', async () => {
    const d = await loadUkPageData('2026-11-22', repo());
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const html = renderToString(h(CalculatorUk, d.props));
    expect(html.match(/<option value="gb-cap-/g)).toHaveLength(14);
    expect(html).toContain('London');
    expect(html).toContain('Octopus Smart Export Guarantee (fixed): 4.1p per kWh');
    expect(html).toContain('EDF SEG Export Variable: 2p per kWh');
    expect(html).toContain('Installed by 31 March 2027');
    expect(html).toContain('Installed from 1 April 2027');
    expect(html).toContain('VAT on the installation: 5%');
    expect(html).toContain('Priced from official MCS retrofit battery data');
    expect(html).toContain('14 regions');
    expect(html).not.toContain('$');
    expect(html).not.toMatch(/ZIP|federal/i);
  });
  it('disables the battery option when no battery cost is sourced', async () => {
    const d = await loadUkPageData('2026-11-22', repo());
    if (!d.ok) throw new Error('load');
    const line = { ...d.props.costs.battery_installed_cost.line, low: null, likely: null, high: null, source_url: null, verified_on: null, verification: 'unverified' as const };
    const html = renderToString(h(CalculatorUk, { ...d.props, costs: { ...d.props.costs, battery_installed_cost: { ...d.props.costs.battery_installed_cost, line } } }));
    expect(html).toContain('No sourced UK battery cost yet');
    expect(html).toMatch(/id="uk-battery-1"[^>]*disabled/);
  });
});
