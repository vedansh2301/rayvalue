import { decodeEntities, htmlToText, normaliseText } from './normalise';

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string;
}

const cdata = (s: string): string => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const clean = (s: string): string => normaliseText(htmlToText(decodeEntities(cdata(s))));

function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(block);
    if (m) return m[1]!;
  }
  return null;
}

function link(block: string): string | null {
  // Atom: <link rel="alternate" href="..."/> (prefer alternate / no rel); RSS: <link>url</link>.
  const atom = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]!).filter((a) => /href=/i.test(a));
  const best = atom.find((a) => !/rel=/i.test(a) || /rel=["']alternate["']/i.test(a)) ?? atom[0];
  if (best) return /href=["']([^"']+)["']/i.exec(best)?.[1] ?? null;
  const t = tag(block, ['link']);
  return t ? cdata(t).trim() : null;
}

function isoDate(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(cdata(raw).trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Parse RSS 2.0, RSS 1.0 (RDF) or Atom into items. Items without a title or an http(s) link are dropped. */
export function parseFeed(xml: string, baseUrl = ''): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const items: FeedItem[] = [];
  for (const b of blocks) {
    const title = clean(tag(b, ['title']) ?? '');
    let url = link(b);
    if (url) {
      url = decodeEntities(url.trim());
      try {
        url = new URL(url, baseUrl || undefined).toString();
      } catch {
        url = null;
      }
    }
    if (!title || !url || !/^https?:\/\//.test(url)) continue;
    items.push({
      title,
      url,
      publishedAt: isoDate(tag(b, ['pubDate', 'published', 'updated', 'dc:date'])),
      summary: clean(tag(b, ['description', 'summary', 'content:encoded', 'content']) ?? '').slice(0, 1000),
    });
  }
  return items;
}

export const looksLikeFeed = (text: string): boolean => /<(rss|feed|rdf:RDF)\b/i.test(text.slice(0, 2000));
