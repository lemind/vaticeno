// Quotes from Wikiquote's topic pages, fetched live (never stored): free, no AI, every quote attributed
// with its source. Only the sourced part of a page is used, never "Misattributed" or "Disputed".
import { hasTagsOrLinks } from '../replies/templates.js';

const API = 'https://en.wikiquote.org/w/api.php';
const USER_AGENT = 'VaticenoBot/1.0 (https://x.com/vaticeno)'; // Wikimedia asks every client to identify itself
// Also offered to the model that matches a quote to a post (spec 002 T012); it may only pick from these.
export const QUOTE_TOPICS = ['Gambling', 'Betting', 'Luck', 'Chance', 'Risk', 'Prediction', 'Forecasting', 'Speculation', 'Sports', 'Bitcoin'] as const;
const TOPICS: readonly string[] = QUOTE_TOPICS;
const STOP_SECTIONS = /^==+\s*(misattributed|disputed|unsourced|see also|external links|about|quotes about)/i;
const TIMEOUT_MS = 10_000;

export type Quote = { text: string; by: string };

// `topic` (the feed's chosen one) is tried first; the random topics are the fallback, as before.
export async function wikiquoteQuote(pick: <T>(items: readonly T[]) => T, pagesTried = 3, topic?: string): Promise<Quote | null> {
  const shuffled = [...TOPICS].sort(() => Math.random() - 0.5).slice(0, pagesTried);
  const topics = topic ? [topic, ...shuffled.filter((t) => t !== topic)] : shuffled;
  for (const topic of topics) {
    const quotes = quotesOn(await pageWikitext(topic));
    if (quotes.length > 0) return pick(quotes);
  }
  return null;
}

async function pageWikitext(page: string): Promise<string> {
  const url = `${API}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Wikiquote ${res.status} for ${page}`);
  const json = (await res.json()) as { parse?: { wikitext?: string } };
  return json.parse?.wikitext ?? '';
}

// "* quote" followed by "** Author, ''Work'' (year)": only quotes that carry their source line.
export function quotesOn(wikitext: string): Quote[] {
  const quotes: Quote[] = [];
  const lines = wikitext.replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '').split('\n'); // refs can span lines
  for (let i = 0; i < lines.length; i++) {
    if (STOP_SECTIONS.test(lines[i]!)) break;
    if (!/^\*[^*]/.test(lines[i]!) || !/^\*\*[^*]/.test(lines[i + 1] ?? '')) continue;
    if (/^\*\*\*/.test(lines[i + 2] ?? '')) continue; // original / translation / author: not a plain attribution
    const text = plain(lines[i]!.slice(1));
    const by = plain(lines[i + 1]!.slice(2)).replace(/[.,;]\s*(p|pp|vol|ch)\.\s.*$/i, '').slice(0, 90).replace(/[.,;:\s]+$/, '').trim();
    const postable = text.length >= 30 && text.length <= 200 && text.length + by.length <= 270 && !hasTagsOrLinks(text + ' ' + by);
    // The author line must be a name, not a translation note ("Original: …").
    if (postable && /^\p{L}/u.test(by) && !/^(original|variant|translation|translated)\b/i.test(by)) quotes.push({ text, by });
  }
  return quotes;
}

function plain(wiki: string): string {
  return wiki
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\{\{\s*w\s*\|(?:[^|}]*\|)?([^|}]*)\}\}/gi, '$1') // {{w|Name}} / {{w|Page|Name}} → Name
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '') // nested templates: a second pass
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1') // [[link|text]] → text
    .replace(/^(?:w|wikipedia|s|wikisource):/i, '')
    .replace(/(?<=\s|^)(?:w|wikipedia):(?=\S)/gi, '')
    .replace(/\[https?:\/\/\S+\s([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
