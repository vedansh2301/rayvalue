/**
 * Small UI string dictionaries (nav, breadcrumb and footer labels) for non-US pages. Labels only: no figures.
 * Lookup is by the full tag first ("pt-BR"), then the primary subtag ("de-DE" -> "de"); unknown languages fall back to English.
 */
export interface UiText {
  home: string;
  guides: string;
  blog: string;
  countries: string;
  switchCountry: string;
  tagline: string;
  calculator: string;
  calculators: string;
  deadlines: string;
  footerCountry: string;
  footerLearn: string;
  footerCompany: string;
  methodology: string;
  about: string;
  contact: string;
  privacy: string;
  terms: string;
  independent: string;
  latestGuides: string;
  latestBlog: string;
  placesHeading: string;
  allGuides: string;
  allBlog: string;
}

const en: UiText = {
  home: 'Home', guides: 'Guides', blog: 'Blog', countries: 'Countries', switchCountry: 'Country',
  tagline: 'Solar payback, country by country', calculator: 'Calculator', calculators: 'Calculators', deadlines: 'Dates that matter', footerCountry: 'This country', footerLearn: 'Learn', footerCompany: 'Company and legal',
  methodology: 'Methodology', about: 'About', contact: 'Contact', privacy: 'Privacy', terms: 'Terms',
  independent: 'RayValue is an independent site, not affiliated with any utility or government agency.',
  latestGuides: 'Latest guides', latestBlog: 'Latest from the blog', placesHeading: 'Solar data by place', allGuides: 'All guides', allBlog: 'All blog posts',
};

