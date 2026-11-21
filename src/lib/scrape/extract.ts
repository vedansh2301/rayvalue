import { looksLikeFeed, parseFeed, type FeedItem } from './feed';
import { htmlToText, normaliseText, type Access } from './normalise';

export type Format = 'html' | 'pdf' | 'feed' | 'json' | 'csv' | 'unsupported';
export interface Extracted {
  format: Format;
  /** Whitespace-normalised text used for hashing and fact checks. */
  text: string;
  feedItems: FeedItem[];
}

function charsetOf(contentType: string, head: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head)?.[1];
  return (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase();
}

export function decodeBody(body: Uint8Array, contentType: string): string {
  const head = new TextDecoder('latin1').decode(body.subarray(0, 2048));
  const cs = charsetOf(contentType, head);
  try {
    return new TextDecoder(cs).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

export function detectFormat(body: Uint8Array, contentType: string, access: Access): Format {
  const ct = contentType.toLowerCase();
  if (ct.includes('pdf') || (body[0] === 0x25 && body[1] === 0x50 && body[2] === 0x44 && body[3] === 0x46)) return 'pdf';
  if (ct.includes('spreadsheet') || ct.includes('ms-excel') || ct.includes('officedocument') || ct.includes('zip') || ct.includes('octet-stream') && access === 'xlsx') return 'unsupported';
  if (ct.includes('json')) return 'json';
  if (ct.includes('csv')) return 'csv';
  if (ct.includes('rss') || ct.includes('atom') || ct.includes('xml')) return 'feed';
  if (access === 'xlsx') return 'unsupported';
  if (access === 'rss' && looksLikeFeed(new TextDecoder('latin1').decode(body.subarray(0, 2000)))) return 'feed';
  if (access === 'json') return 'json';
  if (access === 'csv') return 'csv';
  return 'html';
}

/** JSON to deterministic text (sorted keys) so key order never counts as a change. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

async function pdfText(body: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(body));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function extract(body: Uint8Array, contentType: string, access: Access, baseUrl: string): Promise<Extracted> {
  const format = detectFormat(body, contentType, access);
  if (format === 'unsupported') return { format, text: '', feedItems: [] };
  if (format === 'pdf') return { format, text: normaliseText(await pdfText(body)), feedItems: [] };
  const raw = decodeBody(body, contentType);
  if (format === 'feed' || (format === 'html' && looksLikeFeed(raw))) {
    const feedItems = parseFeed(raw, baseUrl);
    return { format: 'feed', text: normaliseText(feedItems.map((i) => `${i.title} | ${i.url} | ${i.publishedAt ?? ''} | ${i.summary}`).join('\n')), feedItems };
  }
  if (format === 'json') {
    try {
      return { format, text: stableJson(JSON.parse(raw)), feedItems: [] };
    } catch {
      return { format, text: normaliseText(raw), feedItems: [] };
    }
  }
  if (format === 'csv') return { format, text: normaliseText(raw), feedItems: [] };
  return { format: 'html', text: normaliseText(htmlToText(raw)), feedItems: [] };
}
