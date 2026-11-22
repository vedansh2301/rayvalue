/**
 * Small per-country text dictionaries for place pages (labels and sentence frames only; every number comes from
 * place_facts). The same page component renders all three countries. No figures are typed here (CLAUDE.md rule 1).
 */
import type { PlaceCountryCode } from './config.ts';
import type { SectionId } from './gate.ts';

export interface SectionText {
  heading: (name: string) => string;
  intro?: string;
}

export interface PlaceDict {
  home: string;
  source: string;
  sourceOurData: string;
  checked: string;
  figuresChecked: string;
  periodTo: string;
  secondary: string;
  scopeRegion: (label: string) => string;
  scopeNetwork: (label: string) => string;
  geography: (label: string) => string;
  title: (name: string) => string;
  description: (name: string, region: string) => string;
  h1: (name: string) => string;
  intro: (name: string, region: string) => string;
  keyNumbersHeading: (name: string) => string;
  /** "1 kW of panels ... makes about 956 kWh a year" (value already formatted). */
  answerYield: (name: string, kwh: string, facing: string) => string;
  facing: { south: string; north: string };
  sections: Record<SectionId, SectionText>;
  /** Display label per fact key. */
  labels: Record<string, string>;
  /** Unit suffix (with its leading space) per fact key; keys not listed take the unit stored with the fact. */
  units: Record<string, string>;
  chart: { heading: (name: string) => string; intro: (annual: string | null) => string; title: (name: string) => string; month: string; kwh: string; pending: string; method: string; methodLine: (db: string, tilt: number | null, loss: number | null, facing: string) => string };
  disclaimer: string;
  methodologyLink: string;
  articlesHeading: string;
  articlesIndex: string;
  otherPlaces: (region: string) => string;
  hubTitle: (region: string) => string;
  hubDescription: (region: string) => string;
  hubH1: (region: string) => string;
  hubIntro: (region: string) => string;
  notFound: { title: string; h1: string; body: string; link: string };
  unavailable: { title: string; h1: string; body: string };
}

const en = {
  home: 'Home',
  source: 'Source',
  sourceOurData: 'Source: our data',
  checked: 'checked',
  figuresChecked: 'Figures checked on',
  periodTo: 'to',
  secondary: 'Secondary source, not used for our checks.',
  facing: { south: 'south', north: 'north' },
  methodologyLink: 'How RayValue sources its numbers',
  disclaimer: 'These are published statistics and a modelled estimate for the area, not a quote. Your own roof, shading, equipment and tariff decide your result.',
};

