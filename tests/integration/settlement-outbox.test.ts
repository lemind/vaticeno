// The settlement outbox, Node's side (003 T331–T336a): which claims get a row, when a verdict may move a
// stake, and what the worker's role can and cannot write. The worker's own side is tested with it (T333).
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  type Candle,
  type Coinbase,
  FeedUnavailable,
} from '../../src/feeds/coinbase.js';
import type { ClaimDeps } from '../../src/lifecycle/claims.js';
import { lockDueDrafts } from '../../src/lifecycle/lock.js';
import { createMemorySourceReader } from '../../src/lifecycle/source-reader.js';
import type { LlmClient } from '../../src/llm/client.js';
import { decideByHuman } from '../../src/resolve/manual.js';
import { type ResolverDeps, resolveDueClaims } from '../../src/resolve/resolver.js';
import {
  confirmBeforeResolving,
  confirmStakedVerdicts,
} from '../../src/resolve/settlement.js';
import { insertClaim, setupTestDb, type TestDb, VALID_CONTRACT } from './helpers.js';

let t: TestDb;
before(async () => {
  t = await setupTestDb();
});
after(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.truncateAll();
});

const LOCK = '2026-10-01T12:00:00Z';
const DEADLINE = '2026-10-05T23:59:59Z';
const AFTER = new Date('2026-10-06T01:00:00Z');
const NEXT_HOUR = new Date('2026-10-06T02:00:00Z');
const POST = '7001';

function days(from: string, n: number, close: (i: number) => number): Candle[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    day: new Date(start + i * 86400e3).toISOString().slice(0, 10),
    close: close(i),
  }));
}

const ABOVE = days('2026-10-01', 5, (i) => (i === 3 ? 150_001 : 100_000));
const BELOW = days('2026-10-01', 5, () => 100_000);

function resolverDeps(candles: Candle[] | 'outage') {
  const reads = { candles: 0 };
  const coinbase = {
    productStatus: async () => {
      if (candles === 'outage') throw new FeedUnavailable('down');
      return 'online';
    },
    dailyCandles: async () => {
      reads.candles++;
      if (candles === 'outage') throw new FeedUnavailable('down');
      return candles;
    },
  } as unknown as Coinbase;
  const deps: ResolverDeps = {
    db: t.db,
    llm: { mode: 'replay' } as unknown as LlmClient,
    coinbase,
    fetchPage: (async () => {
      throw new Error('a price claim never reads a page');
    }) as ResolverDeps['fetchPage'],
    judgeModelA: 'a',
    judgeModelB: 'b',
    arbiterModel: 'c',
  };
  return { deps, reads };
}

// A draft due to lock, with its post unchanged since recording.
async function dueDraft(resolutionMethod: 'price_feed' | 'model') {
  const contract =
    resolutionMethod === 'price_feed'
      ? { ...VALID_CONTRACT, deadline_at: DEADLINE }
      : {
          ...VALID_CONTRACT,
          resolution_method: 'model',
          price: undefined,
          deadline_at: DEADLINE,
        };
  const claim = await insertClaim(t.sql, 'draft', {
    contract: JSON.stringify(contract),
    resolution_method: resolutionMethod,
    deadline_at: DEADLINE,
    lock_at: LOCK,
    source_tweet_id: POST,
  });
  const reader = createMemorySourceReader({
    [POST]: { versionId: 'v1', text: 'BTC above 150k' },
  });
  const deps = { db: t.db, reader } as unknown as ClaimDeps & {
    reader: typeof reader;
  };
  return { claim, deps };
}

// A price claim already locked with its outbox row, as T331a leaves it.
async function lockedWithRow() {
  const claim = await insertClaim(t.sql, 'locked', {
    contract: JSON.stringify({ ...VALID_CONTRACT, deadline_at: DEADLINE }),
    resolution_method: 'price_feed',
    deadline_at: DEADLINE,
    lock_at: LOCK,
    next_check_at: DEADLINE,
  });
  await t.sql`insert into settlement_outbox ${t.sql({ claim_id: claim.id, network: '84532' })}`;
  return claim;
}

