// Two user-triggered extras (owner decision 2026-10-01): `selfpromo` = a fixed motto + a fresh AI joke,
// `quote` = a sourced quote from Wikiquote (2026-10-04: free, no AI). Nothing stored.
import { z } from 'zod';
import { recordCosts } from '../db/costs.js';
import { type CallCost, LlmSchemaError } from '../llm/client.js';
import { loadInstruction } from '../llm/instructions.js';
import { log } from '../log.js';
import { captureError } from '../observe.js';
import { hasTagsOrLinks, weightedLength, X_MAX_CHARS } from '../replies/templates.js';
import type { PageFetcher } from '../resolve/fetch.js';
import { type Quote, wikiquoteQuote } from './wikiquote.js';
import type { ClaimDeps } from '../lifecycle/claims.js';

// quoteSource: Wikiquote by default; tests pass their own.
export type ExtrasDeps = ClaimDeps & { fetchPage: PageFetcher; quoteSource?: () => Promise<Quote | null> };

export const MOTTOS = [
  "Vaticeno doesn't make predictions. Vaticeno records yours.",
  'Vaticeno keeps what you said on the record.',
  'Vaticeno records the prediction. Time gives the answer.',
  'Vaticeno remembers what you predicted. Then it checks.',
  'Make the prediction. Vaticeno keeps the receipt.',
];

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
    if (!hasTagsOrLinks(data.joke) && weightedLength(withJoke) <= X_MAX_CHARS) reply = withJoke;
  } catch (error) {
    if (error instanceof LlmSchemaError) costs.push(...error.costs);
    captureError(error, { event: 'selfpromo.joke_failed' }); // the motto alone still goes out
  }
  await saveCosts(deps, costs);
  return reply;
}

// A quote from Wikiquote (free, attributed, never stored); null when it can't be fetched right now — the
// caller retries later instead of replying with a fallback.
export async function quoteReply(deps: ExtrasDeps): Promise<string | null> {
  try {
    const quote = await (deps.quoteSource ?? (() => wikiquoteQuote(pick)))();
    if (!quote) return null;
    const reply = `“${quote.text}” — ${quote.by}`;
    // Never an unattributed or cut quote: one that doesn't fit is skipped (the next try picks another).
    return weightedLength(reply) <= X_MAX_CHARS && !hasTagsOrLinks(reply) ? reply : null;
  } catch (error) {
    log('info', 'quote source unavailable', { event: 'quote.unavailable', error: String(error) });
    return null;
  }
}

async function saveCosts(deps: ExtrasDeps, costs: CallCost[]) {
  try {
    await recordCosts(deps.db, costs.map((cost) => ({ ...cost, claimId: null })));
  } catch (error) {
    captureError(error, { event: 'extras.costs_failed' }); // never fails the reply: that would retry paid calls
  }
}
