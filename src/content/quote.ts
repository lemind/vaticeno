// The 1-in-10 quote turn (spec 002 FR-004): instead of a plain repost, Vaticeno adds one line of its
// own — a sourced quote that fits the post, or a short joke. The model never writes the quote itself: it
// only names the topic, and the quote comes from the checked Wikiquote source the `quote` command uses.
import { z } from 'zod';
import { recordCosts } from '../db/costs.js';
import { type CallCost, LlmSchemaError } from '../llm/client.js';
import { loadInstruction } from '../llm/instructions.js';
import { QUOTE_TOPICS, type Quote, wikiquoteQuote } from '../bot/wikiquote.js';
import { log } from '../log.js';
import { captureError } from '../observe.js';
import { hasTagsOrLinks, weightedLength } from '../replies/templates.js';
import type { ExtrasDeps } from '../bot/extras.js';

export type QuoteMode = 'quote' | 'joke';
// Our own line is short on purpose: the quoted post carries the content (FR-004).
export const MAX_OUR_CHARS = 200;

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

// Everything we add to a post passes this: short, no tags, no links, no hashtags (constitution VI 2.4.0).
export function ourLineFits(text: string): boolean {
  const line = text.trim();
  return line.length > 0 && weightedLength(line) <= MAX_OUR_CHARS && !hasTagsOrLinks(line);
}

export type QuoteDeps = ExtrasDeps & { quoteSource?: (topic?: string) => Promise<Quote | null> };

// The line to put above the quoted post, or null — then the caller reposts it plainly instead.
export async function ourLineFor(deps: QuoteDeps, postText: string, mode: QuoteMode): Promise<string | null> {
  const costs: CallCost[] = [];
  try {
    const line = mode === 'joke' ? await joke(deps, postText, costs) : await sourcedQuote(deps, postText, costs);
    return line && ourLineFits(line) ? line.trim() : null;
  } catch (error) {
    if (error instanceof LlmSchemaError) costs.push(...error.costs);
    log('info', 'no line for the quote turn; reposting plainly', { event: 'feed.line_unavailable', mode, error: String(error) });
    return null;
  } finally {
    await saveCosts(deps, costs);
  }
}

async function joke(deps: QuoteDeps, postText: string, costs: CallCost[]): Promise<string | null> {
  const { data, costs: c } = await deps.llm.generateJson({
    model: deps.normalizerModel,
    instructionVersion: 'feed.v1',
    operation: 'feed_model',
    system: loadInstruction('feed.v1'),
    input: JSON.stringify({ mode: 'joke', post: postText }),
    schema: z.object({ line: z.string().min(1).max(MAX_OUR_CHARS) }),
  });
  costs.push(...c);
  return data.line;
}

// The model picks the topic; the quote is read from Wikiquote and comes with its author.
async function sourcedQuote(deps: QuoteDeps, postText: string, costs: CallCost[]): Promise<string | null> {
  let topic: string | undefined;
  try {
    const { data, costs: c } = await deps.llm.generateJson({
      model: deps.normalizerModel,
      instructionVersion: 'feed.v1',
      operation: 'feed_model',
      system: loadInstruction('feed.v1'),
      input: JSON.stringify({ mode: 'quote', post: postText }),
      schema: z.object({ topic: z.enum(QUOTE_TOPICS) }),
    });
    costs.push(...c);
    topic = data.topic;
  } catch (error) {
    if (error instanceof LlmSchemaError) costs.push(...error.costs);
    captureError(error, { event: 'feed.topic_failed' }); // a random topic still gives a real quote
  }
  const quote = await (deps.quoteSource ?? ((t?: string) => wikiquoteQuote(pick, 3, t)))(topic);
  return quote ? `“${quote.text}” — ${quote.by}` : null;
}

async function saveCosts(deps: QuoteDeps, costs: CallCost[]): Promise<void> {
  if (costs.length === 0) return;
  try {
    await recordCosts(deps.db, costs.map((cost) => ({ ...cost, claimId: null })));
  } catch (error) {
    captureError(error, { event: 'feed.costs_failed' }); // never fails the run: that would retry paid calls
  }
}
