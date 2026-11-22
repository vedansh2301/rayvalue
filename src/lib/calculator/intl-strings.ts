/**
 * Interface text of the shared international calculator island, one set per market (GB, DE, AU). Pure data and tiny
 * formatting functions: no calculation. The UK set is the original text of the UK island, word for word (its tests
 * render it). Every number shown comes from the engine or a database row; these strings only wrap them.
 *
 * The engine's own explanation lines (`result.assumptions`, `result.warnings`) are English; the German page labels
 * them as such rather than translating logic text inside src/lib/calc.
 */
import type { ChartLabels } from '../calc/chart';
import type { Shading } from '../calc/types';

export type Orientation = 'south' | 'east_west' | 'north';

export interface Choice<V extends string> {
  value: V;
  label: string;
  hint: string;
}

/** Words the payback display needs ("1 year", "More than 25 years"). */
export interface YearWords {
  one: string;
  many: string;
  moreThan: string;
  moreThanLower: string;
}

export interface SourceLabels {
  price: (name: string) => string;
  offer: (name: string) => string;
  solarCost: string;
  batteryCost: string;
  vat: string;
  incentive: (name: string) => string;
  location: (name: string) => string;
}

export interface CalcStrings {
  /** Text of the designed layout (progress, summary aside, next-step band). */
  ui: {
    sectionHeading: string;
    answered: (done: number, total: number) => string;
    yourEstimate: string;
    ready: string;
    toGo: (n: number) => string;
    summary: { region: string; usage: string; roof: string; shade: string; install: string; offer: string; battery: string };
    hintFree: string;
    hintRemaining: string;
    mapHint: string;
    perMonth: string;
    perYear: string;
    usageHint: string;
    nextTitle: string;
    nextCta: string;
    guidesHref: string;
    cardsHeading: string;
    howHeading: string;
    stepsToGo: string;
    battery: string;
    chooseOne: string;
  };
  /** Heading above the results ("Your solar estimate"). */
  resultsHeading: string;
  formLegend: string;
  /** Strip a boilerplate suffix from a region name for display. */
  regionName: (name: string) => string;
  regionLabel: string;
  regionHint: (count: number) => { before: string; linkLabel: string; after: string };
  /** Fixed help link for the region question; absent = use the region row's own source URL (GB). */
  regionHelpUrl?: string;
  regionPlaceholder: string;
  regionError: string;
  usageLegend: string;
  modeBill: string;
  modeKwh: string;
  usageLabelBill: string;
  usageLabelKwh: string;
  usageHintBill: string;
  usageHintKwh: string;
  usageErrors: {
    tooHigh: (max: string) => string;
    tooLow: string;
    emptyBill: string;
    notNumberBill: string;
    emptyKwh: string;
    badKwh: string;
    convert: string;
  };
  orientationLegend: string;
  orientations: Choice<Orientation>[];
  shadingLegend: string;
  shadings: Choice<Shading>[];
  installLegend: string;
  installHint: string;
  installBy: (end: string) => string;
  installBetween: (start: string, end: string) => string;
  installFrom: (start: string) => string;
  vatLine: (pct: string) => string;
  rebateLine: (perKwh: string) => string;
  /** Shown under the install choices when the offered dates stop at a horizon (text may be empty). */
  horizonNote: (until: string) => string | null;
  offerLabel: string;
  offerHint: string;
  offerPlaceholder: string;
  offerOption: (name: string, rate: string | null) => string;
  /** Minor units per kWh (pence, cents) as text: "4.1p per kWh". */
  offerRate: (minor: number) => string;
  offerError: string;
  batteryLegend: string;
  noBattery: { label: string; hint: string };
  oneBattery: { label: string; hintOk: string; hintNo: string };
  buttonSee: string;
  buttonUpdate: string;
  buttonBusy: string;
  liveBusy: string;
  noProduction: string;
  error: string;
  missingData: string;
  checkAnswers: string;
  summary: (a: { region: string; offer: string; install: string; battery: boolean }) => string;
  metrics: {
    payback: string;
    paybackNote: string;
    netSavings: (years: number) => string;
    netSavingsNote: string;
    upfront: string;
    upfrontNote: (hasIncentive: boolean) => string;
    systemSize: string;
    year1: string;
    year1Note: string;
    rebate: string;
    rebateNote: string;
  };
  /** The line about grants / rebates under the metrics. */
  grantNote: (appliedNames: string[]) => string;
  yieldNote: (place: string) => string;
  secondaryCostNote: string | null;
  warningsHeading: string;
  assumptionsSummary: (n: number) => string;
  sourcesSummary: (n: number) => string;
  sourceChecked: (date: string) => string;
  disclaimer: { before: string; link: string; after: string };
  changeAnswers: string;
  startOver: string;
  likelySr: string;
  likelyBadge: string;
  rangeWord: (low: string, high: string) => string;
  systemSizeText: (likely: string, low: string, high: string) => string;
  years: YearWords;
  sources: SourceLabels;
  chart: ChartLabels;
  chartText: {
    caption: (years: number) => string;
    yearsAxis: string;
    likelyLine: string;
    rangeBand: string;
    tableCaption: string;
    year: string;
    low: string;
    likely: string;
    high: string;
  };
}

