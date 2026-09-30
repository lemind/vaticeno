// US4 scenarios 3–7 through the services (1–2, frozen contract and terminal states, are in db.test.ts).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { Proposal } from '../../src/contract/proposal.js';
import type { Coinbase } from '../../src/feeds/coinbase.js';
import { amendClaim, type ClaimDeps, submitClaim } from '../../src/lifecycle/claims.js';
import { lockDueDrafts } from '../../src/lifecycle/lock.js';
import { createMemorySourceReader } from '../../src/lifecycle/source-reader.js';
import { type LlmClient, LlmUnavailable } from '../../src/llm/client.js';
import { setupTestDb, type TestDb, VALID_CONTRACT } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.truncateAll(); });

const T0 = new Date('2026-09-30T12:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const POST = '5001';
const ORIGINAL = 'BTC closes above 150k by end of 2026';

// Model stub: text starting with "vague" is unclear; "150k"/"160k"/"170k" set the threshold.
function deps(): ClaimDeps {
  const llm = {
    mode: 'replay',
    generateJson: async ({ input }: { input: string }) => {
      const { text } = JSON.parse(input) as { text: string };
      if (text.startsWith('boom')) throw new LlmUnavailable('model down');
      const threshold = Number(/(\d+)k/.exec(text)?.[1] ?? 150) * 1000;
      const data: Proposal = text.startsWith('vague')
        ? { is_prediction: true, x_rules_ok: true, contract: null, unclear: ['deadline'], unclear_explanation: 'No date given.', examples: [], self_confidence: 0.4 }
        : {
          is_prediction: true, x_rules_ok: true, unclear: [], unclear_explanation: '', examples: [], self_confidence: 0.8,
          contract: { ...VALID_CONTRACT, criterion: `BTC-USD daily close above ${threshold}`, price: { ...VALID_CONTRACT.price, threshold } } as Proposal['contract'],
        };
      return { data, costs: [{ provider: 'gemini' as const, operation: 'normalize' as const, units: 1, usdCost: 0.001 }] };
    },
  } as unknown as LlmClient;
  return { db: t.db, llm, coinbase: { productStatus: async () => 'online' } as unknown as Coinbase, normalizerModel: 'm' };
}

async function recorded() {
  const d = deps();
  const reader = createMemorySourceReader({ [POST]: { versionId: 'v1', text: ORIGINAL } });
  const { slug } = await submitClaim(d, { text: ORIGINAL, authorId: '200', sourceTweetId: POST, summonTweetId: 's', sourceVersion: 'v1', now: T0 });
  return { d: { ...d, reader }, reader, slug: slug! };
}

const claimRow = async (slug: string) => (await t.sql`select * from claims where slug = ${slug}`)[0]!;
const fix = (d: Parameters<typeof amendClaim>[0], slug: string, text: string, now: Date) => amendClaim(d, { slug, authorId: '200', text, now });

describe('fixes before lock (scenario 3, 4)', () => {
  test('two fixes allowed, a third refused with one reply; failed fixes never use one up', async () => {
    const { d, slug } = await recorded();
    const first = await fix(d, slug, 'BTC above 160k by end of 2026', at(5));
    assert.equal(first.outcome, 'amended');
    assert.match(first.reply, /^\[AMENDED\] #/);
    assert.match(first.reply, /fixes left: 1/);
    assert.equal((await fix(d, slug, 'vague moon', at(6))).outcome, 'not_changed');
    assert.equal((await claimRow(slug)).amend_count, 1, 'the failed fix did not count');
    assert.equal((await fix(d, slug, 'BTC above 170k by end of 2026', at(7))).outcome, 'amended');
    const third = await fix(d, slug, 'BTC above 180k by end of 2026', at(8));
    assert.equal(third.outcome, 'refused');
    const row = await claimRow(slug);
    assert.deepEqual([row.amend_count, row.contract.price.threshold], [2, 170000]);
  });

  test('only the author can fix it', async () => {
    const { d, slug } = await recorded();
    assert.equal((await amendClaim(d, { slug, authorId: '999', text: 'BTC above 160k by end of 2026', now: at(5) })).outcome, 'refused');
  });

  test('locks 15 min after the last reply; a fix restarts the 15 min; a fix at exactly lock time is refused', async () => {
    const { d, slug } = await recorded();
    await fix(d, slug, 'BTC above 160k by end of 2026', at(10)); // lock moves to T0+25
    assert.deepEqual((await lockDueDrafts(d, at(15))).map((r) => r.outcome), [], 'not due at the old lock time');
    assert.equal((await fix(d, slug, 'BTC above 170k by end of 2026', at(25))).outcome, 'refused', 'exactly at lock_at');
    assert.deepEqual((await lockDueDrafts(d, at(25))).map((r) => r.outcome), ['locked']);
    assert.equal((await claimRow(slug)).status, 'locked');
  });
});

describe('edits of the post found at lock (scenario 5)', () => {
  test('a valid edit is applied like a fix: [AMENDED], counts, lock restarts; never locked against the edit', async () => {
    const { d, reader, slug } = await recorded();
    reader.edit(POST, { versionId: 'v2', text: 'BTC closes above 160k by end of 2026' });
    const [result] = await lockDueDrafts(d, at(15));
    assert.equal(result!.outcome, 'amended');
    assert.match(result!.reply!, /^\[AMENDED\] #/);
    let row = await claimRow(slug);
    assert.deepEqual([row.status, row.amend_count, row.source_version, row.contract.price.threshold], ['draft', 1, 'v2', 160000]);
    assert.equal(new Date(row.lock_at).toISOString(), at(30).toISOString());
    assert.deepEqual((await lockDueDrafts(d, at(30))).map((r) => r.outcome), ['locked']);
    row = await claimRow(slug);
    assert.equal(row.locked_source_version, 'v2');
  });

  test('an edit that fails the checks expires the claim with one reply', async () => {
    const { d, reader, slug } = await recorded();
    reader.edit(POST, { versionId: 'v2', text: 'vague: moon soon' });
    const [result] = await lockDueDrafts(d, at(15));
    assert.equal(result!.outcome, 'expired');
    assert.match(result!.reply!, /^\[EXPIRED\] #/);
    assert.equal((await claimRow(slug)).status, 'expired');
  });

  test('an edit with no fixes left expires the claim', async () => {
    const { d, reader, slug } = await recorded();
    await fix(d, slug, 'BTC above 160k by end of 2026', at(1));
    await fix(d, slug, 'BTC above 170k by end of 2026', at(2));
    reader.edit(POST, { versionId: 'v2', text: 'BTC closes above 180k by end of 2026' });
    assert.equal((await lockDueDrafts(d, at(20)))[0]!.outcome, 'expired');
    assert.equal((await claimRow(slug)).locked_source_version, null);
  });

  test('a draft that fails at lock (model down) waits; the drafts after it still lock', async () => {
    const d = deps();
    const reader = createMemorySourceReader({ '1': { versionId: 'v1', text: ORIGINAL }, '2': { versionId: 'v1', text: ORIGINAL } });
    const a = await submitClaim(d, { text: ORIGINAL, authorId: '200', sourceTweetId: '1', summonTweetId: 's1', sourceVersion: 'v1', now: T0 });
    const b = await submitClaim(d, { text: ORIGINAL, authorId: '200', sourceTweetId: '2', summonTweetId: 's2', sourceVersion: 'v1', now: at(1) });
    reader.edit('1', { versionId: 'v2', text: 'boom: edited' });
    const results = await lockDueDrafts({ ...d, reader }, at(20));
    assert.deepEqual(results.map((r) => [r.slug, r.outcome]), [[a.slug, 'waiting'], [b.slug, 'locked']]);
  });

  test('a post that cannot be read at lock time is not locked blind: it waits', async () => {
    const { d, slug } = await recorded();
    const blind = { ...d, reader: createMemorySourceReader() };
    assert.equal((await lockDueDrafts(blind, at(15)))[0]!.outcome, 'waiting');
    assert.equal((await claimRow(slug)).status, 'draft');
  });
});

describe('after lock (scenario 6, 7)', () => {
  test('locking records the post version and its text hash; later edits and fixes change nothing', async () => {
    const { d, reader, slug } = await recorded();
    await lockDueDrafts(d, at(15));
    let row = await claimRow(slug);
    assert.deepEqual([row.status, row.locked_source_version], ['locked', 'v1']);
    assert.equal(row.locked_source_hash, createHash('sha256').update(ORIGINAL).digest('hex'));
    assert.equal(new Date(row.next_check_at).toISOString(), '2026-12-31T23:59:59.000Z');

    reader.edit(POST, { versionId: 'v2', text: 'BTC closes above 200k by end of 2026' });
    assert.equal((await fix(d, slug, 'BTC above 200k by end of 2026', at(20))).outcome, 'refused');
    await lockDueDrafts(d, at(30));
    row = await claimRow(slug);
    assert.deepEqual([row.locked_source_version, row.contract.price.threshold], ['v1', 150000]);
  });

  test('a draft whose deadline passed before lock expires and is never judged', async () => {
    const { d, slug } = await recorded();
    await t.sql`update claims set deadline_at = ${at(10).toISOString()} where slug = ${slug}`;
    assert.equal((await lockDueDrafts(d, at(15)))[0]!.outcome, 'expired');
    assert.equal((await claimRow(slug)).status, 'expired');
  });
});