const GB_TEXT: PlaceDict = {
  ...en,
  scopeRegion: (l) => `Regional figure: ${l}`,
  scopeNetwork: (l) => `Network figure: ${l}`,
  geography: (l) => `Area used: ${l}`,
  title: (n) => `Solar panels in ${n}: local data and sources`,
  description: (n, r) => `Sunshine yield, home ownership, local installations and price-cap data for ${n}, ${r}. Every figure has its source and date.`,
  h1: (n) => `Solar panels in ${n}`,
  intro: (n, r) => `This page collects the sourced local numbers we hold for ${n} (${r}). Each figure names its publisher and the date we checked it.`,
  keyNumbersHeading: (n) => `Solar in ${n}: key numbers`,
  answerYield: (n, kwh, f) => `A 1 kWp array facing ${f} at the best tilt is modelled to generate about ${kwh} kWh a year in ${n}.`,
  sections: {
    yield: { heading: (n) => `How much sun ${n} gets` },
    tariff: { heading: () => 'Your electricity price cap region', intro: 'The Ofgem price cap sets the most a supplier can charge per unit on a standard variable tariff. Every unit you generate and use yourself avoids paying that rate.' },
    installs: { heading: (n) => `Solar already installed in ${n}`, intro: 'Counts of solar PV sites registered in the local authority area.' },
    housing: { heading: (n) => `Homes in ${n}`, intro: 'Solar is easiest on a house you own. These are Census figures for the local authority area.' },
    cost: { heading: () => 'What installs cost in this region', intro: 'Average total installed cost per kW from MCS-certified installations in the region. Your quote will differ with system size, roof and equipment.' },
    zone: { heading: () => '' },
    heating: { heading: () => '' },
  },
  labels: {
    solar_yield_kwh_per_kwp: 'Yearly output of 1 kWp of panels',
    price_cap_region: 'Ofgem price-cap region',
    price_cap_unit_rate_dd: 'Electricity unit rate under the price cap (direct debit)',
    price_cap_standing_charge_dd: 'Electricity standing charge under the price cap (direct debit)',
    pv_installations_cumulative: 'Solar PV sites in the local authority',
    pv_installations_per_1000_households: 'Solar PV sites per 1,000 households',
    pv_capacity_mw_cumulative: 'Installed solar PV capacity',
    homeownership_pct: 'Households that own their home',
    houses_pct: 'Households living in a house (detached, semi-detached or terraced)',
    avg_install_cost_per_kw_0_4kw_mean: 'Average installed cost per kW, systems up to 4 kW',
    avg_install_cost_per_kw_4_10kw_mean: 'Average installed cost per kW, systems of 4 to 10 kW',
  },
  units: {
    solar_yield_kwh_per_kwp: ' kWh a year per kWp',
    pv_installations_cumulative: ' sites',
    pv_installations_per_1000_households: '',
    pv_capacity_mw_cumulative: ' MW',
    avg_install_cost_per_kw_0_4kw_mean: ' per kW',
    avg_install_cost_per_kw_4_10kw_mean: ' per kW',
  },
  chart: {
    heading: (n) => `How much sun ${n} gets`,
    intro: (a) => `Modelled output of 1 kWp of rooftop solar, month by month, from the EU's PVGIS tool${a ? `: about ${a} kWh a year` : ''}. Real output depends on your roof, shading and equipment.`,
    title: (n) => `Modelled monthly solar output per kWp in ${n}`,
    month: 'Month',
    kwh: 'kWh per kWp',
    pending: 'Solar output estimates for this place are being verified.',
    method: 'Method',
    methodLine: (db, tilt, loss, facing) => [`${db} data`, tilt === null ? null : `panels tilted ${tilt}° (the best angle for the year)`, `facing ${facing}`, loss === null ? null : `${loss}% system losses`].filter(Boolean).join(', '),
  },
  articlesHeading: 'Read more',
  articlesIndex: 'All UK guides',
  otherPlaces: (r) => `Other places in ${r}`,
  hubTitle: (r) => `Solar panels in ${r}: places and local data`,
  hubDescription: (r) => `Local solar data for places in ${r}: sunshine yield, housing, installations and costs, each with its source and date.`,
  hubH1: (r) => `Solar panels in ${r}`,
  hubIntro: (r) => `Places in ${r} with sourced local solar data. Pick one to see the figures and where they come from.`,
  notFound: { title: 'Page not found', h1: 'We could not find that place', body: 'We do not have a page for that place yet.', link: 'See the UK guides' },
  unavailable: { title: 'Page temporarily unavailable', h1: 'This page is being verified', body: 'Our data is temporarily unavailable. Please try again in a few minutes.' },
};