const DICTS: Readonly<Record<string, UiText>> = {
  en,
  de: { ...en, home: 'Startseite', guides: 'Ratgeber', blog: 'Blog', countries: 'Länder', switchCountry: 'Land', tagline: 'Solar-Amortisation, Land für Land', calculator: 'Rechner', calculators: 'Rechner', deadlines: 'Fristen, die zählen', footerCountry: 'Dieses Land', footerLearn: 'Lernen', footerCompany: 'Unternehmen und Rechtliches', methodology: 'Methodik', about: 'Über uns', contact: 'Kontakt', privacy: 'Datenschutz', terms: 'Nutzungsbedingungen', independent: 'RayValue ist eine unabhängige Seite und nicht mit einem Versorger oder einer Behörde verbunden.', latestGuides: 'Neueste Ratgeber', latestBlog: 'Neu im Blog', placesHeading: 'Solardaten nach Ort', allGuides: 'Alle Ratgeber', allBlog: 'Alle Blogbeiträge' },
  nl: { ...en, home: 'Home', guides: 'Gidsen', blog: 'Blog', countries: 'Landen', switchCountry: 'Land', tagline: 'Terugverdientijd van zonnepanelen, land voor land', calculator: 'Rekentool', calculators: 'Rekentools', deadlines: 'Deadlines die tellen', footerCountry: 'Dit land', footerLearn: 'Leren', footerCompany: 'Bedrijf en juridisch', methodology: 'Methode', about: 'Over ons', contact: 'Contact', privacy: 'Privacy', terms: 'Voorwaarden', independent: 'RayValue is een onafhankelijke site en is niet verbonden aan een energiebedrijf of overheidsinstantie.', latestGuides: 'Nieuwste gidsen', latestBlog: 'Nieuw op de blog', placesHeading: 'Zonnedata per plaats', allGuides: 'Alle gidsen', allBlog: 'Alle blogberichten' },
  es: { ...en, home: 'Inicio', guides: 'Guías', blog: 'Blog', countries: 'Países', switchCountry: 'País', tagline: 'Rentabilidad solar, país por país', calculator: 'Calculadora', calculators: 'Calculadoras', deadlines: 'Fechas que importan', footerCountry: 'Este país', footerLearn: 'Aprender', footerCompany: 'Empresa y legal', methodology: 'Metodología', about: 'Acerca de', contact: 'Contacto', privacy: 'Privacidad', terms: 'Términos', independent: 'RayValue es un sitio independiente, sin relación con ninguna compañía eléctrica ni organismo público.', latestGuides: 'Últimas guías', latestBlog: 'Novedades del blog', placesHeading: 'Datos solares por lugar', allGuides: 'Todas las guías', allBlog: 'Todas las entradas' },
  it: { ...en, home: 'Home', guides: 'Guide', blog: 'Blog', countries: 'Paesi', switchCountry: 'Paese', tagline: 'Il ritorno del solare, paese per paese', calculator: 'Calcolatore', calculators: 'Calcolatori', deadlines: 'Scadenze da non perdere', footerCountry: 'Questo paese', footerLearn: 'Approfondisci', footerCompany: 'Azienda e note legali', methodology: 'Metodologia', about: 'Chi siamo', contact: 'Contatti', privacy: 'Privacy', terms: 'Termini', independent: 'RayValue è un sito indipendente, non collegato a nessun fornitore di energia o ente pubblico.', latestGuides: 'Ultime guide', latestBlog: 'Dal blog', placesHeading: 'Dati solari per località', allGuides: 'Tutte le guide', allBlog: 'Tutti gli articoli' },
  fr: { ...en, home: 'Accueil', guides: 'Guides', blog: 'Blog', countries: 'Pays', switchCountry: 'Pays', tagline: 'Rentabilité du solaire, pays par pays', calculator: 'Simulateur', calculators: 'Simulateurs', deadlines: 'Échéances à connaître', footerCountry: 'Ce pays', footerLearn: 'Apprendre', footerCompany: 'Entreprise et mentions légales', methodology: 'Méthodologie', about: 'À propos', contact: 'Contact', privacy: 'Confidentialité', terms: 'Conditions', independent: 'RayValue est un site indépendant, sans lien avec un fournisseur d’énergie ni un organisme public.', latestGuides: 'Derniers guides', latestBlog: 'Dernières nouvelles du blog', placesHeading: 'Données solaires par lieu', allGuides: 'Tous les guides', allBlog: 'Tous les articles' },
  pt: { ...en, home: 'Início', guides: 'Guias', blog: 'Blog', countries: 'Países', switchCountry: 'País', tagline: 'Retorno do solar, país a país', calculator: 'Simulador', calculators: 'Simuladores', deadlines: 'Prazos que contam', footerCountry: 'Este país', footerLearn: 'Aprender', footerCompany: 'Empresa e legal', methodology: 'Metodologia', about: 'Sobre', contact: 'Contacto', privacy: 'Privacidade', terms: 'Termos', independent: 'A RayValue é um site independente, sem ligação a nenhum fornecedor de energia ou entidade pública.', latestGuides: 'Últimos guias', latestBlog: 'Novidades do blog', placesHeading: 'Dados solares por local', allGuides: 'Todos os guias', allBlog: 'Todos os artigos' },
  pl: { ...en, home: 'Strona główna', guides: 'Poradniki', blog: 'Blog', countries: 'Kraje', switchCountry: 'Kraj', tagline: 'Zwrot z fotowoltaiki, kraj po kraju', calculator: 'Kalkulator', calculators: 'Kalkulatory', deadlines: 'Terminy, które mają znaczenie', footerCountry: 'Ten kraj', footerLearn: 'Wiedza', footerCompany: 'Firma i informacje prawne', methodology: 'Metodologia', about: 'O nas', contact: 'Kontakt', privacy: 'Prywatność', terms: 'Regulamin', independent: 'RayValue to niezależny serwis, niepowiązany z żadnym sprzedawcą energii ani urzędem.', latestGuides: 'Najnowsze poradniki', latestBlog: 'Nowości na blogu', placesHeading: 'Dane słoneczne według miejscowości', allGuides: 'Wszystkie poradniki', allBlog: 'Wszystkie wpisy' },
  cs: { ...en, home: 'Domů', guides: 'Průvodci', blog: 'Blog', countries: 'Země', switchCountry: 'Země', tagline: 'Návratnost fotovoltaiky, země po zemi', calculator: 'Kalkulačka', calculators: 'Kalkulačky', deadlines: 'Termíny, na kterých záleží', footerCountry: 'Tato země', footerLearn: 'Vzdělávání', footerCompany: 'Společnost a právní informace', methodology: 'Metodika', about: 'O nás', contact: 'Kontakt', privacy: 'Soukromí', terms: 'Podmínky', independent: 'RayValue je nezávislý web, který není spojen s žádným dodavatelem energie ani úřadem.', latestGuides: 'Nejnovější průvodci', latestBlog: 'Novinky z blogu', placesHeading: 'Sluneční data podle místa', allGuides: 'Všichni průvodci', allBlog: 'Všechny články' },
  ro: { ...en, home: 'Acasă', guides: 'Ghiduri', blog: 'Blog', countries: 'Țări', switchCountry: 'Țară', tagline: 'Amortizarea solarului, țară cu țară', calculator: 'Calculator', calculators: 'Calculatoare', deadlines: 'Termene care contează', footerCountry: 'Această țară', footerLearn: 'Află mai mult', footerCompany: 'Companie și informații legale', methodology: 'Metodologie', about: 'Despre noi', contact: 'Contact', privacy: 'Confidențialitate', terms: 'Termeni', independent: 'RayValue este un site independent, fără legătură cu vreun furnizor de energie sau cu vreo instituție publică.', latestGuides: 'Cele mai noi ghiduri', latestBlog: 'Noutăți pe blog', placesHeading: 'Date solare pe localități', allGuides: 'Toate ghidurile', allBlog: 'Toate articolele' },
  'pt-br': { ...en, home: 'Início', guides: 'Guias', blog: 'Blog', countries: 'Países', switchCountry: 'País', tagline: 'Retorno do solar, país a país', footerCountry: 'Este país', footerLearn: 'Aprender', footerCompany: 'Empresa e jurídico', methodology: 'Metodologia', about: 'Sobre', contact: 'Contato', privacy: 'Privacidade', terms: 'Termos', independent: 'A RayValue é um site independente, sem vínculo com nenhuma distribuidora de energia ou órgão público.', latestGuides: 'Últimos guias', latestBlog: 'Novidades do blog', placesHeading: 'Dados solares por local', allGuides: 'Todos os guias', allBlog: 'Todos os artigos' },
  ja: { ...en, home: 'ホーム', guides: 'ガイド', blog: 'ブログ', countries: '国', switchCountry: '国', tagline: '太陽光の元が取れるか、国ごとに', footerCountry: 'この国', footerLearn: '学ぶ', footerCompany: '会社情報・法的事項', methodology: '調査方法', about: '運営者について', contact: 'お問い合わせ', privacy: 'プライバシー', terms: '利用規約', independent: 'RayValue は独立したサイトであり、電力会社や政府機関とは関係ありません。', latestGuides: '新着ガイド', latestBlog: 'ブログの新着', placesHeading: '地域別の太陽光データ', allGuides: 'ガイド一覧', allBlog: 'ブログ一覧' },
  hi: { ...en, home: 'होम', guides: 'गाइड', blog: 'ब्लॉग', countries: 'देश', switchCountry: 'देश', tagline: 'सौर ऊर्जा का रिटर्न, देश दर देश', footerCountry: 'यह देश', footerLearn: 'सीखें', footerCompany: 'कंपनी और कानूनी', methodology: 'कार्यप्रणाली', about: 'हमारे बारे में', contact: 'संपर्क', privacy: 'गोपनीयता', terms: 'नियम और शर्तें', independent: 'RayValue एक स्वतंत्र साइट है और किसी बिजली कंपनी या सरकारी एजेंसी से जुड़ी नहीं है।', latestGuides: 'नए गाइड', latestBlog: 'ब्लॉग से ताज़ा', placesHeading: 'स्थान के अनुसार सौर डेटा', allGuides: 'सभी गाइड', allBlog: 'सभी ब्लॉग पोस्ट' },
};