const outbox = async (claimId: string) =>
  (await t.sql`select * from settlement_outbox where claim_id = ${claimId}`)[0];

describe('which claims get a row (T331a)', () => {
  test('a price-feed claim gets its row in the same step that locks it', async () => {
    const { claim, deps } = await dueDraft('price_feed');
    const [result] = await lockDueDrafts(deps, new Date(LOCK));
    assert.equal(result!.outcome, 'locked');
    const row = await outbox(claim.id);
    assert.deepEqual(
      [row!.state, row!.outcome, row!.open_authorization],
      ['open', null, null],
    );
  });

  test('a model-judged claim locks with no row: it can never carry a stake', async () => {
    const { claim, deps } = await dueDraft('model');
    const [result] = await lockDueDrafts(deps, new Date(LOCK));
    assert.equal(result!.outcome, 'locked');
    assert.equal(await outbox(claim.id), undefined);
  });

  test('a claim has one row per network at most', async () => {
    const claim = await lockedWithRow();
    await assert.rejects(
      t.sql`insert into settlement_outbox ${t.sql({ claim_id: claim.id, network: '84532' })}`,
      /settlement_outbox_claim_network_unique/,
    );
    await t.sql`insert into settlement_outbox ${t.sql({ claim_id: claim.id, network: '421614' })}`;
  });

  test('a claim locks with one row on each network switched on (FR-036d)', async () => {
    const { claim, deps } = await dueDraft('price_feed');
    await lockDueDrafts(
      { ...deps, settlementNetworks: ['84532', '421614'] },
      new Date(LOCK),
    );
    const rows = await t.sql`select network from settlement_outbox
      where claim_id = ${claim.id} order by network`;
    assert.deepEqual(
      rows.map((r) => r.network),
      ['421614', '84532'],
    );
  });
});

