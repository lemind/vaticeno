// Integration-test database: a fresh, fully migrated database per test file, dropped afterwards.
import { randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import type { Db } from '../../src/db/client.js';
import { createScratchDb } from '../../src/db/scratch.js';
import type { ClaimStatus } from '../../src/lifecycle/transitions.js';
import { randomSlug } from '../../src/contract/slug.js';

export type TestDb = { db: Db; sql: Sql; truncateAll: () => Promise<void>; close: () => Promise<void> };

export async function setupTestDb(): Promise<TestDb> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_URL is required for integration tests (docker compose up -d)');
  const { db, sql, close } = await createScratchDb(adminUrl, 'vaticeno_test');
  return {
    db,
    sql,
    // TRUNCATE does not fire the row-level insert-only triggers.
    truncateAll: async () => {
      await sql`truncate opt_outs, sources, cost_events, resolutions, evidences, positions, claims`;
    },
    close,
  };
}

export const VALID_CONTRACT = {
  subject: 'BTC',
  criterion: 'BTC-USD daily close above 150000',
  deadline_at: '2026-12-31T23:59:59Z',
  source: {
    name: 'Coinbase BTC-USD daily candles',
    kind: 'crypto_price',
    locator: 'https://api.exchange.coinbase.com/products/BTC-USD/candles',
    scope: 'BTC-USD',
    entity_id: 'BTC-USD',
    absence_is_meaningful: false,
    fallback: 'same_issuer_only',
  },
  negative_condition: 'no daily close above 150000 in the window',
  resolution_method: 'price_feed',
  price: { provider: 'coinbase', product_id: 'BTC-USD', comparison: 'CLOSE_ABOVE', threshold: 150000, window_mode: 'any_time_before' },
};

// Statuses a claim may be born with; the others are reached through the Lifecycle.
const PATH_TO: Partial<Record<ClaimStatus, ClaimStatus[]>> = {
  locked: ['locked'],
  resolving: ['locked', 'resolving'],
  resolved: ['locked', 'resolving', 'resolved'],
  void: ['locked', 'resolving', 'void'],
  expired: ['expired'],
};

export type ClaimRow = { id: string; slug: string; status: ClaimStatus };

export async function insertClaim(sql: Sql, status: ClaimStatus = 'draft', overrides: Record<string, unknown> = {}): Promise<ClaimRow> {
  const bornAs = PATH_TO[status] ? 'draft' : status;
  const withContract = bornAs === 'draft';
  const row = {
    slug: randomSlug(6),
    source_tweet_id: String(randomInt(1e12, 9e12)),
    summon_tweet_id: String(randomInt(1e12, 9e12)),
    source_version: 'v1',
    author_x_user_id: '200',
    status: bornAs,
    contract: withContract ? JSON.stringify(VALID_CONTRACT) : null,
    resolution_method: withContract ? 'price_feed' : null,
    deadline_at: withContract ? VALID_CONTRACT.deadline_at : null,
    lock_at: withContract ? '2026-09-29T12:15:00Z' : null,
    ...overrides,
  };
  const [claim] = await sql<ClaimRow[]>`insert into claims ${sql(row)} returning id, slug, status`;
  for (const next of PATH_TO[status] ?? []) {
    await sql`update claims set status = ${next} where id = ${claim!.id}`;
  }
  return { ...claim!, status };
}

export async function insertPosition(sql: Sql, claimId: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const row = { claim_id: claimId, x_user_id: '200', stance: 'agree', is_author: true, ...overrides };
  const [position] = await sql<{ id: string }[]>`insert into positions ${sql(row)} returning id`;
  return position!;
}

export async function insertEvidence(sql: Sql, claimId: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const row = {
    claim_id: claimId,
    run_at: '2027-01-01T01:00:00Z',
    source_kind: 'price_feed',
    basis: 'record',
    source_name: 'coinbase',
    trust_level: 'primary',
    says: 'hit',
    retrieved_at: '2027-01-01T01:00:00Z',
    gates: JSON.stringify({ trusted: true, in_window: true, final: true, independent: true }),
    passed: true,
    ...overrides,
  };
  const [evidence] = await sql<{ id: string }[]>`insert into evidences ${sql(row)} returning id`;
  return evidence!;
}
