// The repost pool (spec 002 FR-001): a fixed list the owner owns; the bot never adds an account.
// Scores and the weight table live in docs/content-rules.md — weight = popularity + virality + relevance
// − 15, so the strongest accounts come up about five times as often as the weakest.
import { log } from '../log.js';
import { POOL_IDS } from './pool-ids.js';

export const POOL_FIELDS = ['forecasting', 'statistics', 'crypto', 'sport'] as const;
export type PoolField = (typeof POOL_FIELDS)[number];

export type PoolEntry = { handle: string; field: PoolField; weight: number; enabled: boolean };
export type PoolAccount = PoolEntry & { id: string };

// The platform account the owner keeps outside the repo: configured by id (FEED_PLATFORM_ACCOUNT_ID),
// so its handle never appears here. Skipped when the id is unset.
export const PLATFORM_HANDLE = 'platform';

export const POOL: readonly PoolEntry[] = [
  { handle: 'FabrizioRomano', field: 'sport', weight: 15, enabled: true },
  { handle: 'AdamSchefter', field: 'sport', weight: 15, enabled: true },
  { handle: PLATFORM_HANDLE, field: 'forecasting', weight: 14, enabled: true },
  { handle: 'NateSilver538', field: 'statistics', weight: 13, enabled: true },
  { handle: 'Kalshi', field: 'forecasting', weight: 12, enabled: true },
  { handle: '100trillionUSD', field: 'crypto', weight: 12, enabled: true },
  { handle: 'RaoulGMI', field: 'crypto', weight: 10, enabled: true },
  { handle: 'StatMuse', field: 'sport', weight: 10, enabled: true },
  { handle: 'OptaJoe', field: 'sport', weight: 10, enabled: true },
  { handle: 'ESPNStatsInfo', field: 'sport', weight: 10, enabled: true },
  { handle: 'OptaAnalyst', field: 'sport', weight: 8, enabled: true },
  { handle: 'OurWorldInData', field: 'statistics', weight: 6, enabled: true },
  { handle: 'gelliottmorris', field: 'statistics', weight: 6, enabled: true },
  { handle: 'metaculus', field: 'forecasting', weight: 5, enabled: true },
  { handle: 'Statsbomb', field: 'sport', weight: 4, enabled: true },
  { handle: 'ManifoldMarkets', field: 'forecasting', weight: 4, enabled: true },
  { handle: '_1woonomic', field: 'crypto', weight: 3, enabled: true },
];

// The accounts a run may read: enabled, and with a known numeric id (T003's lookup, or the env var).
// A handle with no id is skipped — but loudly: silently shrinking the pool would re-weight every account.
export function poolAccounts(
  platformAccountId?: string,
  ids: Readonly<Record<string, string>> = POOL_IDS,
  pool: readonly PoolEntry[] = POOL,
): PoolAccount[] {
  return pool.flatMap((entry) => {
    if (!entry.enabled) return [];
    const id = entry.handle === PLATFORM_HANDLE ? platformAccountId : ids[entry.handle];
    if (!id) {
      if (entry.handle !== PLATFORM_HANDLE) log('warn', 'pool account has no id; skipped', { event: 'feed.pool_id_missing', handle: entry.handle });
      return [];
    }
    return [{ ...entry, id }];
  });
}

// One account per run, by weight, never the one the previous run used (FR-002). `random` returns [0, 1).
export function pickAccount(
  accounts: readonly PoolAccount[],
  previousId: string | null,
  random: () => number = Math.random,
): PoolAccount | null {
  const eligible = accounts.filter((account) => account.id !== previousId);
  const total = eligible.reduce((sum, account) => sum + account.weight, 0);
  if (total <= 0) return null;
  let ticket = random() * total;
  for (const account of eligible) {
    ticket -= account.weight;
    if (ticket < 0) return account;
  }
  return eligible[eligible.length - 1] ?? null; // only reachable on a rounding edge
}
