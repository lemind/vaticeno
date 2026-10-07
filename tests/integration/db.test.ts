import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { CLAIM_STATUSES, claims } from '../../src/db/schema.js';
import { canTransition } from '../../src/lifecycle/transitions.js';
import { insertClaim, insertEvidence, insertPosition, setupTestDb, type TestDb } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.truncateAll(); });

const rejected = (promise: Promise<unknown>, pattern: RegExp) => assert.rejects(promise, pattern);

describe('status transitions', () => {
  test('every (from, to) pair in Postgres matches canTransition', async () => {
    for (const from of CLAIM_STATUSES) {
      for (const to of CLAIM_STATUSES) {
        const claim = await insertClaim(t.sql, from);
        const attempt = t.sql`update claims set status = ${to} where id = ${claim.id}`;
        if (canTransition(from, to)) {
          await assert.doesNotReject(attempt, `${from} -> ${to} should be allowed`);
        } else {
          await assert.rejects(attempt, /not allowed/, `${from} -> ${to} should be refused`);
        }
      }
    }
  });

  test('a claim cannot be born locked or resolved', async () => {
    for (const status of ['locked', 'resolving', 'resolved', 'void', 'expired']) {
      await rejected(insertClaim(t.sql, 'draft', { status }), /cannot be created/);
    }
  });
});

describe('contract frozen after lock', () => {
  const frozen: Record<string, unknown> = {
    deadline_at: '2027-06-30T23:59:59Z',
    resolution_method: 'model',
    lock_at: '2026-10-01T00:00:00Z',
    locked_source_version: 'v9',
    locked_source_hash: 'abc',
  };

  test('locked, resolving, resolved, void and expired claims refuse every contract field change', async () => {
    for (const status of ['locked', 'resolving', 'resolved', 'void', 'expired'] as const) {
      const claim = await insertClaim(t.sql, status);
      await rejected(t.sql`update claims set contract = ${JSON.stringify({ changed: true })} where id = ${claim.id}`, /contract fields cannot change/);
      for (const [column, value] of Object.entries(frozen)) {
        await rejected(t.sql`update claims set ${t.sql({ [column]: value })} where id = ${claim.id}`, /contract fields cannot change/);
      }
    }
  });

  test('a draft accepts contract changes; a locked claim still accepts non-contract fields', async () => {
    const draft = await insertClaim(t.sql, 'draft');
    await t.sql`update claims set ${t.sql(frozen)}, amend_count = 1 where id = ${draft.id}`;
    const locked = await insertClaim(t.sql, 'locked');
    await t.sql`update claims set next_check_at = now() where id = ${locked.id}`;
  });
});

describe('insert-only and uniqueness', () => {
  test('positions and evidences reject UPDATE and DELETE', async () => {
    const claim = await insertClaim(t.sql);
    const position = await insertPosition(t.sql, claim.id);
    const evidence = await insertEvidence(t.sql, claim.id);
    await rejected(t.sql`update positions set stance = 'disagree' where id = ${position.id}`, /insert-only/);
    await rejected(t.sql`delete from positions where id = ${position.id}`, /insert-only/);
    await rejected(t.sql`update evidences set says = 'miss' where id = ${evidence.id}`, /insert-only/);
    await rejected(t.sql`delete from evidences where id = ${evidence.id}`, /insert-only/);
  });

  test('one claim per source tweet, one author per claim, one position per user', async () => {
    const claim = await insertClaim(t.sql, 'draft', { source_tweet_id: '42' });
    await rejected(insertClaim(t.sql, 'draft', { source_tweet_id: '42' }), /claims_source_tweet_id_unique/);
    await insertPosition(t.sql, claim.id, { x_user_id: '200' });
    await rejected(insertPosition(t.sql, claim.id, { x_user_id: '201' }), /positions_one_author_idx/);
    await rejected(insertPosition(t.sql, claim.id, { x_user_id: '200', is_author: false }), /positions_claim_user_unique/);
  });

  test('CHECK constraints refuse unknown enum values', async () => {
    await rejected(insertClaim(t.sql, 'draft', { reject_reason: 'bored' }), /claims_reject_reason_check/);
    const claim = await insertClaim(t.sql);
    await rejected(insertEvidence(t.sql, claim.id, { says: 'maybe' }), /evidences_says_check/);
    await rejected(insertEvidence(t.sql, claim.id, { trust_level: 'friend' }), /evidences_trust_level_check/);
  });
});

describe('resolutions', () => {
  const final = { review_status: 'final', decided_by: 'evidence', decided_at: '2027-01-01T01:00:00Z' };

  test('one resolution per claim', async () => {
    const claim = await insertClaim(t.sql, 'resolving');
    await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, review_status: 'needs_human' })}`;
    await rejected(t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, review_status: 'needs_human' })}`, /resolutions_claim_id_unique/);
  });

  test('HIT needs a deciding evidence of the same claim; VOID needs a reason', async () => {
    const claim = await insertClaim(t.sql, 'resolving');
    const other = await insertClaim(t.sql, 'resolving');
    const foreign = await insertEvidence(t.sql, other.id);
    await rejected(t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, outcome: 'hit', ...final })}`, /resolutions_hit_miss_evidence_check/);
    await rejected(t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, outcome: 'hit', deciding_evidence_id: foreign.id, ...final })}`, /does not belong/);
    await rejected(t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, outcome: 'void', ...final })}`, /resolutions_void_reason_required_check/);
  });

  test('a needs_human resolution can be decided once; a final one never changes', async () => {
    const claim = await insertClaim(t.sql, 'resolving');
    const evidence = await insertEvidence(t.sql, claim.id);
    const [row] = await t.sql<{ id: string }[]>`insert into resolutions ${t.sql({ claim_id: claim.id, review_status: 'needs_human' })} returning id`;
    await t.sql`update resolutions set ${t.sql({ outcome: 'hit', deciding_evidence_id: evidence.id, human_notes: 'checked', ...final, decided_by: 'human' })} where id = ${row!.id}`;
    await rejected(t.sql`update resolutions set outcome = 'miss' where id = ${row!.id}`, /is final/);
    await rejected(t.sql`delete from resolutions where id = ${row!.id}`, /is final/);
  });
});

describe('jsonb columns', () => {
  test('contract and gates are stored as JSON objects, not JSON strings', async () => {
    const [viaDrizzle] = await t.db.insert(claims).values({
      slug: 'jsonb1', sourceTweetId: '901', summonTweetId: '901', sourceVersion: 'v1', authorXUserId: '200', status: 'draft', contract: { a: 1 },
    }).returning({ id: claims.id });
    const viaHelper = await insertClaim(t.sql);
    await insertEvidence(t.sql, viaHelper.id);
    const rows = await t.sql<{ contract: string; gates: string | null }[]>`
      select jsonb_typeof(c.contract) as contract, jsonb_typeof(e.gates) as gates
      from claims c left join evidences e on e.claim_id = c.id where c.id in (${viaDrizzle!.id}, ${viaHelper.id})`;
    for (const row of rows) {
      assert.equal(row.contract, 'object');
      if (row.gates) assert.equal(row.gates, 'object');
    }
  });
});

describe('row level security', () => {
  test('RLS is enabled on every table', async () => {
    const rows = await t.sql<{ tablename: string; rowsecurity: boolean }[]>`
      select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`;
    assert.equal(rows.length, 9); // + feed_posts, feed_queue (spec 002)
    for (const row of rows) assert.equal(row.rowsecurity, true, `${row.tablename} has RLS off`);
  });
});
