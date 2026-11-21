import type { FeedItem } from './feed';
import { normaliseText } from './normalise';

export type Topic = 'solar' | 'battery' | 'net_metering' | 'feed_in' | 'tariff' | 'subsidy';

/** Keyword lists per topic: English everywhere, plus the pack language. Matching is substring on lower-cased text (short Latin words need word boundaries). */
const EN: Record<Topic, string[]> = {
  solar: ['solar', 'photovoltaic', 'rooftop pv', 'pv system', 'pv panel'],
  battery: ['battery', 'batteries', 'energy storage', 'home storage'],
  net_metering: ['net metering', 'net billing', 'net-metering', 'self-consumption', 'prosumer'],
  feed_in: ['feed-in', 'feed in tariff', 'export tariff', 'export credit', 'smart export'],
  tariff: ['tariff', 'electricity price', 'price cap', 'rate case', 'time-of-use'],
  subsidy: ['subsidy', 'subsidies', 'rebate', 'incentive', 'grant', 'tax credit'],
};
const LOCAL: Record<string, Record<Topic, string[]>> = {
  de: { solar: ['solar', 'photovoltaik', 'pv-anlage'], battery: ['batteriespeicher', 'stromspeicher', 'speicher', 'batterie'], net_metering: ['eigenverbrauch', 'bilanzierung', 'netzanschluss'], feed_in: ['einspeisevergütung', 'einspeisetarif', 'einspeisung'], tariff: ['strompreis', 'tarif', 'netzentgelt'], subsidy: ['förderung', 'zuschuss', 'förderprogramm'] },
  fr: { solar: ['solaire', 'photovoltaïque'], battery: ['batterie', 'stockage'], net_metering: ['autoconsommation', 'autoproduction'], feed_in: ["tarif d'achat", 'obligation d’achat', 'injection'], tariff: ['tarif', 'prix de l’électricité', 'tarif réglementé'], subsidy: ['subvention', 'aide', 'prime', 'crédit d’impôt'] },
  es: { solar: ['solar', 'fotovoltaic'], battery: ['batería', 'baterías', 'almacenamiento'], net_metering: ['autoconsumo', 'medición neta', 'compensación'], feed_in: ['excedentes', 'tarifa de inyección'], tariff: ['tarifa', 'precio de la electricidad', 'peaje'], subsidy: ['subvención', 'subvenciones', 'ayuda', 'incentivo', 'bonificación'] },
  it: { solar: ['solare', 'fotovoltaic'], battery: ['batteria', 'accumulo'], net_metering: ['autoconsumo', 'scambio sul posto'], feed_in: ['ritiro dedicato', 'immissione'], tariff: ['tariffa', 'prezzo dell’energia'], subsidy: ['incentivo', 'incentivi', 'bonus', 'detrazione', 'contributo'] },
  pt: { solar: ['solar', 'fotovoltaic'], battery: ['bateria', 'armazenamento'], net_metering: ['autoconsumo', 'net metering'], feed_in: ['injeção', 'injecção', 'tarifa de venda'], tariff: ['tarifa', 'preço da eletricidade'], subsidy: ['subsídio', 'incentivo', 'apoio', 'fundo ambiental'] },
  nl: { solar: ['zonnepaneel', 'zonnepanelen', 'zonne-energie', 'pv'], battery: ['thuisbatterij', 'batterij', 'opslag'], net_metering: ['salderingsregeling', 'saldering', 'terugleverkosten'], feed_in: ['terugleververgoeding', 'teruglevering'], tariff: ['tarief', 'energieprijs'], subsidy: ['subsidie', 'btw-vrijstelling'] },
  pl: { solar: ['fotowoltaik', 'solarn'], battery: ['magazyn energii', 'akumulator'], net_metering: ['net-billing', 'net billing', 'prosument', 'autokonsumpcja'], feed_in: ['taryfa gwarantowana'], tariff: ['taryfa', 'cena energii'], subsidy: ['dotacja', 'dofinansowanie', 'mój prąd', 'ulga'] },
  sv: { solar: ['solcell', 'solenergi'], battery: ['batteri', 'energilager'], net_metering: ['nettodebitering', 'skattereduktion', 'mikroproducent'], feed_in: ['inmatning', 'överskottsel'], tariff: ['elpris', 'nättariff'], subsidy: ['bidrag', 'stöd', 'grönt avdrag'] },
  da: { solar: ['solcelle', 'solenergi'], battery: ['batteri', 'energilager'], net_metering: ['nettoafregning', 'egetforbrug'], feed_in: ['afregningspris', 'overskudsstrøm'], tariff: ['tarif', 'elpris'], subsidy: ['tilskud', 'støtte', 'pulje'] },
  no: { solar: ['solcelle', 'solenergi'], battery: ['batteri'], net_metering: ['plusskunde', 'egenproduksjon'], feed_in: ['innmating', 'overskuddsstrøm'], tariff: ['nettleie', 'strømpris'], subsidy: ['tilskudd', 'støtte', 'enova'] },
  fi: { solar: ['aurinko', 'aurinkosähkö', 'aurinkopaneeli'], battery: ['akku', 'sähkövarasto'], net_metering: ['nettolaskutus', 'omakäyttö'], feed_in: ['syöttö', 'myyntisähkö'], tariff: ['sähkön hinta', 'siirtohinta'], subsidy: ['tuki', 'avustus', 'kotitalousvähennys'] },
  cs: { solar: ['fotovoltaik', 'solární'], battery: ['baterie', 'akumulace'], net_metering: ['vlastní spotřeba', 'sdílení'], feed_in: ['výkupní', 'výkup'], tariff: ['tarif', 'cena elektřiny'], subsidy: ['dotace', 'nová zelená úsporám'] },
  ro: { solar: ['fotovoltaic', 'solar'], battery: ['baterie', 'stocare'], net_metering: ['prosumator', 'net metering'], feed_in: ['energie injectată', 'preț de achiziție'], tariff: ['tarif', 'preț energie'], subsidy: ['subvenție', 'casa verde', 'finanțare', 'grant'] },
  el: { solar: ['φωτοβολταϊκ', 'ηλιακ'], battery: ['μπαταρία', 'αποθήκευση'], net_metering: ['net metering', 'ενεργειακός συμψηφισμός', 'αυτοπαραγωγ'], feed_in: ['τιμή αγοράς', 'έγχυση'], tariff: ['τιμολόγιο', 'τιμή ρεύματος'], subsidy: ['επιδότηση', 'πρόγραμμα', 'χρηματοδότηση'] },
  ja: { solar: ['太陽光', '太陽電池', 'ソーラー'], battery: ['蓄電池', '蓄電'], net_metering: ['自家消費', 'ネットメータリング'], feed_in: ['固定価格買取', 'fit', '余剰電力', '買取価格'], tariff: ['電気料金', '電力料金', '託送'], subsidy: ['補助金', '助成', '支援事業'] },
  id: { solar: ['surya', 'plts'], battery: ['baterai', 'penyimpanan'], net_metering: ['net metering', 'ekspor listrik'], feed_in: ['tarif ekspor', 'feed-in'], tariff: ['tarif listrik', 'tarif'], subsidy: ['subsidi', 'insentif', 'bantuan'] },
  he: { solar: ['סולארי', 'פוטו-וולטאי', 'אנרגיה סולארית'], battery: ['סוללה', 'אגירה'], net_metering: ['מונה נטו', 'ייצור עצמי'], feed_in: ['תעריף', 'הזנה'], tariff: ['תעריף חשמל'], subsidy: ['מענק', 'סבסוד', 'הטבה'] },
  ar: { solar: ['شمسي', 'الطاقة الشمسية', 'كهروضوئ'], battery: ['بطارية', 'تخزين'], net_metering: ['القياس الصافي', 'صافي القياس'], feed_in: ['تعرفة التغذية', 'تعرفة'], tariff: ['تعرفة الكهرباء', 'سعر الكهرباء'], subsidy: ['دعم', 'حوافز', 'منحة'] },
};
const LANG_ALIAS: Record<string, string> = { english: 'en', nb: 'no', nn: 'no', sinhala: 'si', tamil: 'ta' };

