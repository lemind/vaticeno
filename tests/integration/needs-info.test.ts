import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { Proposal } from '../../src/contract/proposal.js';
import type { Coinbase } from '../../src/feeds/coinbase.js';
import { amendClaim, type ClaimDeps, submitClaim } from '../../src/lifecycle/claims.js';
import { expireNeedsInfo } from '../../src/lifecycle/expire.js';
import { createMemorySourceReader } from '../../src/lifecycle/source-reader.js';
import type { LlmClient } from '../../src/llm/client.js';
import { fallbackExample } from '../../src/replies/templates.js';
import { setupTestDb, type TestDb, VALID_CONTRACT } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.truncateAll(); });

const NOW = new Date('2026-09-30T12:00:00Z');
const clear: Partial<Proposal> = {};
const unclear: Partial<Proposal> = { contract: null, unclear: ['deadline'], unclear_explanation: 'No date given.', examples: ['BTC daily close above $150,000 by 2026-12-31', 'too vague'] };

// Model stub: answers by matching the input text; anything unmatched is "clear".
function deps(answers: Record<string, Partial<Proposal>>, productStatus = 'online'): ClaimDeps {
  const llm = {
    mode: 'replay',
    generateJson: async ({ input }: { input: string }) => {
      const { text } = JSON.parse(input) as { text: string };
      const match = Object.entries(answers).find(([key]) => text.startsWith(key))?.[1] ?? clear;
      const data: Proposal = {
        is_prediction: true, x_rules_ok: true, contract: VALID_CONTRACT as Proposal['contract'], unclear: [],
        unclear_explanation: '', examples: [], self_confidence: 0.7, ...match,
      };
      return { data, costs: [{ provider: 'gemini' as const, operation: 'normalize' as const, units: 1, usdCost: 0.001 }] };
    },
  } as unknown as LlmClient;
  return { db: t.db, llm, coinbase: { productStatus: async () => productStatus } as unknown as Coinbase, normalizerModel: 'm' };
}

const submit = async (d: ClaimDeps, text: string) => {
  const result = await submitClaim(d, { text, authorId: '200', sourceTweetId: '77', summonTweetId: '78', sourceVersion: 'v1', now: NOW });
  return { ...result, slug: result.slug! };
};

describe('NEEDS INFO reply', () => {
  test('uses the first example that itself records, never an unchecked one', async () => {
    const d = deps({ 'moon soon': unclear, 'too vague': { contract: null, unclear: ['threshold'] } });
    const result = await submit(d, 'moon soon');
    assert.equal(result.outcome, 'needs_info');
    assert.match(result.reply, /No date given\./);
    assert.match(result.reply, /e\.g\.\nBTC daily close above \$150,000 by 2026-12-31/);
    assert.match(result.reply, /Reply with the prediction and a date, e\.g\./);
    assert.doesNotMatch(result.reply, /amend/);
  });

  test('falls back to the fixed example when no generated example records', async () => {
    const bad = { contract: null, unclear: ['threshold' as const], examples: ['nope 1', 'nope 2'] };
    const d = deps({ 'moon soon': { ...unclear, examples: ['nope 1'] }, nope: bad });
    const result = await submit(d, 'moon soon');
    assert.match(result.reply, new RegExp(`e\\.g\\.\\n${fallbackExample(NOW).replace('$', '\\$')}`));
    assert.match(fallbackExample(NOW), /by 2027-12-31$/);
  });

  test('a price example is not offered when the feed has no such market', async () => {
    const d = deps({ 'moon soon': unclear }, 'delisted');
    const result = await submit(d, 'moon soon');
    assert.equal(result.outcome, 'needs_info');
    assert.doesNotMatch(result.reply, /by 2026-12-31/);
  });
});

describe('amend from needs info', () => {
  test('a valid amend by the author makes a draft, restarts the lock, keeps the amend count', async () => {
    const d = deps({ 'moon soon': unclear });
    const { slug } = await submit(d, 'moon soon');
    const reader = createMemorySourceReader({ '77': { versionId: 'v2', text: 'moon soon (edited)' } });
    const later = new Date('2026-09-30T13:00:00Z');

    assert.equal((await amendClaim({ ...d, reader }, { slug, authorId: '999', text: 'x', now: later })).outcome, 'ignored');

    const result = await amendClaim({ ...d, reader }, { slug, authorId: '200', text: 'BTC daily close above $150,000 by 2026-12-31', now: later });
    assert.equal(result.outcome, 'recorded');
    assert.match(result.reply, /^RECORDED · #/);
    const [claim] = await t.sql`select * from claims where slug = ${slug}`;
    assert.equal(claim!.status, 'draft');
    assert.equal(claim!.amend_count, 0);
    assert.equal(claim!.source_version, 'v2');
    assert.equal(new Date(claim!.lock_at).toISOString(), '2026-09-30T13:15:00.000Z');
    assert.equal(claim!.unclear, null);
  });

  test('a still-unclear amend keeps needs info with one short reply', async () => {
    const d = deps({ 'moon soon': unclear, 'still vague': { contract: null, unclear: ['threshold'], unclear_explanation: 'Which price?' } });
    const { slug } = await submit(d, 'moon soon');
    const result = await amendClaim({ ...d, reader: createMemorySourceReader() }, { slug, authorId: '200', text: 'still vague', now: NOW });
    assert.equal(result.outcome, 'still_needs_info');
    assert.match(result.reply, /^STILL NOT RECORDED — Which price\?/);
    const [claim] = await t.sql`select status, unclear from claims where slug = ${slug}`;
    assert.deepEqual([claim!.status, claim!.unclear], ['needs_info', ['threshold', 'deadline']]); // no contract → deadline too
  });
});

describe('help', () => {
  test('"@vaticeno help" lists the actions without a model call or a claim', async () => {
    const d = deps({});
    (d.llm as { generateJson: unknown }).generateJson = async () => { throw new Error('no model call expected'); };
    const result = await submitClaim(d, { text: '@vaticeno help', authorId: '200', sourceTweetId: '90', summonTweetId: '91', sourceVersion: 'v1', now: NOW });
    assert.deepEqual([result.outcome, result.slug], ['help', null]);
    assert.match(result.reply, /Tag me under your prediction/);
    assert.equal((await t.sql`select count(*)::int as n from claims`)[0]!.n, 0);
  });
});

describe('amend window', () => {
  test('an amend 24 h after the needs-info reply is refused, even before the expiry job runs', async () => {
    const d = deps({ 'moon soon': unclear });
    const { slug } = await submit(d, 'moon soon');
    const reader = createMemorySourceReader();
    const late = await amendClaim({ ...d, reader }, { slug, authorId: '200', text: 'BTC daily close above $150,000 by 2026-12-31', now: new Date('2026-10-01T12:00:00Z') });
    assert.equal(late.outcome, 'refused');
    const [claim] = await t.sql`select status from claims where slug = ${slug}`;
    assert.equal(claim!.status, 'needs_info');
  });
});

describe('needs-info expiry', () => {
  test('expires after exactly 24 h, silently; not a minute earlier', async () => {
    const { slug } = await submit(deps({ 'moon soon': unclear }), 'moon soon');
    assert.equal(await expireNeedsInfo(t.db, new Date('2026-10-01T11:59:00Z')), 0);
    assert.equal(await expireNeedsInfo(t.db, new Date('2026-10-01T12:00:00Z')), 1);
    const [claim] = await t.sql`select status from claims where slug = ${slug}`;
    assert.equal(claim!.status, 'expired');
  });
});