const AU_TEXT: PlaceDict = {
  ...GB_TEXT,
  answerYield: (n, kwh, f) => `A 1 kW array facing ${f} at the best tilt is modelled to generate about ${kwh} kWh a year in ${n}.`,
  title: (n) => `Solar in ${n}: local yield, uptake and sources`,
  description: (n, r) => `Sunshine yield, home ownership, rooftop solar uptake and rebate zone for ${n}, ${r}. Every figure has its source and date.`,
  h1: (n) => `Solar in ${n}`,
  intro: (n, r) => `This page collects the sourced local numbers we hold for ${n}, ${r}. Each figure names its publisher and the date we checked it.`,
  sections: {
    yield: { heading: (n) => `How much sun ${n} gets` },
    tariff: { heading: () => 'Your electricity network and default price', intro: 'The Default Market Offer is the most a retailer can charge on a standing offer in this network area. Solar you use yourself avoids paying that rate.' },
    installs: { heading: (n) => `Rooftop solar and batteries around ${n}`, intro: 'Clean Energy Regulator counts for the postcode we use for this place. A city spans many postcodes, so treat the figure as a local sample, not a city total.' },
    housing: { heading: (n) => `Homes in ${n}`, intro: 'Solar is easiest on a house you own. These are Census 2021 figures for the area named under each line.' },
    cost: { heading: () => '' },
    zone: { heading: () => 'Your solar rebate zone', intro: 'The Small-scale Renewable Energy Scheme gives each postcode a zone rating, which sets how many certificates (STCs) a system can create.' },
    heating: { heading: () => '' },
  },
  labels: {
    solar_yield_kwh_per_kwp: 'Yearly output of 1 kW of panels, facing north',
    stc_zone: 'Solar rebate (STC) postcode zone',
    network_for_place: 'Distribution network (Default Market Offer area)',
    dmo_annual_price_flat: 'Default Market Offer, annual bill (flat tariff)',
    dmo_annual_usage_assumed: 'Annual usage the Default Market Offer bill assumes',
    dmo_flat_usage_rate: 'Default Market Offer, usage rate (flat tariff)',
    dmo_flat_supply_charge: 'Default Market Offer, daily supply charge (flat tariff)',
    cer_solar_pv_installations_postcode: 'Rooftop solar installations in the postcode (all years)',
    cer_solar_pv_capacity_postcode: 'Rooftop solar capacity in the postcode (all years)',
    cer_battery_installations_postcode: 'Home batteries installed in the postcode since 1 July 2025',
    homeownership_pct: 'Homes owned outright or with a mortgage',
    separate_house_pct: 'Homes that are separate houses',
    occupied_private_dwellings: 'Occupied private dwellings',
    separate_houses_postal_area: 'Occupied separate houses in the postcode area',
  },
  units: {
    solar_yield_kwh_per_kwp: ' kWh a year per kW',
    cer_solar_pv_installations_postcode: ' installations',
    cer_solar_pv_capacity_postcode: ' kW',
    cer_battery_installations_postcode: ' batteries',
    occupied_private_dwellings: ' homes',
  },
  chart: { ...GB_TEXT.chart, intro: (a) => `Modelled output of 1 kW of north-facing rooftop solar, month by month, from the EU's PVGIS tool${a ? `: about ${a} kWh a year` : ''}. Real output depends on your roof, shading and equipment.`, title: (n) => `Modelled monthly solar output per kW in ${n}`, kwh: 'kWh per kW' },
  articlesIndex: 'All Australian guides',
  otherPlaces: (r) => `Other places in ${r}`,
  hubTitle: (r) => `Solar in ${r}: places and local data`,
  hubDescription: (r) => `Local solar data for places in ${r}: sunshine yield, housing, rooftop solar uptake and rebate zones, each with its source and date.`,
  hubH1: (r) => `Solar in ${r}`,
  hubIntro: (r) => `Places in ${r} with sourced local solar data. Pick one to see the figures and where they come from.`,
  notFound: { title: 'Page not found', h1: 'We could not find that place', body: 'We do not have a page for that place yet.', link: 'See the Australian guides' },
};