describe('when a verdict may move a stake (T332, T332a, T336)', () => {
  test('a final price verdict is set on the row only after a second read agrees', async () => {
    const claim = await lockedWithRow();
    await resolveDueClaims(resolverDeps(ABOVE).deps, AFTER);
    assert.equal(
      (await outbox(claim.id))!.state,
      'open',
      'the verdict alone moves nothing',
    );

    const { deps, reads } = resolverDeps(ABOVE);
    assert.deepEqual(await confirmStakedVerdicts(deps, NEXT_HOUR), {
      confirmed: 1,
      held: 0,
      skipped: 0,
    });
    assert.equal(reads.candles, 1, 'the price was read again');
    const row = await outbox(claim.id);
    assert.deepEqual([row!.state, row!.outcome], ['pending', 'hit']);
  });

  test('a second read that disagrees holds the row: nothing settles, and the timeout refunds', async () => {
    const claim = await lockedWithRow();
    await resolveDueClaims(resolverDeps(ABOVE).deps, AFTER);
    assert.deepEqual(
      await confirmStakedVerdicts(resolverDeps(BELOW).deps, NEXT_HOUR),
      {
        confirmed: 0,
        held: 1,
        skipped: 0,
      },
    );
    const row = await outbox(claim.id);
    assert.deepEqual(
      [row!.state, row!.outcome],
      ['held', 'hit'],
      'the published verdict, held',
    );
  });

  test('a source outage on the second read is not a disagreement: the row waits for the next run', async () => {
    const claim = await lockedWithRow();
    await resolveDueClaims(resolverDeps(ABOVE).deps, AFTER);
    assert.deepEqual(
      await confirmStakedVerdicts(resolverDeps('outage').deps, NEXT_HOUR),
      {
        confirmed: 0,
        held: 0,
        skipped: 1,
      },
    );
    assert.equal((await outbox(claim.id))!.state, 'open');
    await confirmStakedVerdicts(resolverDeps(ABOVE).deps, NEXT_HOUR);
    assert.equal((await outbox(claim.id))!.state, 'pending');
  });

  test('a verdict still waiting for a human moves nothing', async () => {
    const claim = await lockedWithRow();
    await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, review_status: 'needs_human' })}`;
    assert.deepEqual(
      await confirmStakedVerdicts(resolverDeps(ABOVE).deps, NEXT_HOUR),
      {
        confirmed: 0,
        held: 0,
        skipped: 0,
      },
    );
    assert.equal((await outbox(claim.id))!.state, 'open');
  });

  test("a human's verdict is the second look: set without reading the source again", async () => {
    const claim = await lockedWithRow();
    await t.sql`update claims set status = 'resolving' where id = ${claim.id}`;
    await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, review_status: 'needs_human' })}`;
    await decideByHuman(t.db, {
      slug: claim.slug,
      outcome: 'void',
      voidReason: 'unresolvable',
      note: 'the source stopped publishing',
      now: AFTER,
    });
    const { deps, reads } = resolverDeps(ABOVE);
    assert.deepEqual(await confirmStakedVerdicts(deps, NEXT_HOUR), {
      confirmed: 1,
      held: 0,
      skipped: 0,
    });
    assert.equal(reads.candles, 0);
    assert.deepEqual(
      [(await outbox(claim.id))!.state, (await outbox(claim.id))!.outcome],
      ['pending', 'void'],
    );
  });

  test('one claim that cannot be read again never stops the others, nor the resolver', async () => {
    const good = await lockedWithRow();
    await resolveDueClaims(resolverDeps(ABOVE).deps, AFTER);
    // Born broken: a locked claim's contract cannot change afterwards, which the database enforces.
    const broken = await insertClaim(t.sql, 'void', {
      contract: '{}',
      resolution_method: 'price_feed',
      deadline_at: DEADLINE,
      lock_at: LOCK,
    });
    await t.sql`insert into settlement_outbox ${t.sql({ claim_id: broken.id, network: '84532' })}`;
    await t.sql`insert into resolutions ${t.sql({
      claim_id: broken.id,
      outcome: 'void',
      void_reason: 'unresolvable',
      decided_by: 'evidence',
      review_status: 'final',
      decided_at: AFTER.toISOString(),
    })}`;

    const { deps } = resolverDeps(ABOVE);
    const result = await confirmStakedVerdicts(deps, NEXT_HOUR);
    assert.deepEqual([result.confirmed, result.skipped], [1, 1]);
    assert.equal((await outbox(good.id))!.state, 'pending');
    assert.equal((await outbox(broken.id))!.state, 'open', 'tried again next run');

    // And when the whole step fails, the resolver still runs.
    const failing = {
      ...deps,
      db: {
        select: () => {
          throw new Error('boom');
        },
      },
    } as unknown as ResolverDeps;
    await confirmBeforeResolving(failing, NEXT_HOUR);
  });

  test('a confirmed row is not confirmed twice', async () => {
    await lockedWithRow();
    await resolveDueClaims(resolverDeps(ABOVE).deps, AFTER);
    await confirmStakedVerdicts(resolverDeps(ABOVE).deps, NEXT_HOUR);
    const { deps, reads } = resolverDeps(ABOVE);
    assert.deepEqual(await confirmStakedVerdicts(deps, NEXT_HOUR), {
      confirmed: 0,
      held: 0,
      skipped: 0,
    });
    assert.equal(reads.candles, 0);
  });
});

