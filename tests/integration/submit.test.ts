import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { Proposal } from '../../src/contract/proposal.js';
import type { Coinbase } from '../../src/feeds/coinbase.js';
import { type ClaimDeps, submitClaim } from '../../src/lifecycle/claims.js';
import type { LlmClient } from '../../src/llm/client.js';
import { NORMALIZE_VERSION } from '../../src/llm/normalize.js';
import { setupTestDb, type TestDb, VALID_CONTRACT } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.truncateAll(); });

const NOW = new Date('2026-09-30T12:00:00Z');
const POST_TEXT = 'Mark my words: BTC closes above 150k before new year, screenshot this';

function stubDeps(proposal: Partial<Proposal>, productStatus = 'online') {
  let modelCalls = 0;
  const llm = {
    mode: 'replay',
    generateJson: async () => {
      modelCalls++;
      await new Promise((resolve) => setTimeout(resolve, 20)); // let concurrent submits overlap
      const data: Proposal = {
        is_prediction: true, x_rules_ok: true, contract: VALID_CONTRACT as Proposal['contract'], unclear: [],
        unclear_explanation: '', examples: [], self_confidence: 0.8, ...proposal,
      };
      return { data, costs: [{ provider: 'gemini' as const, operation: 'normalize' as const, units: 1, usdCost: 0.001 }] };
    },
    groundedSearch: async () => { throw new Error('not used'); },
  } as unknown as LlmClient;
  const coinbase = { productStatus: async () => productStatus } as unknown as Coinbase;
  const deps: ClaimDeps = { db: t.db, llm, coinbase, normalizerModel: 'test-model' };
  return { deps, calls: () => modelCalls };
}

const input = (post = '9001') => ({ text: POST_TEXT, authorId: '200', sourceTweetId: post, summonTweetId: `${post}-s`, sourceVersion: 'v1', now: NOW });

describe('submitClaim', () => {
  test('a clear prediction becomes a draft with its author position, costs and a RECORDED reply', async () => {
    const { deps } = stubDeps({});
    const result = await submitClaim(deps, input());
    assert.equal(result.outcome, 'recorded');
    assert.match(result.reply, /^RECORDED · #/);

    const [claim] = await t.sql`select * from claims where slug = ${result.slug}`;
    assert.equal(claim!.status, 'draft');
    assert.equal(new Date(claim!.lock_at).toISOString(), '2026-09-30T12:15:00.000Z');
    assert.equal(new Date(claim!.deadline_at).toISOString(), '2026-12-31T23:59:59.000Z');
    assert.equal(claim!.resolution_method, 'price_feed');
    assert.equal(claim!.contract_model_id, `test-model/${NORMALIZE_VERSION}`);

    const positions = await t.sql`select * from positions where claim_id = ${claim!.id}`;
    assert.deepEqual(positions.map((p) => [p.x_user_id, p.stance, p.is_author]), [['200', 'agree', true]]);
    const [cost] = await t.sql`select count(*)::int as n from cost_events where claim_id = ${claim!.id}`;
    assert.equal(cost!.n, 1);
  });

  test('two concurrent summons of the same post produce exactly one claim', async () => {
    const { deps } = stubDeps({});
    const results = await Promise.all([submitClaim(deps, input()), submitClaim(deps, input())]);
    assert.deepEqual(results.map((r) => r.outcome).sort(), ['duplicate', 'recorded']);
    assert.equal(results[0]!.slug, results[1]!.slug);
    const [row] = await t.sql`select count(*)::int as n from claims`;
    assert.equal(row!.n, 1);
    const [orphans] = await t.sql`select count(*)::int as n from cost_events where claim_id is null`;
    assert.equal(orphans!.n, 1, 'the losing call is still costed');
  });

  test('a later re-summon is a duplicate without a model call', async () => {
    const { deps, calls } = stubDeps({});
    await submitClaim(deps, input());
    const again = await submitClaim(deps, input());
    assert.equal(again.outcome, 'duplicate');
    assert.match(again.reply, /^ALREADY RECORDED/);
    assert.equal(calls(), 1);
  });

  test('rejected and needs-info outcomes are stored too, without a contract', async () => {
    const rejected = await submitClaim(stubDeps({ is_prediction: false }).deps, input('1'));
    const unclear = await submitClaim(stubDeps({ contract: null, unclear: ['deadline'], unclear_explanation: 'No date.' }).deps, input('2'));
    const rows = await t.sql`select slug, status, reject_reason, contract, unclear from claims order by source_tweet_id`;
    assert.deepEqual(rows.map((r) => [r.status, r.reject_reason, r.contract]), [['rejected', 'not_prediction', null], ['needs_info', null, null]]);
    assert.deepEqual(rows[1]!.unclear, ['deadline']);
    assert.equal(rejected.outcome, 'rejected');
    assert.match(unclear.reply, /No date\./);
  });

  test('a price claim for an asset Coinbase does not list is needs info, not recorded', async () => {
    const result = await submitClaim(stubDeps({}, 'not_found').deps, input());
    assert.equal(result.outcome, 'needs_info');
    assert.match(result.reply, /no active BTC-USD market/);
  });

  test('the post text is stored nowhere', async () => {
    await submitClaim(stubDeps({}).deps, input());
    const tables = ['claims', 'positions', 'cost_events'];
    for (const table of tables) {
      const rows = await t.sql.unsafe(`select row_to_json(x)::text as j from ${table} x`);
      for (const row of rows) assert.ok(!String(row.j).includes('Mark my words'), `post text found in ${table}`);
    }
  });
});