const DE_TEXT: PlaceDict = {
  home: 'Startseite',
  source: 'Quelle',
  sourceOurData: 'Quelle: eigene Daten',
  checked: 'geprüft am',
  figuresChecked: 'Zahlen geprüft am',
  periodTo: 'bis',
  secondary: 'Sekundärquelle, für unsere Prüfung nicht verwendet.',
  scopeRegion: (l) => `Regionaler Wert: ${l}`,
  scopeNetwork: (l) => `Netzgebiet: ${l}`,
  geography: (l) => `Gebiet: ${l}`,
  facing: { south: 'Süden', north: 'Norden' },
  title: (n) => `Photovoltaik in ${n}: lokale Daten mit Quellen`,
  description: (n, r) => `Sonnenertrag, Eigentümerquote, Heizungsstruktur und PV-Anlagen in ${n}, ${r}. Jede Zahl mit Quelle und Prüfdatum.`,
  h1: (n) => `Photovoltaik in ${n}`,
  intro: (n, r) => `Diese Seite sammelt die belegten lokalen Zahlen zu ${n} (${r}). Jede Zahl nennt den Herausgeber und das Datum, an dem wir sie geprüft haben.`,
  keyNumbersHeading: (n) => `Solar in ${n}: die wichtigsten Zahlen`,
  answerYield: (n, kwh, f) => `Eine Anlage mit 1 kWp, nach ${f} ausgerichtet und optimal geneigt, erzeugt in ${n} laut Modell etwa ${kwh} kWh im Jahr.`,
  sections: {
    yield: { heading: (n) => `Wie viel Sonne ${n} bekommt` },
    tariff: { heading: () => '' },
    installs: { heading: (n) => `Photovoltaik, die in ${n} schon läuft`, intro: 'Anzahl der im Marktstammdatenregister gemeldeten Solaranlagen in Betrieb in der Gemeinde, ohne Unterscheidung nach Größe.' },
    housing: { heading: (n) => `Wohnen in ${n}`, intro: 'Solar lässt sich am einfachsten auf dem eigenen Haus umsetzen. Die Zahlen stammen aus dem Zensus 2022.' },
    cost: { heading: () => '' },
    zone: { heading: () => '' },
    heating: { heading: (n) => `Heizung in ${n}`, intro: 'Wer mit Wärmepumpe oder Solarwärme heizt, kann selbst erzeugten Strom oft besser nutzen.' },
  },
  labels: {
    solar_yield_kwh_per_kwp: 'Jahresertrag von 1 kWp Solarmodulen',
    owner_occupier_rate_zensus2022: 'Eigentümerquote (Wohnungen, die ihre Eigentümer selbst bewohnen)',
    single_dwelling_building_share: 'Wohngebäude mit nur einer Wohnung',
    heatpump_solar_heated_building_share: 'Gebäude mit Wohnraum, die überwiegend mit Solar-/Geothermie oder Wärmepumpe heizen',
    mastr_pv_units_in_operation: 'Solaranlagen in Betrieb im Marktstammdatenregister',
  },
  units: {
    solar_yield_kwh_per_kwp: ' kWh im Jahr pro kWp',
    mastr_pv_units_in_operation: ' Anlagen',
  },
  chart: {
    heading: (n) => `Wie viel Sonne ${n} bekommt`,
    intro: (a) => `Modellierter Ertrag von 1 kWp Dach-Photovoltaik pro Monat, berechnet mit dem EU-Werkzeug PVGIS${a ? `: etwa ${a} kWh im Jahr` : ''}. Der tatsächliche Ertrag hängt von Dach, Verschattung und Technik ab.`,
    title: (n) => `Modellierter monatlicher Solarertrag pro kWp in ${n}`,
    month: 'Monat',
    kwh: 'kWh pro kWp',
    pending: 'Die Ertragsschätzung für diesen Ort wird noch geprüft.',
    method: 'Methode',
    methodLine: (db, tilt, loss, facing) => [`${db}-Daten`, tilt === null ? null : `${tilt}° Neigung (bester Jahreswinkel)`, `Ausrichtung nach ${facing}`, loss === null ? null : `${loss} % Systemverluste`].filter(Boolean).join(', '),
  },
  disclaimer: 'Das sind veröffentlichte Statistiken und eine Modellrechnung für die Gegend, kein Angebot. Ihr Dach, die Verschattung, die Technik und Ihr Tarif entscheiden über Ihr Ergebnis.',
  methodologyLink: 'So belegt RayValue seine Zahlen',
  articlesHeading: 'Weiterlesen',
  articlesIndex: 'Alle Ratgeber für Deutschland',
  otherPlaces: (r) => `Weitere Orte in ${r}`,
  hubTitle: (r) => `Photovoltaik in ${r}: Orte und lokale Daten`,
  hubDescription: (r) => `Lokale Solardaten für Orte in ${r}: Sonnenertrag, Wohnen, Heizung und PV-Anlagen, jeweils mit Quelle und Datum.`,
  hubH1: (r) => `Photovoltaik in ${r}`,
  hubIntro: (r) => `Orte in ${r} mit belegten lokalen Solardaten. Wählen Sie einen Ort, um die Zahlen und ihre Quellen zu sehen.`,
  notFound: { title: 'Seite nicht gefunden', h1: 'Diesen Ort haben wir nicht gefunden', body: 'Für diesen Ort gibt es noch keine Seite.', link: 'Zu den Ratgebern für Deutschland' },
  unavailable: { title: 'Seite vorübergehend nicht verfügbar', h1: 'Diese Seite wird noch geprüft', body: 'Unsere Daten sind vorübergehend nicht erreichbar. Bitte versuchen Sie es in ein paar Minuten erneut.' },
};

export const PLACE_TEXT: Readonly<Record<PlaceCountryCode, PlaceDict>> = { GB: GB_TEXT, DE: DE_TEXT, AU: AU_TEXT };