const fullMoney = (n: number, sym: string): string => `${sym}${Math.round(n / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ------------------------------------------------------------------ GB (the original UK island text)

export const GB_STRINGS: CalcStrings = {
  ui: {
    sectionHeading: 'Your home and your electricity',
    answered: (d, t) => `${d} of ${t} answered`,
    yourEstimate: 'Your estimate',
    ready: 'Ready to calculate',
    toGo: (n) => `${n} ${n === 1 ? 'question' : 'questions'} to go`,
    summary: { region: 'Region', usage: 'Usage', roof: 'Roof', shade: 'Shade', install: 'VAT', offer: 'Export', battery: 'Battery' },
    hintFree: 'Free. No sign-up.',
    hintRemaining: 'Answer the remaining questions to see your low, likely and high ranges.',
    mapHint: 'Or tap your area on the map.',
    perMonth: 'per month',
    perYear: 'kWh a year',
    usageHint: 'Drag the slider, or type an exact amount.',
    nextTitle: 'Read the UK guides before you decide',
    nextCta: 'Read the UK guides',
    guidesHref: '/uk/guides',
    cardsHeading: 'Read before you buy in the UK',
    howHeading: 'How we calculated this',
    stepsToGo: 'Start',
    battery: 'Add a home battery?',
    chooseOne: 'Choose one of the options.',
  },
  resultsHeading: 'Your solar estimate',
  formLegend: 'Your home and your electricity',
  regionName: (name) => name.replace(/ \(Ofgem price cap region\)$/, ''),
  regionLabel: 'Your electricity price cap region',
  regionHint: (n) => ({
    before: `Ofgem sets a different price cap for each of ${n} regions. It is printed on your bill, or look it up from your postcode on `,
    linkLabel: 'Ofgem’s regional page',
    after: '.',
  }),
  regionPlaceholder: 'Choose your region',
  regionError: 'Choose your electricity price cap region.',
  usageLegend: 'How much electricity do you use?',
  modeBill: 'Monthly bill',
  modeKwh: 'Yearly kWh',
  usageLabelBill: 'Average monthly electricity bill',
  usageLabelKwh: 'Electricity used in a year',
  usageHintBill: 'A 12-month average works best, since bills change with the seasons. Electricity only, not gas.',
  usageHintKwh: 'The kWh total for the last 12 months, from your bill or supplier app.',
  usageErrors: {
    tooHigh: (max) => `Enter an amount up to ${max}.`,
    tooLow: 'Enter an amount greater than £0.',
    emptyBill: 'Enter your average monthly electricity bill.',
    notNumberBill: 'Enter a pound amount, like 90 or 90.50.',
    emptyKwh: 'Enter your yearly electricity use in kWh.',
    badKwh: 'Enter a number of kWh greater than 0, like 3100.',
    convert: 'We could not convert that yet. Enter your monthly bill instead.',
  },
  orientationLegend: 'Which way does the main roof face?',
  orientations: [
    { value: 'south', label: 'South', hint: 'Facing south, or close to it' },
    { value: 'east_west', label: 'East or west', hint: 'Facing east or west' },
    { value: 'north', label: 'North', hint: 'Facing north' },
  ],
  shadingLegend: 'How much shade does the roof get?',
  shadings: [
    { value: 'none', label: 'Little or none', hint: 'Open roof, full sun most of the day' },
    { value: 'some', label: 'Some', hint: 'Trees or buildings shade part of the day' },
    { value: 'heavy', label: 'Heavy', hint: 'Shaded for much of the day' },
  ],
  installLegend: 'When would the system be installed?',
  installHint: 'VAT on solar installation depends on the install date.',
  installBy: (end) => `Installed by ${end}`,
  installBetween: (start, end) => `Installed ${start} to ${end}`,
  installFrom: (start) => `Installed from ${start}`,
  vatLine: (pct) => `VAT on the installation: ${pct}`,
  rebateLine: (perKwh) => `Battery rebate in this period: ${perKwh} per usable kWh`,
  horizonNote: () => null,
  offerLabel: 'What are you paid for the electricity you export?',
  offerHint: 'Under the Smart Export Guarantee your supplier sets the rate. Pick the one you are on, or one you might choose. Some are only open to that supplier’s customers.',
  offerPlaceholder: 'Choose an export payment',
  offerOption: (name, rate) => `${name}${rate !== null ? `: ${rate}` : ' (no rate on this install date)'}`,
  offerRate: (p) => `${p}p per kWh`,
  offerError: 'Choose the export payment you are on or expect to be on.',
  batteryLegend: 'Add a home battery?',
  noBattery: { label: 'No battery', hint: 'Solar panels only' },
  oneBattery: { label: '1 battery', hintOk: 'Priced from official MCS retrofit battery data', hintNo: 'No sourced UK battery cost yet' },
  buttonSee: 'See my estimate',
  buttonUpdate: 'Update my estimate',
  buttonBusy: 'Calculating…',
  liveBusy: 'Calculating your estimate…',
  noProduction: 'We couldn’t get solar production data for your area right now. Please try again in a minute.',
  error: 'Something went wrong while calculating. Please try again.',
  missingData: 'We’re still verifying some of the data for this estimate, so we can’t show it yet.',
  checkAnswers: 'Please check your answers and try again.',
  summary: (a) => `For a home in ${a.region}, paid by ${a.offer}. ${a.install}. ${a.battery ? 'With one battery.' : 'Solar panels only.'}`,
  metrics: {
    payback: 'Payback',
    paybackNote: 'Range runs from shortest (best case) to longest',
    netSavings: (y) => `Net savings over ${y} years`,
    netSavingsNote: 'Bill savings and export payments, minus upfront cost',
    upfront: 'Upfront cost',
    upfrontNote: () => 'Including VAT, before any grant or loan',
    systemSize: 'System size',
    year1: 'First-year savings',
    year1Note: 'Lower bills plus export payments',
    rebate: 'Rebate deducted',
    rebateNote: 'Already taken off the cost in the payback',
  },
  grantNote: () => 'No grant or government payment is included: there is no universal UK solar grant. Loans, where offered, are not counted.',
  yieldNote: (place) => `Solar yield is looked up at ${place}, the place we use for your region.`,
  secondaryCostNote: null,
  warningsHeading: 'Worth knowing',
  assumptionsSummary: (n) => `How this estimate was built (${n} assumptions)`,
  sourcesSummary: (n) => `Where the numbers come from (${n} sources)`,
  sourceChecked: (d) => `, checked ${d}`,
  disclaimer: { before: 'Estimates are not a quote: installer prices, your actual usage and your supplier’s rates will differ. Read the ', link: 'methodology', after: '.' },
  changeAnswers: 'Change my answers',
  startOver: 'Start over',
  likelySr: 'Likely ',
  likelyBadge: 'likely',
  rangeWord: (low, high) => `Range ${low} to ${high}`,
  systemSizeText: (likely, low, high) => `${likely} (${low} to ${high})`,
  years: { one: 'year', many: 'years', moreThan: 'More than', moreThanLower: 'more than' },
  sources: {
    price: (n) => `Electricity price: ${n}`,
    offer: (n) => `Export payment: ${n}`,
    solarCost: 'Installed solar cost (DESNZ/MCS)',
    batteryCost: 'Installed battery cost (DESNZ/MCS)',
    vat: 'VAT on solar installation (HMRC)',
    incentive: (n) => `Incentive: ${n}`,
    location: (n) => `Coordinates used for solar yield (${n})`,
  },
  chart: {
    paysBack: (y) => `Pays back ~year ${y}`,
    costLabel: (c) => `Upfront cost ${fullMoney(c, '£')}`,
    title: (n) => `Cumulative bill savings over ${n} years compared with upfront cost`,
    desc: (a) =>
      `Likely cumulative savings reach about ${fullMoney(a.likely, '£')} by year ${a.years} (range ${fullMoney(a.low, '£')} to ${fullMoney(a.high, '£')}), against a likely upfront cost of ${fullMoney(a.cost, '£')}. ` +
      (a.crossingYears !== null ? `Savings pass the cost at about year ${a.crossingYears}.` : `Savings do not pass the cost within ${a.years} years.`),
  },
  chartText: {
    caption: (y) => `Savings vs. cost over ${y} years`,
    yearsAxis: 'Years',
    likelyLine: 'Likely cumulative savings',
    rangeBand: 'Low to high range',
    tableCaption: 'Cumulative bill savings by year (low, likely, high)',
    year: 'Year',
    low: 'Low',
    likely: 'Likely',
    high: 'High',
  },
};

// ------------------------------------------------------------------ AU

export const AU_STRINGS: CalcStrings = {
  ...GB_STRINGS,
  ui: { ...GB_STRINGS.ui, nextTitle: 'Read the Australian guides before you decide', nextCta: 'Read the Australian guides', guidesHref: '/au/guides', cardsHeading: 'Read before you buy in Australia', summary: { ...GB_STRINGS.ui.summary, region: 'Network', install: 'Install date', offer: 'Feed-in' }, mapHint: '' },
  regionName: (name) => name,
  regionLabel: 'Your electricity network or tariff area',
  regionHint: () => ({
    before: 'The network (distributor) is named on your electricity bill, or enter your address on ',
    linkLabel: 'Energy Made Easy',
    after: '. Prices shown are the regulated caps for standing offers (the Default Market Offer in NSW, south-east Queensland and South Australia); your own plan will differ.',
  }),
  regionHelpUrl: 'https://www.energymadeeasy.gov.au/',
  regionPlaceholder: 'Choose your network',
  regionError: 'Choose your electricity network.',
  usageLabelBill: 'Average monthly electricity bill',
  usageHintBill: 'A 12-month average works best, since bills change with the seasons. Electricity only, not gas. Quarterly bills: divide by three.',
  usageHintKwh: 'The kWh total for the last 12 months, from your bill or retailer app.',
  usageErrors: {
    ...GB_STRINGS.usageErrors,
    tooLow: 'Enter an amount greater than $0.',
    notNumberBill: 'Enter a dollar amount, like 180 or 180.50.',
    badKwh: 'Enter a number of kWh greater than 0, like 5500.',
  },
  orientationLegend: 'Which way does the main roof face?',
  orientations: [
    { value: 'south', label: 'North', hint: 'Facing north, the best direction in Australia, or close to it' },
    { value: 'east_west', label: 'East or west', hint: 'Facing east or west' },
    { value: 'north', label: 'South', hint: 'Facing south' },
  ],
  installLegend: 'When would the battery be installed?',
  installHint: 'The federal battery rebate steps down on 1 January 2027, and regulated feed-in rates are set each financial year. The date the battery is certified decides the rebate.',
  installBy: (end) => `Installed by ${end}`,
  horizonNote: (until) => `Estimates cover installs up to ${until}: later feed-in rates and the 2027-28 rebate value are not published yet.`,
  offerLabel: 'What are you paid for the electricity you export?',
  offerHint: 'Feed-in rates are set per state or retailer. Pick the sourced rate closest to yours: retailers often pay more than the regulated or minimum rate, so check your own plan on Energy Made Easy.',
  offerRate: (c) => `${c} c per kWh`,
  offerOption: (name, rate) => `${name}${rate !== null ? `: ${rate}` : ' (no rate on this install date)'}`,
  noBattery: { label: 'No battery', hint: 'Solar panels only' },
  oneBattery: { label: '1 battery (10 kWh)', hintOk: 'Priced from CHOICE (a secondary source), before the federal rebate', hintNo: 'No sourced Australian battery cost yet' },
  metrics: {
    ...GB_STRINGS.metrics,
    upfrontNote: (hasIncentive) => (hasIncentive ? 'Including GST, before the battery rebate' : 'Including GST, before any rebate or loan'),
    rebateNote: 'Already taken off the cost in the payback and net savings',
  },
  grantNote: (applied) =>
    applied.length > 0
      ? `Included: the federal Cheaper Home Batteries rebate for the date you chose (a point-of-sale discount, valued at the STC price). Not included: state and territory rebates, virtual power plant incentives and loans.`
      : 'No rebate is applied here. Solar prices are shown after the point-of-sale small-scale technology certificate (STC) discount. State and territory rebates, virtual power plant incentives and loans are not included.',
  yieldNote: (place) => `Solar yield is looked up at ${place}, the place we use for your network. North-facing panels at the best tilt are assumed before your roof direction and shade.`,
  secondaryCostNote: 'Australian installed prices come from secondary sources (SolarQuotes for solar, CHOICE for batteries), not an official statistic, so treat the cost range as indicative.',
  disclaimer: { before: 'Estimates are not a quote: installer prices, your actual usage and your retailer’s rates will differ. Read the ', link: 'methodology', after: '.' },
  sources: {
    price: (n) => `Electricity price: ${n}`,
    offer: (n) => `Export payment: ${n}`,
    solarCost: 'Installed solar cost (SolarQuotes, secondary source)',
    batteryCost: 'Installed battery cost (CHOICE, secondary source)',
    vat: 'GST',
    incentive: (n) => `Rebate: ${n}`,
    location: (n) => `Coordinates used for solar yield (${n})`,
  },
  chart: {
    ...GB_STRINGS.chart,
    costLabel: (c) => `Upfront cost ${fullMoney(c, '$')}`,
    desc: (a) =>
      `Likely cumulative savings reach about ${fullMoney(a.likely, '$')} by year ${a.years} (range ${fullMoney(a.low, '$')} to ${fullMoney(a.high, '$')}), against a likely upfront cost of ${fullMoney(a.cost, '$')}. ` +
      (a.crossingYears !== null ? `Savings pass the cost at about year ${a.crossingYears}.` : `Savings do not pass the cost within ${a.years} years.`),
  },
};

// ------------------------------------------------------------------ DE

const deNum = (n: number): string => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n);
const deFull = (n: number): string => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.round(n / 100) * 100)} €`;

