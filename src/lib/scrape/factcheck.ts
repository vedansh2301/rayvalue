/**
 * Fact-check gate: does a fetched source text still support a stored fact?
 *
 * Pure and conservative. The content generator may only use a number whose fact is `confirmed`, and a fact only
 * becomes auto-confirmed when this returns `match`. Evidence for `match`, in order:
 *   1. the stored excerpt appears verbatim in the text (whitespace/case-insensitive);
 *   2. the text around the value in the excerpt (up to 40 chars before, 25 after) appears with the same number;
 *   3. the value appears as a number within 80 characters of a significant token of the unit (kWh, %, EUR, ...).
 * `mismatch` = the same surrounding words appear with a DIFFERENT number (and no match evidence exists).
 * Anything else is `not_found`. A bare number somewhere on a page is never enough.
 */
import { normaliseText } from './normalise';

export type Verdict = 'match' | 'mismatch' | 'not_found';
export interface StoredFact {
  value: string | null;
  unit?: string | null;
  excerpt?: string | null;
}
export interface FactCheck {
  verdict: Verdict;
  reason: string;
}

const NUM_RE = /\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)*/g;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const UNIT_STOP = new Set(['no', 'vat', 'of', 'per', 'the', 'and', 'for', 'after', 'before', 'incl', 'excl', 'tax', 'month', 'year', 'day', 'to', 'in', 'on', 'at', 'a', 'with', 'from', 'usable']);
const PERCENT_WORDS = ['%', 'percent', 'per cent', 'prozent', 'pour cent', 'por ciento', 'procent', 'por cento', 'per cento', 'procento'];

const fold = (s: string): string => normaliseText(s).toLowerCase();

/** All numeric values a token could denote (ambiguous "1,234" yields both 1234 and 1.234). */
export function parseNumberToken(tok: string): number[] {
  const t = tok.replace(/[   ]/g, '');
  const hasDot = t.includes('.');
  const hasComma = t.includes(',');
  const out: number[] = [];
  const push = (s: string) => {
    const n = Number(s);
    if (Number.isFinite(n)) out.push(n);
  };
  if (hasDot && hasComma) {
    const decimal = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    push(t.split(thousands).join('').replace(decimal, '.'));
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const parts = t.split(sep);
    if (parts.length > 2) push(parts.join(''));
    else if (parts[1]!.length === 3 && parts[0] !== '0' && parts[0]!.length <= 3) {
      push(parts.join('')); // "1,234" or "1.234": thousands...
      push(`${parts[0]}.${parts[1]}`); // ...or decimal
    } else push(`${parts[0]}.${parts[1]}`);
  } else push(t);
  return out;
}

interface NumHit {
  index: number;
  end: number;
  values: number[];
}
function findNumbers(text: string): NumHit[] {
  const hits: NumHit[] = [];
  for (const m of text.matchAll(NUM_RE)) hits.push({ index: m.index!, end: m.index! + m[0].length, values: parseNumberToken(m[0]) });
  return hits;
}
const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const hitEquals = (h: NumHit, target: number): boolean => h.values.some((v) => same(v, Math.abs(target)));

/** Number(s) a stored value asks for. Ranges ("7000-11000") need every number; null = not numeric. */
function targetNumbers(value: string): number[] | null {
  const v = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return [Math.abs(Number(v))];
  if (/^\d[\d.,]*\s*(-|–|to)\s*\d[\d.,]*$/.test(v)) {
    const nums = v.match(/\d[\d.,]*/g)!.map((s) => Number(s.replace(/,(?=\d{3}\b)/g, '')));
    return nums.every(Number.isFinite) ? nums : null;
  }
  return null;
}

function dateVariants(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return [];
  const [, y, mm, dd] = m as unknown as [string, string, string, string];
  const mi = Number(mm);
  const di = Number(dd);
  const month = MONTHS[mi - 1];
  if (!month) return [];
  const out = [iso, `${dd}.${mm}.${y}`, `${di}.${mi}.${y}`, `${dd}/${mm}/${y}`, `${di}/${mi}/${y}`, `${dd}-${mm}-${y}`, `${y}年${mi}月${di}日`, `${di} ${month} ${y}`, `${month} ${di}, ${y}`, `${month} ${di} ${y}`];
  return out.map((s) => s.toLowerCase());
}

function unitTokens(unit: string | null | undefined): { words: string[]; percent: boolean; symbols: string[] } {
  const u = (unit ?? '').toLowerCase();
  const words = (u.match(/[a-zà-ÿ]{2,}/g) ?? []).filter((w) => !UNIT_STOP.has(w));
  const symbols = u.match(/[€$£¥₹]/g) ?? [];
  return { words, percent: u.includes('%'), symbols };
}

