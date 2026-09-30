// Price claims: compare Coinbase UTC daily closes with the contract (spec "Daily close", research R4).
// The comparison itself is pure (comparePriceWindow); gatherPriceEvidence fetches the candles.
import { createHash } from 'node:crypto';
import type { PriceTerms } from '../contract/schema.js';
import type { Candle, Coinbase } from '../feeds/coinbase.js';
import type { EvidenceDraft } from './gates.js';
import { PRICE_FEED_SOURCE } from './trust.js';

export type PriceAnswer = { says: 'hit' | 'miss' | 'pending' | 'entity_gone'; eventDate: string | null; value: number | null };

const DAY_MS = 24 * 60 * 60 * 1000;

// Days whose close falls inside (lock_at, deadline_at]: a day counts when its last second (23:59:59 UTC)
// is after lock and not after the deadline — so the deadline's own day counts for a 23:59:59 deadline.
export function windowDays(lockAt: Date, deadlineAt: Date): string[] {
  const days: string[] = [];
  const first = Date.parse(`${lockAt.toISOString().slice(0, 10)}T00:00:00Z`);
  for (let start = first; start <= deadlineAt.getTime(); start += DAY_MS) {
    const lastSecond = start + DAY_MS - 1000;
    if (lastSecond > lockAt.getTime() && lastSecond <= deadlineAt.getTime()) days.push(new Date(start).toISOString().slice(0, 10));
  }
  return days;
}

// A gap never becomes MISS: MISS needs a close for every day the answer depends on (spec FR-019).
export function comparePriceWindow(price: PriceTerms, days: readonly string[], candles: readonly Candle[]): PriceAnswer {
  const closes = new Map(candles.map((c) => [c.day, c.close]));
  const meets = (close: number) => (price.comparison === 'CLOSE_ABOVE' ? close > price.threshold : close < price.threshold);
  const needed = price.window_mode === 'at_deadline' ? days.slice(-1) : days;

  for (const day of needed) {
    const close = closes.get(day);
    if (close !== undefined && meets(close)) return { says: 'hit', eventDate: day, value: close };
  }
  if (needed.length === 0 || needed.some((day) => !closes.has(day))) return { says: 'pending', eventDate: null, value: null };
  const last = needed.at(-1)!;
  return { says: 'miss', eventDate: last, value: closes.get(last)! };
}

export async function gatherPriceEvidence(
  coinbase: Coinbase,
  price: PriceTerms,
  window: { lockAt: Date; deadlineAt: Date },
  now: Date,
): Promise<{ draft: EvidenceDraft; value: number | null; contentSha256: string }> {
  const days = windowDays(window.lockAt, window.deadlineAt);
  const status = await coinbase.productStatus(price.product_id);
  let answer: PriceAnswer;
  let candles: Candle[] = [];
  if (status === 'not_found') {
    answer = { says: 'entity_gone', eventDate: null, value: null };
  } else {
    candles = days.length ? await coinbase.dailyCandles(price.product_id, days[0]!, days.at(-1)!) : [];
    answer = comparePriceWindow(price, days, candles);
    // Missing days on a delisted product will never arrive: the entity is gone (VOID after 3 runs).
    if (answer.says === 'pending' && status !== 'online') answer = { says: 'entity_gone', eventDate: null, value: null };
  }

  return {
    draft: {
      sourceKind: 'price_feed',
      basis: 'record',
      trustLevel: 'primary',
      says: answer.says,
      eventDate: answer.eventDate,
      url: PRICE_FEED_SOURCE,
      retrievedAt: now,
      quoteFound: null,
      isFinalResult: answer.says === 'hit' || answer.says === 'miss',
      originalSource: null,
      simhash: null,
    },
    value: answer.value,
    contentSha256: createHash('sha256').update(JSON.stringify(candles)).digest('hex'),
  };
}
