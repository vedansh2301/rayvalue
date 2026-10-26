/**
 * Voice-over text -> what the text-to-speech engine should read (pure). The slide's `voice` line stays the reader-visible
 * text (rule 1 checks run on it); this only rewrites its form so the engine says it the way a person would:
 *   "$30,900 to $53,500"               -> "thirty thousand nine hundred to fifty-three thousand five hundred dollars"
 *   "10.5 to 15.5"                     -> "ten and a half to fifteen and a half"
 *   "12.4 kilowatts"                   -> "twelve point four kilowatts"
 *   "rayvalue.com/calculator/florida"  -> "Ray Value dot com slash calculator slash Florida"
 *   "PG&E", "SDG&E", "FPL"             -> "P G and E", "S D G and E", "F P L"
 *   em-dash                            -> a comma pause
 * No number is added, dropped or rounded: every figure is spelled out exactly as written.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: [number, string][] = [
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
];

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : ''));
  else if (n > 0 || parts.length === 0) parts.push(ONES[n]!);
  return parts.join(' ');
}

/** Non-negative integer -> words: 30900 -> "thirty thousand nine hundred". */
export function integerWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`integerWords: ${n} is not a non-negative integer`);
  if (n < 1000) return under1000(n);
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      parts.push(`${under1000(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n > 0) parts.push(under1000(n));
  return parts.join(' ');
}

/** "2026" -> "twenty twenty-six", "2000" -> "two thousand", "2005" -> "two thousand five". */
export function yearWords(y: number): string {
  if (y % 1000 < 10) return integerWords(y);
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  return `${integerWords(hi)} ${lo === 0 ? 'hundred' : lo < 10 ? `oh ${ONES[lo]}` : integerWords(lo)}`;
}

/**
 * A number as written ("30,900", "10.5", "12.4", "3.0") -> words. ".5" is "and a half"; other decimals are read digit
 * by digit after "point".
 */
export function numberWords(text: string): string {
  const [int, frac] = text.replace(/,/g, '').split('.');
  const whole = integerWords(Number(int || '0'));
  if (frac === undefined || frac === '') return whole;
  if (frac === '5' && Number(int) > 0) return `${whole} and a half`;
  return `${whole} point ${[...frac].map((d) => (d === '0' ? 'oh' : ONES[Number(d)])).join(' ')}`;
}

/** Dollar amount as written (without the "$") -> words, no unit: "30,900" -> "thirty thousand nine hundred". */
function dollarWords(amount: string, suffix: string): string {
  const [int, cents] = amount.replace(/,/g, '').split('.');
  const scale = suffix ? ` ${suffix.toLowerCase() === 'k' ? 'thousand' : 'million'}` : '';
  if (scale) return `${numberWords(amount)}${scale}`;
  if (cents && Number(int) === 0) return `${integerWords(Number(cents.padEnd(2, '0').slice(0, 2)))} cents`;
  if (cents && Number(cents) > 0) return `${integerWords(Number(int))} dollars and ${integerWords(Number(cents.padEnd(2, '0').slice(0, 2)))} cents`;
  return integerWords(Number(int));
}

const MONEY = String.raw`\$(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?([kKM])?\b`;
const isCents = (words: string) => / cents$/.test(words);
const withDollars = (words: string, n: string) => (isCents(words) || / dollars and /.test(words) ? words : `${words} ${n === '1' ? 'dollar' : 'dollars'}`);

/** How these names are said. Keys are matched as whole words, case-sensitive (utility names, units, acronyms). */
const LEXICON: [RegExp, string][] = [
  [/\bSDG&E\b/g, 'S D G and E'],
  [/\bPG&E\b/g, 'P G and E'],
  [/\bSCE\b/g, 'S C E'],
  [/\bFPL\b/g, 'F P L'],
  [/\bTECO\b/g, 'Teeko'],
  [/\bLADWP\b/g, 'L A D W P'],
  [/\bSMUD\b/g, 'Smudd'],
  [/\bNEM ?(\d)\.0\b/g, 'N E M $1'],
  [/\bNEM\b/g, 'N E M'],
  [/\bTOU\b/g, 'time of use'],
  [/\bHOA\b/g, 'H O A'],
  [/\bROI\b/g, 'R O I'],
  [/\bkWh\b/g, 'kilowatt hours'],
  [/\bkW\b/g, 'kilowatts'],
  [/\bMWh\b/g, 'megawatt hours'],
  [/\bvs\.?(?=\s)/g, 'versus'],
  [/\be\.g\./g, 'for example'],
  [/\byrs\b/g, 'years'],
  [/\bmo\b/g, 'month'],
];

/** URL path segments with their own pronunciation (utility page slugs). */
const URL_WORDS: Record<string, string> = {
  rayvalue: 'Ray Value',
  fpl: 'F P L',
  teco: 'Teeko',
  pge: 'P G and E',
  sce: 'S C E',
  sdge: 'S D G and E',
  florida: 'Florida',
  california: 'California',
};

function urlWords(host: string, tld: string, path: string): string {
  const seg = (s: string) => URL_WORDS[s.toLowerCase()] ?? s.replace(/-/g, ' ');
  const parts = [`${seg(host)} dot ${tld.toLowerCase()}`];
  for (const p of path.split('/').filter(Boolean)) parts.push(`slash ${seg(p)}`);
  return parts.join(' ');
}

/** Rewrites a voice-over line into the words the TTS engine should say. */
export function speakable(line: string): string {
  let t = line.normalize('NFC');

  // Typography: curly quotes, dashes, bullets.
  t = t.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/(\$?\d[\d,.]*)\s*[–‒]\s*(?=\$?\d)/g, '$1 to '); // 12–17, $12,300–$16,100
  t = t.replace(/\s*[—–―]\s*|\s+--?\s+/g, ', '); // em-dash, spaced en-dash or hyphen(s): a pause
  t = t.replace(/\s*·\s*/g, ', ');
  t = t.replace(/…/g, '...');

  // URLs before anything touches their dots and slashes.
  t = t.replace(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.(com|org|net|gov)((?:\/[a-z0-9-]+)*)\/?/gi, (_m, host: string, tld: string, path: string) => urlWords(host, tld, path));

  // Money. A range says "dollars" once, after its second end: "$30,900 to $53,500" -> "... to ... dollars".
  t = t.replace(new RegExp(`${MONEY}(\\s+(?:to|and|or)\\s+)${MONEY}`, 'g'), (_m, a: string, ac = '', as = '', join: string, b: string, bc = '', bs = '') => {
    const wa = dollarWords(a + ac, as);
    const wb = dollarWords(b + bc, bs);
    return isCents(wa) || isCents(wb) || / dollars and /.test(wa + wb) ? `${withDollars(wa, a)}${join}${withDollars(wb, b)}` : `${wa}${join}${withDollars(wb, b + bc)}`;
  });
  t = t.replace(new RegExp(MONEY, 'g'), (_m, a: string, c = '', s = '') => withDollars(dollarWords(a + c, s), s ? '' : a + c));

  t = t.replace(/(\d)\s*%/g, '$1 percent');
  for (const [re, say] of LEXICON) t = t.replace(re, say);

  // Remaining "A&B"-style names spell their letters; a lone "&" is "and".
  t = t.replace(/\b([A-Z]{1,4})&([A-Z]{1,4})\b/g, (_m, a: string, b: string) => `${[...a].join(' ')} and ${[...b].join(' ')}`);
  t = t.replace(/\s*&\s*/g, ' and ');

  // Years (four digits 1900-2099 standing alone), then every other number.
  t = t.replace(/(?<![\d,.$])\b(19\d\d|20\d\d)\b(?![\d,]|\.\d)/g, (_m, y: string) => yearWords(Number(y)));
  t = t.replace(/(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\d])/g, (_m, i: string, f = '') => numberWords(i + f));

  t = t.replace(/\s*~\s*/g, ' about ').replace(/\s\+\s/g, ' plus ').replace(/\s*\/\s*/g, ' per ');
  return t.replace(/\s+([,.;:!?])/g, '$1').replace(/,(?:\s*,)+/g, ',').replace(/\s{2,}/g, ' ').trim();
}
