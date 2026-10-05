// The feed's money guard, shared by all three jobs (spec 002 FR-008): every paid call is a cost row,
// and the day stops once the cap is reached. Keeping it in one place is why the originals and receipts
// jobs count too — the first version of each had neither (code review 2026-10-05).
import { recordCost } from '../db/costs.js';
import { log } from '../log.js';
import { captureError } from '../observe.js';
import type { Db } from '../db/client.js';
import { feedSpentTodayUsd } from './slots.js';

export type SpendDeps = { db: Db; dailyUsdCap: number };

export async function overSpendCap(deps: SpendDeps, now: Date): Promise<boolean> {
  const spent = await feedSpentTodayUsd(deps.db, now);
  if (spent < deps.dailyUsdCap) return false;
  log('warn', 'feed stopped for the day: spend cap', { event: 'feed.spend_cap', spent_usd: spent, cap_usd: deps.dailyUsdCap });
  return true;
}

export async function recordFeedPost(deps: SpendDeps, usdCost: number, units = 1): Promise<void> {
  await record(deps, 'feed_post', usdCost, units);
}

export async function recordFeedRead(deps: SpendDeps, usdCost: number, units: number): Promise<void> {
  await record(deps, 'feed_read', usdCost, units);
}

async function record(deps: SpendDeps, operation: 'feed_read' | 'feed_post', usdCost: number, units: number): Promise<void> {
  try {
    await recordCost(deps.db, { claimId: null, provider: 'x', operation, units, usdCost });
  } catch (error) {
    captureError(error, { event: 'feed.cost_failed', operation }); // never fails the run
  }
}
