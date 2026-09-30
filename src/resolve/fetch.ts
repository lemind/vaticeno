// Fetch one source page and extract its visible text, in memory only (FR-029). Replay files keep the
// fingerprint (final URL, sha256, simhash, time, status) — never the text.
import { createHash } from 'node:crypto';
import type { ReplayStore } from '../llm/replay.js';
import { simhash } from './similarity.js';

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 3_000_000;
export const MAX_TEXT_CHARS = 40_000; // what the judge reads; keeps a judge call around a cent

// transient = network error, timeout, 429 or 5xx: retry later. Otherwise the page answered but can't be
// read (404, 403, not HTML, empty) — a real "nothing here", not an outage.
export class SourceUnavailable extends Error {
  readonly transient: boolean;
  constructor(message: string, options?: { cause?: unknown; transient?: boolean }) {
    super(message, options);
    this.name = 'SourceUnavailable';
    this.transient = options?.transient ?? true;
  }
}

const isTransientStatus = (status: number) => status === 0 || status === 429 || status >= 500;

export type FetchedPage = {
  url: string; // final URL after redirects
  text: string; // visible text, in memory only; empty in replay mode
  sha256: string;
  simhash: string | null;
  retrievedAt: Date;
};

export function createPageFetcher(options: { mode: 'live' | 'record' | 'replay'; store: ReplayStore }) {
  const { mode, store } = options;

  return async function fetchPage(url: string): Promise<FetchedPage> {
    if (mode === 'replay') {
      const entry = await store.get('fetch', { url });
      if (entry.kind !== 'fetch') throw new Error(`replay entry for fetch ${url} has kind ${entry.kind}`);
      if (entry.status < 200 || entry.status >= 300 || !entry.sha256) {
        throw new SourceUnavailable(`recorded fetch of ${url}: HTTP ${entry.status}`, { transient: isTransientStatus(entry.status) });
      }
      return { url: entry.url, text: '', sha256: entry.sha256, simhash: entry.simhash, retrievedAt: new Date(entry.retrieved_at) };
    }

    const retrievedAt = new Date();
    let finalUrl = url;
    let status = 0;
    let text = '';
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; vaticeno/0.1; +https://vaticeno.app)', Accept: 'text/html,text/plain' },
      });
      finalUrl = response.url || url;
      status = response.status;
      const type = response.headers.get('content-type') ?? '';
      if (response.ok && /text\/(html|plain)|application\/xhtml/.test(type)) {
        text = visibleText(await readCapped(response));
      } else if (response.ok) {
        status = 415; // PDFs, images…: not readable as a page here
      }
    } catch (error) {
      if (mode === 'record') await store.put('fetch', { url }, { kind: 'fetch', url, sha256: null, simhash: null, retrieved_at: retrievedAt.toISOString(), status: 0 });
      throw new SourceUnavailable(`fetch ${url} failed: ${String(error)}`, { cause: error });
    }

    const ok = status >= 200 && status < 300 && text.length > 0;
    const sha256 = ok ? createHash('sha256').update(text).digest('hex') : null;
    const fingerprint = ok ? simhash(text) : null;
    if (mode === 'record') {
      await store.put('fetch', { url }, { kind: 'fetch', url: finalUrl, sha256, simhash: fingerprint, retrieved_at: retrievedAt.toISOString(), status });
    }
    if (!ok || !sha256) throw new SourceUnavailable(`fetch ${url}: HTTP ${status}`, { transient: isTransientStatus(status) });
    return { url: finalUrl, text: text.slice(0, MAX_TEXT_CHARS), sha256, simhash: fingerprint, retrievedAt };
  };
}

export type PageFetcher = ReturnType<typeof createPageFetcher>;

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// Visible text of an HTML page: no scripts, styles or tags; entities decoded; whitespace collapsed.
export function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|td|th|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, decodeEntity)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

function decodeEntity(match: string, body: string): string {
  if (body.startsWith('#')) {
    const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
  }
  return NAMED[body.toLowerCase()] ?? match;
}