/** Is the number at [start,end) in `text` within 80 chars of a significant unit token? */
function unitNear(text: string, start: number, end: number, unit: string | null | undefined): boolean {
  const { words, percent, symbols } = unitTokens(unit);
  if (words.length === 0 && !percent && symbols.length === 0) return false;
  const window = text.slice(Math.max(0, start - 80), end + 80);
  if (percent && PERCENT_WORDS.some((p) => window.includes(p))) return true;
  if (symbols.some((s) => window.includes(s))) return true;
  return words.some((w) => window.includes(w));
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Build a regex from excerpt context around the value: other numbers become slots. Returns the group index of the value slot. */
function contextTemplate(excerpt: string, target: number): { re: RegExp; valueGroup: number } | null {
  const hits = findNumbers(excerpt);
  const idx = hits.findIndex((h) => hitEquals(h, target));
  if (idx < 0) return null;
  const hit = hits[idx]!;
  const from = Math.max(0, hit.index - 40);
  const to = Math.min(excerpt.length, hit.end + 25);
  let pattern = '';
  let cursor = from;
  let group = 0;
  let valueGroup = 0;
  let literal = 0;
  for (const h of hits) {
    if (h.end <= from || h.index >= to) continue;
    const a = Math.max(h.index, from);
    const seg = excerpt.slice(cursor, a);
    pattern += escapeRe(seg).replace(/\s+/g, '\\s+');
    literal += seg.replace(/\s/g, '').length;
    pattern += '(\\d[\\d.,\\s ]*\\d|\\d)';
    group++;
    if (h === hit) valueGroup = group;
    cursor = Math.min(h.end, to);
  }
  const tail = excerpt.slice(cursor, to);
  pattern += escapeRe(tail).replace(/\s+/g, '\\s+');
  literal += tail.replace(/\s/g, '').length;
  if (literal < 8) return null; // not enough words to anchor on
  try {
    return { re: new RegExp(pattern, 'i'), valueGroup };
  } catch {
    return null;
  }
}

export function checkFact(fact: StoredFact, sourceText: string): FactCheck {
  const value = (fact.value ?? '').trim();
  if (value === '') return { verdict: 'not_found', reason: 'fact has no value' };
  const text = fold(sourceText);
  if (text === '') return { verdict: 'not_found', reason: 'source text is empty' };
  const excerpt = fold((fact.excerpt ?? '').slice(0, 400));
  const excerptVerbatim = excerpt.length >= 12 && text.includes(excerpt);

  const targets = targetNumbers(value);
  if (targets) {
    if (excerptVerbatim) return { verdict: 'match', reason: 'excerpt found verbatim' };
    const hits = findNumbers(text);
    // Evidence 2: same words around the number.
    let differs: string | null = null;
    if (targets.length === 1 && excerpt) {
      const tpl = contextTemplate(excerpt, targets[0]!);
      if (tpl) {
        for (const m of text.matchAll(new RegExp(tpl.re.source, 'gi'))) {
          const found = parseNumberToken(m[tpl.valueGroup]!.trim());
          if (found.some((n) => same(n, targets[0]!))) return { verdict: 'match', reason: 'excerpt context found with the same number' };
          differs ??= m[tpl.valueGroup]!.trim();
        }
      }
    }
    // The same words with a different number beat a stray number elsewhere on the page.
    if (differs !== null) return { verdict: 'mismatch', reason: `same wording found with a different number (${differs})` };
    // Evidence 3: value next to the unit.
    const allPresent = targets.every((t) => hits.some((h) => hitEquals(h, t) && (!fact.unit || unitNear(text, h.index, h.end, fact.unit))));
    if (allPresent && (fact.unit ?? '').trim() !== '') return { verdict: 'match', reason: 'value found next to its unit' };
    if (targets.every((t) => hits.some((h) => hitEquals(h, t)))) return { verdict: 'not_found', reason: 'value appears but not next to its unit or excerpt context' };
    return { verdict: 'not_found', reason: 'value not found in source text' };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (excerptVerbatim) return { verdict: 'match', reason: 'excerpt found verbatim' };
    const hit = dateVariants(value).find((d) => text.includes(d));
    // A date alone is weak evidence unless the excerpt's neighbourhood is also present.
    return hit && excerpt && text.includes(excerpt.slice(0, 20)) ? { verdict: 'match', reason: 'date and excerpt start found' } : { verdict: 'not_found', reason: hit ? 'date appears without excerpt context' : 'date not found in source text' };
  }

  const v = fold(value);
  if (excerptVerbatim) return { verdict: 'match', reason: 'excerpt found verbatim' };
  if (v.length >= 12 && text.includes(v)) return { verdict: 'match', reason: 'text value found' };
  return { verdict: 'not_found', reason: 'text value not confirmed by excerpt or long exact phrase' };
}
