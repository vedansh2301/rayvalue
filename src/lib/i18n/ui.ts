/**
 * Small UI string dictionaries (nav, breadcrumb and footer labels) for non-US pages. Labels only: no figures.
 * Lookup is by the primary subtag of <html lang> ("de-DE" -> "de"); unknown languages fall back to English.
 */
export interface UiText {
  home: string;
  guides: string;
  blog: string;
  countries: string;
  switchCountry: string;
  tagline: string;
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
  tagline: 'Solar math for your home', footerCountry: 'This country', footerLearn: 'Learn', footerCompany: 'Company and legal',
  methodology: 'Methodology', about: 'About', contact: 'Contact', privacy: 'Privacy', terms: 'Terms',
  independent: 'RayValue is an independent site, not affiliated with any utility or government agency.',
  latestGuides: 'Latest guides', latestBlog: 'Latest from the blog', placesHeading: 'Solar data by place', allGuides: 'All guides', allBlog: 'All blog posts',
};

const DICTS: Readonly<Record<string, UiText>> = {
  en,
  de: { ...en, home: 'Startseite', guides: 'Ratgeber', blog: 'Blog', countries: 'Länder', switchCountry: 'Land', tagline: 'Solar-Rechnung für Ihr Zuhause', footerCountry: 'Dieses Land', footerLearn: 'Lernen', footerCompany: 'Unternehmen und Rechtliches', methodology: 'Methodik', about: 'Über uns', contact: 'Kontakt', privacy: 'Datenschutz', terms: 'Nutzungsbedingungen', independent: 'RayValue ist eine unabhängige Seite und nicht mit einem Versorger oder einer Behörde verbunden.', latestGuides: 'Neueste Ratgeber', latestBlog: 'Neu im Blog', placesHeading: 'Solardaten nach Ort', allGuides: 'Alle Ratgeber', allBlog: 'Alle Blogbeiträge' },
  nl: { ...en, home: 'Home', guides: 'Gidsen', blog: 'Blog', countries: 'Landen', switchCountry: 'Land', tagline: 'Zonnerekenwerk voor jouw huis', footerCountry: 'Dit land', footerLearn: 'Leren', footerCompany: 'Bedrijf en juridisch', methodology: 'Methode', about: 'Over ons', contact: 'Contact', privacy: 'Privacy', terms: 'Voorwaarden', independent: 'RayValue is een onafhankelijke site en is niet verbonden aan een energiebedrijf of overheidsinstantie.', latestGuides: 'Nieuwste gidsen', latestBlog: 'Nieuw op de blog', placesHeading: 'Zonnedata per plaats', allGuides: 'Alle gidsen', allBlog: 'Alle blogberichten' },
  es: { ...en, home: 'Inicio', guides: 'Guías', blog: 'Blog', countries: 'Países', switchCountry: 'País', tagline: 'Las cuentas solares de tu casa', footerCountry: 'Este país', footerLearn: 'Aprender', footerCompany: 'Empresa y legal', methodology: 'Metodología', about: 'Acerca de', contact: 'Contacto', privacy: 'Privacidad', terms: 'Términos', independent: 'RayValue es un sitio independiente, sin relación con ninguna compañía eléctrica ni organismo público.', latestGuides: 'Últimas guías', latestBlog: 'Novedades del blog', placesHeading: 'Datos solares por lugar', allGuides: 'Todas las guías', allBlog: 'Todas las entradas' },
  it: { ...en, home: 'Home', guides: 'Guide', blog: 'Blog', countries: 'Paesi', switchCountry: 'Paese', tagline: 'I conti del solare per casa tua', footerCountry: 'Questo paese', footerLearn: 'Approfondisci', footerCompany: 'Azienda e note legali', methodology: 'Metodologia', about: 'Chi siamo', contact: 'Contatti', privacy: 'Privacy', terms: 'Termini', independent: 'RayValue è un sito indipendente, non collegato a nessun fornitore di energia o ente pubblico.', latestGuides: 'Ultime guide', latestBlog: 'Dal blog', placesHeading: 'Dati solari per località', allGuides: 'Tutte le guide', allBlog: 'Tutti gli articoli' },
  fr: { ...en, home: 'Accueil', guides: 'Guides', blog: 'Blog', countries: 'Pays', switchCountry: 'Pays', tagline: 'Le calcul solaire pour votre maison', footerCountry: 'Ce pays', footerLearn: 'Apprendre', footerCompany: 'Entreprise et mentions légales', methodology: 'Méthodologie', about: 'À propos', contact: 'Contact', privacy: 'Confidentialité', terms: 'Conditions', independent: 'RayValue est un site indépendant, sans lien avec un fournisseur d’énergie ni un organisme public.', latestGuides: 'Derniers guides', latestBlog: 'Dernières nouvelles du blog', placesHeading: 'Données solaires par lieu', allGuides: 'Tous les guides', allBlog: 'Tous les articles' },
  pt: { ...en, home: 'Início', guides: 'Guias', blog: 'Blog', countries: 'Países', switchCountry: 'País', tagline: 'As contas solares da sua casa', footerCountry: 'Este país', footerLearn: 'Aprender', footerCompany: 'Empresa e legal', methodology: 'Metodologia', about: 'Sobre', contact: 'Contacto', privacy: 'Privacidade', terms: 'Termos', independent: 'A RayValue é um site independente, sem ligação a nenhum fornecedor de energia ou entidade pública.', latestGuides: 'Últimos guias', latestBlog: 'Novidades do blog', placesHeading: 'Dados solares por local', allGuides: 'Todos os guias', allBlog: 'Todos os artigos' },
  pl: { ...en, home: 'Strona główna', guides: 'Poradniki', blog: 'Blog', countries: 'Kraje', switchCountry: 'Kraj', tagline: 'Rachunek fotowoltaiki dla Twojego domu', footerCountry: 'Ten kraj', footerLearn: 'Wiedza', footerCompany: 'Firma i informacje prawne', methodology: 'Metodologia', about: 'O nas', contact: 'Kontakt', privacy: 'Prywatność', terms: 'Regulamin', independent: 'RayValue to niezależny serwis, niepowiązany z żadnym sprzedawcą energii ani urzędem.', latestGuides: 'Najnowsze poradniki', latestBlog: 'Nowości na blogu', placesHeading: 'Dane słoneczne według miejscowości', allGuides: 'Wszystkie poradniki', allBlog: 'Wszystkie wpisy' },
  cs: { ...en, home: 'Domů', guides: 'Průvodci', blog: 'Blog', countries: 'Země', switchCountry: 'Země', tagline: 'Výpočty fotovoltaiky pro váš dům', footerCountry: 'Tato země', footerLearn: 'Vzdělávání', footerCompany: 'Společnost a právní informace', methodology: 'Metodika', about: 'O nás', contact: 'Kontakt', privacy: 'Soukromí', terms: 'Podmínky', independent: 'RayValue je nezávislý web, který není spojen s žádným dodavatelem energie ani úřadem.', latestGuides: 'Nejnovější průvodci', latestBlog: 'Novinky z blogu', placesHeading: 'Sluneční data podle místa', allGuides: 'Všichni průvodci', allBlog: 'Všechny články' },
  ro: { ...en, home: 'Acasă', guides: 'Ghiduri', blog: 'Blog', countries: 'Țări', switchCountry: 'Țară', tagline: 'Calculele solare pentru casa ta', footerCountry: 'Această țară', footerLearn: 'Află mai mult', footerCompany: 'Companie și informații legale', methodology: 'Metodologie', about: 'Despre noi', contact: 'Contact', privacy: 'Confidențialitate', terms: 'Termeni', independent: 'RayValue este un site independent, fără legătură cu vreun furnizor de energie sau cu vreo instituție publică.', latestGuides: 'Cele mai noi ghiduri', latestBlog: 'Noutăți pe blog', placesHeading: 'Date solare pe localități', allGuides: 'Toate ghidurile', allBlog: 'Toate articolele' },
};

export const SUPPORTED_UI_LANGS: readonly string[] = Object.keys(DICTS);

/** UI strings for a BCP47 tag ("de-DE", "en-GB", undefined); English when the language has no dictionary. */
export const uiText = (lang?: string | null): UiText => DICTS[(lang ?? 'en').toLowerCase().split('-')[0] ?? 'en'] ?? en;

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
};

/** One-line intro of a country home hub (no figures). */
export const hubIntro = (lang: string | null | undefined, countryName: string): string => (HUB_INTRO[(lang ?? 'en').toLowerCase().split('-')[0] ?? 'en'] ?? HUB_INTRO.en!)(countryName);