describe('the row once set (data-model → settlement_outbox)', () => {
  test('an outcome never changes once set', async () => {
    const claim = await lockedWithRow();
    await t.sql`update settlement_outbox set outcome = 'hit', state = 'pending' where claim_id = ${claim.id}`;
    await assert.rejects(
      t.sql`update settlement_outbox set outcome = 'miss' where claim_id = ${claim.id}`,
      /outcome is frozen/,
    );
  });

  test('a state past open always carries an outcome', async () => {
    const claim = await lockedWithRow();
    await assert.rejects(
      t.sql`update settlement_outbox set state = 'pending' where claim_id = ${claim.id}`,
      /settlement_outbox_outcome_state_check/,
    );
  });
});

describe("the worker's role (settle_rw, FR-028a)", () => {
  // Each attempt runs as settle_rw inside a transaction that is rolled back, so nothing persists.
  async function asWorker(statement: (sql: TestDb['sql']) => Promise<unknown>) {
    return t.sql.begin(async (sql) => {
      await sql`set local role settle_rw`;
      return statement(sql as unknown as TestDb['sql']);
    });
  }

  test('it reads the claim and its verdict, and writes back what it did', async () => {
    const claim = await lockedWithRow();
    await t.sql`update settlement_outbox set outcome = 'hit', state = 'pending' where claim_id = ${claim.id}`;
    const updated = await asWorker(
      (
        sql,
      ) => sql`update settlement_outbox set state = 'sent', tx_references = '{0xabc}', sent_at = now()
        where claim_id = ${claim.id} returning state`,
    );
    assert.equal((updated as { state: string }[])[0]!.state, 'sent');
    const seen = await asWorker(
      (sql) => sql`select slug from claims where id = ${claim.id}`,
    );
    assert.equal((seen as unknown[]).length, 1);
  });

  test('it cannot write an outcome, so it cannot decide what a stake pays', async () => {
    const claim = await lockedWithRow();
    await assert.rejects(
      asWorker(
        (sql) =>
          sql`update settlement_outbox set outcome = 'hit' where claim_id = ${claim.id}`,
      ),
      /permission denied/,
    );
  });

  test('it beats its own heartbeat and no other job, and cannot move its own window (FR-020a)', async () => {
    // Other suites clear job_state, so the row the migration seeds is put back first.
    await t.sql`insert into job_state (job, stale_after_seconds) values ('settle-84532', 180) on conflict do nothing`;
    await t.sql`insert into job_state (job, stale_after_seconds) values ('resolve', 7260) on conflict do nothing`;
    const own = await asWorker(
      (sql) =>
        sql`update job_state set last_ok_at = now(), last_outcome = 'ok' where job = 'settle-84532' returning job`,
    );
    assert.equal((own as unknown[]).length, 1);
    const other = await asWorker(
      (sql) =>
        sql`update job_state set last_ok_at = now() where job = 'resolve' returning job`,
    );
    assert.equal(
      (other as unknown[]).length,
      0,
      'row-level security hides every other job',
    );
    // A new network's worker registers its own heartbeat, and nothing but a `settle-` one.
    const registered = await asWorker(
      (sql) =>
        sql`insert into job_state (job, stale_after_seconds) values ('settle-421614', 180) returning job`,
    );
    assert.equal((registered as unknown[]).length, 1);
    await assert.rejects(
      asWorker(
        (sql) =>
          sql`insert into job_state (job, stale_after_seconds) values ('resolve-2', 180)`,
      ),
      /row-level security/,
    );
    await assert.rejects(
      asWorker(
        (sql) =>
          sql`update job_state set stale_after_seconds = 1 where job = 'settle-84532'`,
      ),
      /permission denied/,
    );
  });

  test('it cannot insert a row, nor touch any other table', async () => {
    const claim = await lockedWithRow();
    await t.sql`delete from settlement_outbox where claim_id = ${claim.id}`;
    await assert.rejects(
      asWorker(
        (sql) =>
          sql`insert into settlement_outbox ${sql({ claim_id: claim.id, network: '84532' })}`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      asWorker(
        (sql) => sql`update claims set status = 'void' where id = ${claim.id}`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      asWorker((sql) => sql`select * from evidences`),
      /permission denied/,
    );
  });
});