export const DE_STRINGS: CalcStrings = {
  ui: {
    sectionHeading: 'Ihr Haus und Ihr Strom',
    answered: (d, t) => `${d} von ${t} beantwortet`,
    yourEstimate: 'Ihre Schätzung',
    ready: 'Bereit zur Berechnung',
    toGo: (n) => `Noch ${n} ${n === 1 ? 'Frage' : 'Fragen'}`,
    summary: { region: 'Bundesland', usage: 'Verbrauch', roof: 'Dach', shade: 'Schatten', install: 'Inbetriebnahme', offer: 'Einspeisung', battery: 'Speicher' },
    hintFree: 'Kostenlos. Ohne Anmeldung.',
    hintRemaining: 'Beantworten Sie die restlichen Fragen, um Ihre niedrigen, wahrscheinlichen und hohen Werte zu sehen.',
    mapHint: '',
    perMonth: 'pro Monat',
    perYear: 'kWh pro Jahr',
    usageHint: 'Schieberegler ziehen oder einen genauen Wert eintippen.',
    nextTitle: 'Lesen Sie die Ratgeber, bevor Sie entscheiden',
    nextCta: 'Zu den Ratgebern',
    guidesHref: '/de/guides',
    cardsHeading: 'Lesen, bevor Sie kaufen',
    howHeading: 'So haben wir gerechnet',
    stepsToGo: 'Start',
    battery: 'Stromspeicher dazu?',
    chooseOne: 'Wählen Sie eine der Möglichkeiten.',
  },
  resultsHeading: 'Ihre Photovoltaik-Schätzung',
  formLegend: 'Ihr Haus und Ihr Strom',
  regionName: (name) => name,
  regionLabel: 'Ihr Bundesland',
  regionHint: () => ({
    before: 'Der Strompreis ist der bundesweite Durchschnitt für Haushalte (Eurostat); das Bundesland bestimmt nur den Solarertrag, den wir für die Landeshauptstadt berechnen. Ihren eigenen Tarif finden Sie auf Ihrer Stromrechnung.',
    linkLabel: '',
    after: '',
  }),
  regionPlaceholder: 'Bundesland wählen',
  regionError: 'Wählen Sie Ihr Bundesland.',
  usageLegend: 'Wie viel Strom verbrauchen Sie?',
  modeBill: 'Monatliche Stromrechnung',
  modeKwh: 'kWh pro Jahr',
  usageLabelBill: 'Durchschnittliche Stromrechnung pro Monat',
  usageLabelKwh: 'Stromverbrauch pro Jahr',
  usageHintBill: 'Ein Zwölfmonatsdurchschnitt ist am besten, weil sich die Rechnung mit den Jahreszeiten ändert. Nur Strom, nicht Gas. Bei einer Jahresabrechnung: durch zwölf teilen.',
  usageHintKwh: 'Die Summe der letzten zwölf Monate in kWh, aus Ihrer Rechnung oder Ihrer Strom-App.',
  usageErrors: {
    tooHigh: (max) => `Geben Sie einen Betrag bis ${max} ein.`,
    tooLow: 'Geben Sie einen Betrag über 0 € ein.',
    emptyBill: 'Geben Sie Ihre durchschnittliche monatliche Stromrechnung ein.',
    notNumberBill: 'Geben Sie einen Euro-Betrag ein, zum Beispiel 90 oder 90,50.',
    emptyKwh: 'Geben Sie Ihren Jahresverbrauch in kWh ein.',
    badKwh: 'Geben Sie eine Zahl über 0 ein, zum Beispiel 3500.',
    convert: 'Das konnten wir noch nicht umrechnen. Geben Sie stattdessen Ihre monatliche Rechnung ein.',
  },
  orientationLegend: 'Wohin zeigt die Hauptdachfläche?',
  orientations: [
    { value: 'south', label: 'Süd', hint: 'Nach Süden oder fast nach Süden' },
    { value: 'east_west', label: 'Ost oder West', hint: 'Nach Osten oder Westen' },
    { value: 'north', label: 'Nord', hint: 'Nach Norden' },
  ],
  shadingLegend: 'Wie viel Verschattung hat das Dach?',
  shadings: [
    { value: 'none', label: 'Kaum oder keine', hint: 'Freie Fläche, die meiste Zeit des Tages Sonne' },
    { value: 'some', label: 'Etwas', hint: 'Bäume oder Gebäude beschatten einen Teil des Tages' },
    { value: 'heavy', label: 'Stark', hint: 'Den größten Teil des Tages im Schatten' },
  ],
  installLegend: 'Wann wird die Anlage in Betrieb genommen?',
  installHint: 'Die EEG-Vergütung hängt vom Datum der Inbetriebnahme ab.',
  installBy: (end) => `Inbetriebnahme bis ${end}`,
  installBetween: (start, end) => `Inbetriebnahme ${start} bis ${end}`,
  installFrom: (start) => `Inbetriebnahme ab ${start}`,
  vatLine: (pct) => `Umsatzsteuer auf die Installation: ${pct}`,
  rebateLine: (perKwh) => `Förderung in diesem Zeitraum: ${perKwh} je kWh`,
  horizonNote: (until) => `Wir rechnen nur für Anlagen, die bis ${until} in Betrieb gehen. Für die Zeit danach hat die Bundesnetzagentur eine Nachfolgeregelung angekündigt, die noch in der parlamentarischen Beratung ist; einen Vergütungssatz für 2027 gibt es noch nicht.`,
  offerLabel: 'Wie wird der eingespeiste Strom vergütet?',
  offerHint: 'Bei der Überschusseinspeisung nutzen Sie den Strom zuerst selbst und speisen den Rest ein. Bei der Volleinspeisung geht der gesamte Solarstrom ins Netz, Ihre Stromrechnung sinkt dann nicht.',
  offerPlaceholder: 'Vergütungsart wählen',
  offerOption: (name, rate) => `${name}${rate !== null ? `: ${rate}` : ' (kein Satz zu diesem Datum)'}`,
  offerRate: (c) => `${deNum(c)} ct/kWh`,
  offerError: 'Wählen Sie die Vergütungsart.',
  batteryLegend: 'Mit Batteriespeicher?',
  noBattery: { label: 'Kein Speicher', hint: 'Nur Solarmodule' },
  oneBattery: { label: '1 Speicher (10 kWh)', hintOk: 'Preis nach der Auswertung der Verbraucherzentrale NRW', hintNo: 'Noch kein belegter Speicherpreis' },
  buttonSee: 'Meine Schätzung anzeigen',
  buttonUpdate: 'Schätzung aktualisieren',
  buttonBusy: 'Berechne …',
  liveBusy: 'Ihre Schätzung wird berechnet …',
  noProduction: 'Wir konnten gerade keine Solarertragsdaten für Ihre Region abrufen. Bitte versuchen Sie es in einer Minute erneut.',
  error: 'Bei der Berechnung ist etwas schiefgelaufen. Bitte versuchen Sie es erneut.',
  missingData: 'Wir prüfen noch einige Daten für diese Schätzung und können sie deshalb noch nicht anzeigen.',
  checkAnswers: 'Bitte prüfen Sie Ihre Angaben und versuchen Sie es erneut.',
  summary: (a) => `Für ein Haus in ${a.region}, vergütet nach: ${a.offer}. ${a.install}. ${a.battery ? 'Mit einem Speicher.' : 'Nur Solarmodule.'}`,
  metrics: {
    payback: 'Amortisation',
    paybackNote: 'Die Spanne reicht vom kürzesten (besten Fall) bis zum längsten Wert',
    netSavings: (y) => `Gewinn nach ${y} Jahren`,
    netSavingsNote: 'Stromkosten-Ersparnis und Einspeisevergütung, abzüglich der Anschaffungskosten',
    upfront: 'Anschaffungskosten',
    upfrontNote: () => 'Einschließlich Umsatzsteuer, ohne Förderung oder Kredit',
    systemSize: 'Anlagengröße',
    year1: 'Ersparnis im ersten Jahr',
    year1Note: 'Geringere Stromkosten plus Einspeisevergütung',
    rebate: 'Förderung abgezogen',
    rebateNote: 'Bereits in der Amortisation berücksichtigt',
  },
  grantNote: () => 'Es ist keine Förderung eingerechnet; Kredite (zum Beispiel von der KfW) werden nicht berücksichtigt. Nicht eingerechnet sind außerdem die 60-Prozent-Begrenzung ohne Smart Meter und der Wegfall der Vergütung bei negativen Strompreisen.',
  yieldNote: (place) => `Der Solarertrag wird für ${place} berechnet, die Landeshauptstadt Ihres Bundeslandes.`,
  secondaryCostNote: null,
  warningsHeading: 'Gut zu wissen',
  assumptionsSummary: (n) => `So wurde die Schätzung berechnet (${n} Annahmen, auf Englisch)`,
  sourcesSummary: (n) => `Woher die Zahlen stammen (${n} Quellen)`,
  sourceChecked: (d) => `, geprüft am ${d}`,
  disclaimer: { before: 'Eine Schätzung ist kein Angebot: Installateurpreise, Ihr tatsächlicher Verbrauch und Ihr Stromtarif weichen ab. Lesen Sie die ', link: 'Methodik', after: '.' },
  changeAnswers: 'Angaben ändern',
  startOver: 'Neu beginnen',
  likelySr: 'Wahrscheinlich ',
  likelyBadge: 'wahrscheinlich',
  rangeWord: (low, high) => `Spanne ${low} bis ${high}`,
  systemSizeText: (likely, low, high) => `${likely} (${low} bis ${high})`,
  years: { one: 'Jahr', many: 'Jahre', moreThan: 'Mehr als', moreThanLower: 'mehr als' },
  sources: {
    price: (n) => `Strompreis: ${n}`,
    offer: (n) => `Vergütung: ${n}`,
    solarCost: 'Preis der Photovoltaikanlage (Verbraucherzentrale NRW)',
    batteryCost: 'Preis des Batteriespeichers (Verbraucherzentrale NRW)',
    vat: 'Umsatzsteuer auf Photovoltaik (UStG § 12 Abs. 3)',
    incentive: (n) => `Förderung: ${n}`,
    location: (n) => `Koordinaten für den Solarertrag (${n})`,
  },
  chart: {
    paysBack: (y) => `Amortisiert ~Jahr ${y.replace('.', ',')}`,
    costLabel: (c) => `Anschaffungskosten ${deFull(c)}`,
    title: (n) => `Kumulierte Ersparnis über ${n} Jahre im Vergleich zu den Anschaffungskosten`,
    desc: (a) =>
      `Die wahrscheinliche kumulierte Ersparnis erreicht bis Jahr ${a.years} etwa ${deFull(a.likely)} (Spanne ${deFull(a.low)} bis ${deFull(a.high)}), bei wahrscheinlichen Anschaffungskosten von ${deFull(a.cost)}. ` +
      (a.crossingYears !== null ? `Die Ersparnis übersteigt die Kosten ab etwa Jahr ${a.crossingYears.replace('.', ',')}.` : `Die Ersparnis übersteigt die Kosten innerhalb von ${a.years} Jahren nicht.`),
  },
  chartText: {
    caption: (y) => `Ersparnis und Kosten über ${y} Jahre`,
    yearsAxis: 'Jahre',
    likelyLine: 'Wahrscheinliche kumulierte Ersparnis',
    rangeBand: 'Spanne von niedrig bis hoch',
    tableCaption: 'Kumulierte Ersparnis je Jahr (niedrig, wahrscheinlich, hoch)',
    year: 'Jahr',
    low: 'Niedrig',
    likely: 'Wahrscheinlich',
    high: 'Hoch',
  },
};

/** Which strings a market uses. Unknown markets fall back to the English (GB) set. */
export const STRINGS_BY_COUNTRY: Record<string, CalcStrings> = { GB: GB_STRINGS, AU: AU_STRINGS, DE: DE_STRINGS };
export const stringsFor = (country: string): CalcStrings => STRINGS_BY_COUNTRY[country] ?? GB_STRINGS;

/** DOM id prefix per market ("uk-region", "de-region"); GB keeps the original "uk". */
export const ID_PREFIX_BY_COUNTRY: Record<string, string> = { GB: 'uk', DE: 'de', AU: 'au' };
export const idPrefixFor = (country: string): string => ID_PREFIX_BY_COUNTRY[country] ?? country.toLowerCase();
