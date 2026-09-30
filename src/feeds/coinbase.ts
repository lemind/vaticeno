// Coinbase Exchange public market data: no key, full history, UTC day candles (research R6).
// Goes through the replay store like model calls, so seeds and CI never touch the network.
import { z } from 'zod';
import type { ReplayStore } from '../llm/replay.js';

const BASE = 'https://api.exchange.coinbase.com';
const DAY_S = 86_400;
const MAX_CANDLES = 300; // per request
const TIMEOUT_MS = 15_000;

export class FeedUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FeedUnavailable';
  }
}

const ProductSchema = z.object({ id: z.string(), status: z.string(), trading_disabled: z.boolean().optional() });
// [time (bucket start, unix s), low, high, open, close, volume]
const CandlesSchema = z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]));

export type Candle = { day: string; close: number }; // day = YYYY-MM-DD (UTC) the candle starts

type Recorded = { status: number; body: unknown };

export function createCoinbase(options: { mode: 'live' | 'record' | 'replay'; store: ReplayStore }) {
  const { mode, store } = options;

  async function getJson(path: string): Promise<Recorded> {
    const identity = { path };
    if (mode === 'replay') {
      const entry = await store.get('coinbase', identity);
      if (entry.kind !== 'coinbase') throw new FeedUnavailable('replay entry is not a coinbase response');
      return entry.response as Recorded;
    }
    let recorded: Recorded;
    try {
      const response = await fetch(`${BASE}${path}`, {
        headers: { 'User-Agent': 'vaticeno', Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      recorded = { status: response.status, body: await response.json().catch(() => null) };
    } catch (error) {
      throw new FeedUnavailable(`coinbase request failed: ${String(error)}`, { cause: error });
    }
    if (mode === 'record') await store.put('coinbase', identity, { kind: 'coinbase', response: recorded });
    return recorded;
  }

  // 'online' | 'delisted' | ... as Coinbase reports it; 'not_found' when Coinbase has no such product.
  async function productStatus(productId: string): Promise<string> {
    const { status, body } = await getJson(`/products/${encodeURIComponent(productId)}`);
    if (status === 404) return 'not_found';
    if (status !== 200) throw new FeedUnavailable(`coinbase product ${productId}: HTTP ${status}`);
    const parsed = ProductSchema.safeParse(body);
    if (!parsed.success) throw new FeedUnavailable(`coinbase product ${productId}: unexpected response`);
    return parsed.data.trading_disabled ? 'trading_disabled' : parsed.data.status;
  }

  // FR-004: record a price claim only if the feed answers for the asset.
  async function productExists(productId: string): Promise<boolean> {
    return (await productStatus(productId)) === 'online';
  }

  // Daily candles whose UTC day starts in [fromDay, toDay], ascending. Missing days are simply absent (gaps).
  async function dailyCandles(productId: string, fromDay: string, toDay: string): Promise<Candle[]> {
    const from = Date.parse(`${fromDay}T00:00:00Z`) / 1000;
    const to = Date.parse(`${toDay}T00:00:00Z`) / 1000;
    const byDay = new Map<string, number>();
    for (let start = from; start <= to; start += MAX_CANDLES * DAY_S) {
      const end = Math.min(start + (MAX_CANDLES - 1) * DAY_S, to);
      const query = `granularity=${DAY_S}&start=${iso(start)}&end=${iso(end)}`;
      const { status, body } = await getJson(`/products/${encodeURIComponent(productId)}/candles?${query}`);
      if (status !== 200) throw new FeedUnavailable(`coinbase candles ${productId}: HTTP ${status}`);
      const parsed = CandlesSchema.safeParse(body);
      if (!parsed.success) throw new FeedUnavailable(`coinbase candles ${productId}: unexpected response`);
      for (const [time, , , , close] of parsed.data) {
        if (time >= from && time <= to) byDay.set(iso(time).slice(0, 10), close);
      }
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, close]) => ({ day, close }));
  }

  return { productStatus, productExists, dailyCandles };
}

export type Coinbase = ReturnType<typeof createCoinbase>;

function iso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}