export const SUPPORTED_UI_LANGS: readonly string[] = Object.keys(DICTS);

/**
 * Dictionary key for a BCP47 tag: the full tag first ("pt-BR" -> "pt-br", so Brazilian Portuguese is not served the European
 * one), then the primary subtag ("de-DE" -> "de"); "en" when neither has a dictionary.
 */
export const resolveUiLang = (lang?: string | null): string => {
  const tag = (lang ?? 'en').toLowerCase().replace(/_/g, '-');
  if (DICTS[tag]) return tag;
  const primary = tag.split('-')[0] ?? 'en';
  return DICTS[primary] ? primary : 'en';
};

/** UI strings for a BCP47 tag ("de-DE", "pt-BR", "en-GB", undefined); English when the language has no dictionary. */
export const uiText = (lang?: string | null): UiText => DICTS[resolveUiLang(lang)] ?? en;

const HUB_INTRO: Readonly<Record<string, (country: string) => string>> = {
  en: (c) => `Independent solar and home-battery guides and local data for ${c}. Every figure names its source and the date we checked it.`,
  de: (c) => `Unabhängige Solar- und Batterie-Ratgeber und lokale Daten für ${c}. Jede Zahl nennt ihre Quelle und das Prüfdatum.`,
  nl: (c) => `Onafhankelijke gidsen over zonnepanelen en thuisbatterijen en lokale data voor ${c}. Elk cijfer noemt zijn bron en de datum van controle.`,
  es: (c) => `Guías independientes sobre solar y baterías domésticas y datos locales para ${c}. Cada cifra indica su fuente y la fecha de comprobación.`,
  it: (c) => `Guide indipendenti su fotovoltaico e batterie domestiche e dati locali per ${c}. Ogni cifra indica la fonte e la data di verifica.`,
  fr: (c) => `Guides indépendants sur le solaire et les batteries domestiques et données locales pour ${c}. Chaque chiffre cite sa source et sa date de vérification.`,
  pt: (c) => `Guias independentes sobre solar e baterias domésticas e dados locais para ${c}. Cada valor indica a fonte e a data de verificação.`,
  pl: (c) => `Niezależne poradniki o fotowoltaice i domowych magazynach energii oraz lokalne dane dla kraju: ${c}. Każda liczba podaje źródło i datę sprawdzenia.`,
  cs: (c) => `Nezávislí průvodci fotovoltaikou a domácími bateriemi a místní data pro zemi ${c}. U každého čísla uvádíme zdroj a datum ověření.`,
  ro: (c) => `Ghiduri independente despre panouri solare și baterii pentru acasă și date locale pentru ${c}. Fiecare cifră își indică sursa și data verificării.`,
  'pt-br': (c) => `Guias independentes sobre energia solar e baterias residenciais e dados locais para ${c}. Cada valor indica a fonte e a data de verificação.`,
  ja: (c) => `${c}向けの、独立した太陽光発電・家庭用蓄電池のガイドと地域データ。すべての数値に出典と確認日を記載しています。`,
  hi: (c) => `${c} के लिए स्वतंत्र सौर और घरेलू बैटरी गाइड और स्थानीय डेटा। हर आँकड़े के साथ उसका स्रोत और जाँच की तारीख दी गई है।`,
};

/** One-line intro of a country home hub (no figures). */
export const hubIntro = (lang: string | null | undefined, countryName: string): string => (HUB_INTRO[resolveUiLang(lang)] ?? HUB_INTRO.en!)(countryName);