/** "fr/nl", "bn/en", "English/Sinhala/Tamil", "fr;de;en" to ['fr','nl'] etc. */
export function languageCodes(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? '').toLowerCase().split(/[\s/|;,()]+/).filter(Boolean).map((l) => LANG_ALIAS[l] ?? l.slice(0, 2)))];
}

const esc = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startRe = (w: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${esc(w)}`, 'u');
const wordRe = (w: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${esc(w)}(?![\\p{L}\\p{N}])`, 'u');

function hasKeyword(text: string, kw: string): boolean {
  // Latin keywords must start a word ("grant" must not match "migrant"); short ones ("pv", "fit") must be whole words.
  if (!/^[a-z]/.test(kw)) return text.includes(kw);
  return (kw.length <= 3 ? wordRe(kw) : startRe(kw)).test(text);
}

export interface Relevance {
  relevance: number;
  topics: Topic[];
}

/** Count distinct keywords found in title + summary (English + the pack language). Titles count the same as summaries. */
export function scoreRelevance(text: string, language: string | null | undefined): Relevance {
  const hay = normaliseText(text).toLowerCase();
  const lists: Record<Topic, string[]>[] = [EN, ...languageCodes(language).map((c) => LOCAL[c]).filter((l): l is Record<Topic, string[]> => !!l)];
  const topics = new Set<Topic>();
  let relevance = 0;
  for (const list of lists) {
    for (const topic of Object.keys(list) as Topic[]) {
      for (const kw of list[topic]) {
        if (hasKeyword(hay, kw.toLowerCase())) {
          relevance++;
          topics.add(topic);
        }
      }
    }
  }
  return { relevance, topics: [...topics] };
}

export interface NewsRow {
  country: string;
  source_id: string;
  title: string;
  url: string;
  published_at: string | null;
  summary: string;
  topics: Topic[];
  relevance: number;
  language: string | null;
}

/** Feed items to news_items rows; only items with relevance >= 1 are kept. */
export function toNewsRows(items: FeedItem[], source: { id: string; country: string; language: string | null }): NewsRow[] {
  const rows: NewsRow[] = [];
  for (const it of items) {
    const { relevance, topics } = scoreRelevance(`${it.title} ${it.summary}`, source.language);
    if (relevance < 1) continue;
    rows.push({ country: source.country, source_id: source.id, title: it.title.slice(0, 500), url: it.url, published_at: it.publishedAt, summary: it.summary, topics, relevance, language: source.language });
  }
  return rows;
}
