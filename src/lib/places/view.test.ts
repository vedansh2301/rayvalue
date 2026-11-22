import { describe, expect, it } from 'vitest';
import { buildPlaceView, censusAreaFromNote, monthlyYield, pickFact } from './view';
import { dePlace, fact, monthlyFacts, place, regions } from './test-fixtures';

const gbRegion = regions[0]!;
const deRegion = regions[1]!;

describe('buildPlaceView', () => {
  it('returns null for an unpublished or under-sourced place', () => {
    expect(buildPlaceView(place({ published: false }), gbRegion)).toBeNull();
    expect(buildPlaceView(place({ place_facts: [fact('solar_yield_kwh_per_kwp')] }), gbRegion)).toBeNull();
  });

  it('GB: sections, UK number formats, latest period, regional scope and a key-numbers block with source + date per line', () => {
    const v = buildPlaceView(place(), gbRegion)!;
    expect(v.lang).toBe('en-GB');
    expect(v.path).toBe('/uk/solar-panels/north-east/newcastle-upon-tyne');
    expect(v.sections.map((s) => s.id)).toEqual(['yield', 'tariff', 'installs', 'housing', 'cost']);
    const tariff = v.sections.find((s) => s.id === 'tariff')!;
    // Latest period wins (Oct-Dec, no VAT), formatted with the data unit; the region label comes first.
    expect(tariff.lines.map((l) => l.value)).toEqual(['North Eastern England', '25.46 p/kWh (no VAT)']);
    expect(tariff.lines[1]!.note).toContain('Regional figure: North Eastern England');
    const installs = v.sections.find((s) => s.id === 'installs')!;
    expect(installs.lines[0]!.value).toBe('5,523 sites');
    expect(v.sections.find((s) => s.id === 'housing')!.lines[0]!.value).toBe('49.2%');
    expect(v.sections.find((s) => s.id === 'cost')!.lines[0]!.value).toBe('£1,540 per kW');
    expect(v.keyNumbers.items.length).toBeGreaterThanOrEqual(3);
    expect(v.keyNumbers.items.length).toBeLessThanOrEqual(5);
    for (const it of v.keyNumbers.items) {
      expect(it.source?.url).toMatch(/^https:\/\//);
      expect(it.checkedOn).toBe('22 November 2026');
    }
    expect(v.keyNumbers.answer).toContain('956 kWh');
    expect(v.keyNumbers.answer).toContain('south');
  });

  it('chart: monthly values and localized month labels, with a method line from the note', () => {
    const v = buildPlaceView(place(), gbRegion)!;
    const chart = v.sections[0]!.chart!;
    expect(chart.monthly).toHaveLength(12);
    expect(chart.months[0]).toBe('Jan');
    expect(chart.annual).toBe('956');
    expect(chart.method).toBe('PVGIS-SARAH3 data, panels tilted 43° (the best angle for the year), facing south, 14% system losses');
  });

  it('DE: German labels, German number formats, lang=de and Zensus lines', () => {
    const v = buildPlaceView(dePlace(), deRegion)!;
    expect(v.lang).toBe('de');
    expect(v.path).toBe('/de/photovoltaik/bayern/muenchen');
    expect(v.h1).toBe('Photovoltaik in München');
    const installs = v.sections.find((s) => s.id === 'installs')!;
    expect(installs.lines[0]!.value).toBe('29.934 Anlagen');
    const housing = v.sections.find((s) => s.id === 'housing')!;
    expect(housing.lines[0]!.value).toBe('24,7 %');
    expect(v.keyNumbers.checkedOn).toBe('22. November 2026');
    expect(v.keyNumbers.answer).toContain('1.139 kWh');
    expect(v.sections[0]!.chart!.months[2]).toMatch(/^M(ä|a)r/);
  });

  it('shows only sourced lines: a fact without a source is dropped from the page', () => {
    const p = place();
    p.place_facts = p.place_facts.map((f) => (f.key === 'houses_pct' ? f : f)).concat(fact('houses_pct', { source_url: null }));
    const v = buildPlaceView(p, gbRegion)!;
    expect(v.sections.find((s) => s.id === 'housing')!.lines.map((l) => l.label)).not.toContain('Households living in a house (detached, semi-detached or terraced)');
  });

  it('flags a secondary-source line when it is the only one for its key', () => {
    const p = place();
    p.place_facts.push(fact('houses_pct', { value_num: 70, confidence: 'secondary' }));
    const line = buildPlaceView(p, gbRegion)!.sections.find((s) => s.id === 'housing')!.lines.find((l) => l.value === '70.0%')!;
    expect(line.note).toContain('Secondary source');
  });
});

describe('AU', () => {
  it('shows the Census area, the north-facing yield, the postcode note and the network tariff', () => {
    const au = place({
      id: 'a1', country: 'AU', region_code: 'NSW', slug: 'sydney', name: 'Sydney',
      place_facts: [
        fact('solar_yield_kwh_per_kwp', { value_num: 1559.5, note: 'db=PVGIS-ERA5;tilt=34;azimuth=1;loss=14' }),
        ...monthlyFacts(),
        fact('homeownership_pct', { value_num: 61, period: '2021-08-10', note: 'Census 2021 G37 (Greater Sydney (GCCSA)): occupied private dwellings 1,828,859' }),
        fact('stc_zone', { value_num: null, value_text: 'zone 3 (1.382)', period: '2020-01-01' }),
        fact('cer_solar_pv_installations_postcode', { value_num: 520, period: '2001/2026-09', note: 'Postcode 2150: Total Installation Quantity 520' }),
        fact('dmo_annual_price_flat', { value_num: 1899, unit: 'AUD/yr incl GST', scope: 'network', scope_label: 'Ausgrid', period: '2026-07-01/2027-06-30' }),
      ],
    });
    const v = buildPlaceView(au, regions[2]!)!;
    expect(v.path).toBe('/au/solar-payback/nsw/sydney');
    expect(v.keyNumbers.answer).toContain('facing north');
    const by = (id: string) => v.sections.find((s) => s.id === id)!;
    expect(by('housing').lines[0]!.note).toContain('Area used: Greater Sydney (GCCSA)');
    expect(by('installs').lines[0]!.value).toBe('520 installations');
    expect(by('installs').lines[0]!.note).toContain('Postcode 2150');
    expect(by('tariff').lines[0]!.value).toBe('1,899 AUD/yr incl GST');
    expect(by('tariff').lines[0]!.note).toContain('Network figure: Ausgrid');
    expect(by('yield').chart!.method).toContain('facing north');
  });
});

describe('helpers', () => {
  it('pickFact prefers primary, then the newest period', () => {
    const f = pickFact([fact('k', { period: '2024-01-01', value_num: 1 }), fact('k', { period: '2025-01-01', value_num: 2 }), fact('k', { period: '2026-01-01', value_num: 3, confidence: 'secondary' })], 'k');
    expect(f?.value_num).toBe(2);
    expect(pickFact([], 'k')).toBeNull();
  });

  it('monthlyYield needs all 12 sourced months', () => {
    expect(monthlyYield(monthlyFacts())).toHaveLength(12);
    expect(monthlyYield(monthlyFacts().slice(1))).toBeNull();
    expect(monthlyYield([...monthlyFacts().slice(1), fact('solar_yield_monthly_kwh_per_kwp', { period: 'm01', source_url: null })])).toBeNull();
  });

  it('censusAreaFromNote reads the ABS geography', () => {
    expect(censusAreaFromNote('Census 2021 G37 (Greater Sydney (GCCSA)): occupied private dwellings 1,828,859')).toBe('Greater Sydney (GCCSA)');
    expect(censusAreaFromNote('Postcode 2150: Total Installation Quantity 520')).toBeNull();
    expect(censusAreaFromNote(null)).toBeNull();
  });
});
