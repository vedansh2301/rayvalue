import { createHash } from 'node:crypto';

export type Access = 'html' | 'pdf' | 'rss' | 'json' | 'csv' | 'xlsx' | 'other';
export type RobotsOk = 'yes' | 'no' | 'unknown';

export function accessFromUrl(url: string): Access {
  const path = url.split(/[?#]/)[0]!.toLowerCase();
  if (path.endsWith('.pdf')) return 'pdf';
  if (/\.(rss|atom|xml)$/.test(path) || /\/(feed|rss)\/?$/.test(path)) return 'rss';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.csv')) return 'csv';
  if (/\.xlsx?$/.test(path)) return 'xlsx';
  return 'html';
}

/** Pack `access` cells are messy ("html|pdf", "Wayback 2026...", "direct (CSV cp932)"). Take the first recognised token. */
export function normaliseAccess(raw: string, url = ''): Access {
  const s = raw.toLowerCase();
  const tokens: [RegExp, Access][] = [
    [/\bhtml\b/, 'html'],
    [/\bpdf\b/, 'pdf'],
    [/\b(rss|atom|xml)\b/, 'rss'],
    [/\b(api|json)\b/, 'json'],
    [/\bcsv\b/, 'csv'],
    [/\bxlsx?\b/, 'xlsx'],
  ];
  const found: [number, Access][] = [];
  for (const [re, a] of tokens) {
    const m = re.exec(s);
    if (m) found.push([m.index, a]);
  }
  if (found.length) return found.sort((a, b) => a[0] - b[0])[0]![1];
  return accessFromUrl(url);
}

export function normaliseRobots(raw: string): RobotsOk {
  const s = raw.trim().toLowerCase();
  return s === 'yes' || s === 'no' ? s : 'unknown';
}

export const SOURCE_TYPES = ['regulator', 'ministry', 'utility', 'statute', 'dataset', 'api', 'rss', 'news', 'other'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export function normaliseType(raw: string): SourceType {
  const s = raw.trim().toLowerCase();
  return (SOURCE_TYPES as readonly string[]).includes(s) ? (s as SourceType) : 'other';
}

/** How often to re-fetch. Policy pages change without notice, so slow cadences are capped at 30 days; feeds are daily. */
export function cadenceDays(raw: string, type: string, access: Access): number {
  if (type === 'rss' || type === 'news' || access === 'rss') return 1;
  const s = raw.toLowerCase();
  if (/hourly|live|continuous|daily|event/.test(s)) return 1;
  if (/weekly/.test(s)) return 7;
  if (/static|one-off|decennial|n\/a|rare|5-yearly/.test(s)) return 90;
  return 30;
}

/** Normalise a URL for matching: drop the fragment and a trailing slash (host is lower-cased by URL). */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    const out = u.toString();
    return out.endsWith('/') && u.pathname !== '/' ? out.slice(0, -1) : out;
  } catch {
    return url.trim();
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', euro: '€', pound: '£', copy: '©' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML to visible text: drop scripts, styles, page chrome and comments, then tags. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped);
}

/** Whitespace-normalised text used for hashing and matching: NFC, NBSP/zero-width removed, runs of space collapsed. */
export function normaliseText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[    ​‌‍﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Change-detection hash of already-extracted text. Same visible content gives the same hash regardless of markup/whitespace. */
export const contentHash = (text: string): string => sha256(normaliseText(text));
