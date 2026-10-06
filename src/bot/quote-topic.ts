// Which Wikiquote page the `quote` command searches first (spec 002 phase 7). A quote always goes out;
// the topic only decides where we look, so every step here is allowed to answer "no idea" and fall
// through. Reading X is the only part that costs money, so the free steps run first and the paid ones
// only when nothing cheaper found a subject.
import { z } from 'zod';
import { recordCosts } from '../db/costs.js';
import { type CallCost, LlmSchemaError } from '../llm/client.js';
import { loadInstruction } from '../llm/instructions.js';
import { log } from '../log.js';
import { captureError } from '../observe.js';
import { QUOTE_TOPICS } from './wikiquote.js';
import type { ExtrasDeps } from './extras.js';

export type QuoteTopic = (typeof QUOTE_TOPICS)[number];
// Which step decided, so the guessed shares in tasks.md phase 7 can be replaced by measured ones.
export type TopicStep = 'words' | 'model' | 'parent' | 'thread' | 'random';

// Whole words only: "sats" must not fire on "satsang", and "bet" must not fire on "better".
const WORDS: ReadonlyArray<[QuoteTopic, readonly string[]]> = [
  ['Bitcoin', ['bitcoin', 'btc', 'sats', 'satoshi', 'crypto', 'ethereum', 'eth', 'altcoin', 'halving']],
  ['Betting', ['bet', 'bets', 'betting', 'odds', 'wager', 'wagers', 'bookie', 'bookmaker', 'parlay', 'punt']],
  ['Gambling', ['gambling', 'gamble', 'gambler', 'casino', 'poker', 'roulette', 'blackjack', 'lottery', 'jackpot']],
  ['Forecasting', ['forecast', 'forecasts', 'forecasting', 'forecaster', 'model', 'models', 'poll', 'polls', 'polling', 'projection', 'projections']],
  ['Speculation', ['speculation', 'speculate', 'speculative', 'bubble', 'mania', 'trade', 'trading', 'trader', 'investor', 'investors']],
  ['Prediction', ['prediction', 'predictions', 'predict', 'predicts', 'predicted', 'prophecy', 'prophet', 'foresee', 'oracle']],
  ['Risk', ['risk', 'risks', 'risky', 'hedge', 'exposure', 'downside', 'volatility', 'dangerous']],
  ['Chance', ['chance', 'chances', 'probability', 'probable', 'probabilities', 'variance', 'coinflip', 'statistics', 'statistical']],
  ['Luck', ['luck', 'lucky', 'unlucky', 'fortune', 'fortunate']],
];

// Free, and it handles the obvious case: "quote about btc". The most specific topic wins, which is why
// WORDS is ordered — Bitcoin before Speculation, Betting before Chance.
export function topicFromWords(text: string): QuoteTopic | null {
  const words = new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  for (const [topic, keywords] of WORDS) {
    if (keywords.some((keyword) => words.has(keyword))) return topic;
  }
  return null;
}

const TopicAnswer = z.object({ topic: z.enum(QUOTE_TOPICS).nullable() });

// One flash-lite call. Any failure is a null, never an exception: the quote still goes out.
export async function topicFromModel(deps: ExtrasDeps, text: string, context: readonly string[] = []): Promise<QuoteTopic | null> {
  const costs: CallCost[] = [];
  try {
    const { data, costs: callCosts } = await deps.llm.generateJson({
      model: deps.normalizerModel,
      instructionVersion: 'quote-topic.v1',
      operation: 'normalize',
      system: loadInstruction('quote-topic.v1'),
      input: JSON.stringify(context.length > 0 ? { text, context } : { text }),
      schema: TopicAnswer,
    });
    costs.push(...callCosts);
    return data.topic;
  } catch (error) {
    if (error instanceof LlmSchemaError) costs.push(...error.costs);
    captureError(error, { event: 'quote.topic_failed' });
    return null;
  } finally {
    if (costs.length > 0) {
      try {
        await recordCosts(deps.db, costs.map((cost) => ({ ...cost, claimId: null })));
      } catch (error) {
        captureError(error, { event: 'quote.topic_costs_failed' });
      }
    }
  }
}

// `readAbove(n)` returns up to n posts above the request, oldest first — paid X reads, so it is called
// only when the free steps found nothing. It returns an empty list when the request is not a reply.
export async function resolveQuoteTopic(
  deps: ExtrasDeps,
  text: string,
  readAbove: (depth: number) => Promise<readonly string[]>,
): Promise<{ topic: QuoteTopic | null; step: TopicStep }> {
  const fromWords = topicFromWords(text);
  if (fromWords) return { topic: fromWords, step: 'words' };

  const fromText = await topicFromModel(deps, text);
  if (fromText) return { topic: fromText, step: 'model' };

  // Nothing in their own words: the post they were replying to is the cheapest context (one read).
  const parent = await readAbove(1);
  if (parent.length > 0) {
    const fromParent = await topicFromModel(deps, text, parent);
    if (fromParent) return { topic: fromParent, step: 'parent' };

    // Still nothing: two more posts above. The last paid step.
    const thread = await readAbove(3);
    if (thread.length > parent.length) {
      const fromThread = await topicFromModel(deps, text, thread);
      if (fromThread) return { topic: fromThread, step: 'thread' };
    }
  }
  return { topic: null, step: 'random' };
}

export function logTopic(tweetId: string, decided: { topic: QuoteTopic | null; step: TopicStep }): void {
  log('info', 'quote topic chosen', { event: 'quote.topic', tweet_id: tweetId, topic: decided.topic, step: decided.step });
}
