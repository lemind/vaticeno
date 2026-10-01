// Two user-triggered extras (owner decision 2026-10-01): `selfpromo` = a fixed motto + a fresh AI joke,
// `quote` = a real quote the AI finds on the web, posted only if the page really contains it. Nothing stored.
import { z } from 'zod';
import { recordCosts } from '../db/costs.js';
import { type CallCost, LlmSchemaError } from '../llm/client.js';
import { loadInstruction } from '../llm/instructions.js';
import { log } from '../log.js';
import { captureError } from '../observe.js';
import { weightedLength, X_MAX_CHARS } from '../replies/templates.js';
import type { PageFetcher } from '../resolve/fetch.js';
import { quoteInText } from '../resolve/similarity.js';
import type { ClaimDeps } from '../lifecycle/claims.js';

export type ExtrasDeps = ClaimDeps & { fetchPage: PageFetcher };

export const MOTTOS = [
  "Vaticeno doesn't make predictions. Vaticeno records yours.",
  'Vaticeno keeps what you said on the record.',
  'Vaticeno records the prediction. Time gives the answer.',
  'Vaticeno remembers what you predicted. Then it checks.',
  'Make the prediction. Vaticeno keeps the receipt.',
];
const QUOTE_FIELDS = ['science', 'weather', 'medicine', 'chess', 'sport', 'sailing', 'history', 'military strategy', 'poetry', 'philosophy', 'economics', 'physics'];
const QUOTE_TRIES = 2;
// A bot reply must not tag anyone or carry links (constitution VI): such model output is not used.
const TAGS_OR_LINKS = /[@#]|https?:\/\/|www\./i;

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
const seed = () => Math.random().toString(36).slice(2, 10);

// A motto always; the joke only if the model answers, it fits, and it tags no one.
export async function selfpromoReply(deps: ExtrasDeps): Promise<string> {
  const motto = pick(MOTTOS);
  const costs: CallCost[] = [];
  let reply = motto;
  try {
    const { data, costs: c } = await deps.llm.generateJson({
      model: deps.normalizerModel, instructionVersion: 'joke.v1', operation: 'normalize', system: loadInstruction('joke.v1'),
      input: JSON.stringify({ seed: seed() }), schema: z.object({ joke: z.string().min(1).max(200) }),
    });
    costs.push(...c);
    const withJoke = `${motto}\n\n${data.joke.trim()}`;
    if (!TAGS_OR_LINKS.test(data.joke) && weightedLength(withJoke) <= X_MAX_CHARS) reply = withJoke;
  } catch (error) {
    if (error instanceof LlmSchemaError) costs.push(...error.costs);
    captureError(error, { event: 'selfpromo.joke_failed' }); // the motto alone still goes out
  }
  await saveCosts(deps, costs);
  return reply;
}

const QuoteSchema = z.object({ quote: z.string().min(20).max(200), author: z.string().min(1).max(80), source: z.string().max(80).nullable(), url: z.string().max(500) });

// A quote counts only if its page, fetched by us, contains it word for word AND names the author: no
// invented quotes, no misattributions passed off as verified.
export async function quoteReply(deps: ExtrasDeps, now: Date): Promise<string> {
  const costs: CallCost[] = [];
  let reply: string | null = null;
  for (let attempt = 1; attempt <= QUOTE_TRIES && !reply; attempt++) {
    try {
      const { data, costs: c } = await deps.llm.generateJson({
        model: deps.normalizerModel, instructionVersion: 'quote.v1', operation: 'search', system: loadInstruction('quote.v1'),
        input: JSON.stringify({ seed: seed(), field: pick(QUOTE_FIELDS) }), schema: QuoteSchema, googleSearch: true,
      });
      costs.push(...c);
      reply = await verifiedQuote(deps, data, attempt);
    } catch (error) {
      if (error instanceof LlmSchemaError) costs.push(...error.costs);
      captureError(error, { event: 'quote.failed', attempt });
    }
  }
  await saveCosts(deps, costs);
  // The time keeps the fallback unique: X rejects a post identical to a recent one (see the ping HACK).
  return reply ?? `No quote I could verify right now (${now.toISOString().slice(11, 16)} UTC). ${pick(MOTTOS)}`;
}

async function verifiedQuote(deps: ExtrasDeps, data: z.infer<typeof QuoteSchema>, attempt: number): Promise<string | null> {
  const by = data.source ? `${data.author}, ${data.source}` : data.author;
  const reply = `“${data.quote.trim()}” — ${by}\n\nVaticeno keeps score.`;
  if (!/^https:\/\//.test(data.url) || TAGS_OR_LINKS.test(`${data.quote} ${by}`) || weightedLength(reply) > X_MAX_CHARS) return null;
  let text: string;
  try {
    text = (await deps.fetchPage(data.url)).text;
  } catch (error) {
    log('info', 'quote page unavailable; trying again', { event: 'quote.page_unavailable', attempt, error: String(error) });
    return null;
  }
  const surname = data.author.trim().split(/\s+/).at(-1)!;
  if (!quoteInText(punctuation(data.quote), punctuation(text)) || !text.toLowerCase().includes(surname.toLowerCase())) {
    log('info', 'quote or author not on its page; trying again', { event: 'quote.unverified', attempt });
    return null;
  }
  return reply;
}

// Ellipses and dashes vary between a page and its copy.
const punctuation = (s: string) => s.replace(/…/g, '...').replace(/[‐-―−]/g, '-');

async function saveCosts(deps: ExtrasDeps, costs: CallCost[]) {
  try {
    await recordCosts(deps.db, costs.map((cost) => ({ ...cost, claimId: null })));
  } catch (error) {
    captureError(error, { event: 'extras.costs_failed' }); // never fails the reply: that would retry paid calls
  }
}
