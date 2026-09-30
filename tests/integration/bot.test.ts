// X intake (Stage 1) with a fake X and a stub model: each mention → the engine → at most one reply.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { type BotDeps, pollMentions } from '../../src/bot/mentions.js';
import { readIngestState } from '../../src/ingest/state.js';
import type { Proposal } from '../../src/contract/proposal.js';
import type { Coinbase } from '../../src/feeds/coinbase.js';
import { createMemorySourceReader } from '../../src/lifecycle/source-reader.js';
import { type LlmClient, LlmUnavailable } from '../../src/llm/client.js';
import type { Mention, XClient } from '../../src/x/client.js';
import { setupTestDb, type TestDb, VALID_CONTRACT } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.truncateAll(); });

const NOW = new Date('2026-09-30T12:00:00Z');
const BOT = '1';
const ME = '200';

// Stub model: "vague…" is unclear, "down…" means the model is unavailable, anything else is the BTC contract.
const llm = {
  mode: 'replay',
  generateJson: async ({ input }: { input: string }) => {
    const { text } = JSON.parse(input) as { text: string };
    if (text.startsWith('down')) throw new LlmUnavailable('model down');
    const data: Proposal = text.startsWith('vague')
      ? { is_prediction: true, x_rules_ok: true, contract: null, unclear: ['deadline'], unclear_explanation: 'No date given.', examples: [], self_confidence: 0.3 }
      : { is_prediction: true, x_rules_ok: true, contract: VALID_CONTRACT as Proposal['contract'], unclear: [], unclear_explanation: '', examples: [], self_confidence: 0.8 };
    return { data, costs: [] };
  },
} as unknown as LlmClient;

async function bot(mentionsByPoll: Mention[][], posts: Record<string, { versionId: string; text: string }> = {}) {
  const replies: Array<{ to: string; text: string }> = [];
  let poll = 0;
  const x = {
    getMentionsPage: async () => ({ data: [...(mentionsByPoll[poll++] ?? [])].reverse(), meta: { result_count: 0 } }),
  } as unknown as XClient;
  const deps: BotDeps = {
    db: t.db, llm, coinbase: { productStatus: async () => 'online' } as unknown as Coinbase, normalizerModel: 'm',
    x, reader: createMemorySourceReader(posts), botUserId: BOT,
    postReply: async (to, text) => { replies.push({ to, text }); return { id: `r-${to}` }; },
    allowAuthor: (id) => id !== '666', caps: { perAuthorPerHour: 3, perDay: 300 },
    statePath: join(await mkdtemp(join(tmpdir(), 'vaticeno-bot-')), 'ingest.json'),
  };
  return { deps, replies };
}

const mention = (id: string, text: string, extra: Partial<Mention> = {}): Mention => ({ id, text, author_id: ME, conversation_id: id, ...extra });

describe('recording from X', () => {
  test('a prediction in the mention itself is recorded and answered once, even if seen again', async () => {
    const m = mention('10', '@vaticeno BTC daily close above $150,000 by 2026-12-31');
    const { deps, replies } = await bot([[m], [m]]);
    assert.deepEqual(await pollMentions(deps, NOW), { mentions: 1, replies: 1 });
    assert.match(replies[0]!.text, /^RECORDED · #/);
    assert.equal(replies[0]!.to, '10');
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 1, 'no second reply to the same mention');
    const [claim] = await t.sql`select source_tweet_id, summon_tweet_id, status from claims`;
    assert.deepEqual([claim!.source_tweet_id, claim!.summon_tweet_id, claim!.status], ['10', '10', 'draft']);
  });

  test('an empty mention under your own post records that post', async () => {
    const m = mention('21', '@vaticeno', { conversation_id: '20', in_reply_to_user_id: ME, referenced_tweets: [{ type: 'replied_to', id: '20' }] });
    const { deps, replies } = await bot([[m]], { '20': { versionId: '20', text: 'BTC closes above 150k by end of 2026' } });
    await pollMentions(deps, NOW);
    assert.match(replies[0]!.text, /^RECORDED/);
    const [claim] = await t.sql`select source_tweet_id, summon_tweet_id, source_version from claims`;
    assert.deepEqual([claim!.source_tweet_id, claim!.summon_tweet_id, claim!.source_version], ['20', '21', '20']);
  });

  test('a mention under someone else’s post is refused, nothing recorded', async () => {
    const m = mention('31', '@vaticeno', { in_reply_to_user_id: '999', referenced_tweets: [{ type: 'replied_to', id: '30' }] });
    const { deps, replies } = await bot([[m]]);
    await pollMentions(deps, NOW);
    assert.match(replies[0]!.text, /only record your own predictions/);
    assert.equal((await t.sql`select count(*)::int as n from claims`)[0]!.n, 0);
  });

  test('ping gets pong; help and anything unclear get the help reply', async () => {
    const { deps, replies } = await bot([[mention('40', '@vaticeno ping'), mention('41', '@vaticeno help')]]);
    await pollMentions(deps, NOW);
    assert.match(replies[0]!.text, /^pong · /);
    assert.match(replies[1]!.text, /Tag me under your prediction/);
  });
});

describe('fixes from X', () => {
  test('a reply in the thread of your unclear claim fixes it — no keyword', async () => {
    const summon = mention('50', '@vaticeno vague BTC to the moon');
    const fix = mention('52', '@vaticeno BTC daily close above $150,000 by 2026-12-31', {
      conversation_id: '50', in_reply_to_user_id: BOT, referenced_tweets: [{ type: 'replied_to', id: 'r-50' }],
    });
    const { deps, replies } = await bot([[summon], [fix]], { '50': { versionId: '50', text: 'vague BTC to the moon' } });
    await pollMentions(deps, NOW);
    assert.match(replies[0]!.text, /^NOT RECORDED/);
    await pollMentions(deps, new Date(NOW.getTime() + 60_000));
    assert.match(replies[1]!.text, /^RECORDED/);
    assert.equal((await t.sql`select status from claims`)[0]!.status, 'draft');
  });

  test('a thread inside an older thread: replies under each bot answer fix the claim', async () => {
    const summon = mention('55', '@vaticeno vague AAPL to the moon', { conversation_id: 'old-root', referenced_tweets: [{ type: 'replied_to', id: 'old-root' }] });
    const under = (id: string, parent: string, text: string) => mention(id, text, { conversation_id: 'old-root', in_reply_to_user_id: BOT, referenced_tweets: [{ type: 'replied_to', id: parent }] });
    const { deps, replies } = await bot([[summon], [under('56', 'r-55', '@vaticeno BTC daily close above $150,000 by 2026-12-31')], [under('57', 'r-56', '@vaticeno BTC daily close above $160,000 by 2026-12-31')]], { '55': { versionId: '55', text: 'vague AAPL to the moon' } });
    await pollMentions(deps, NOW);
    await pollMentions(deps, new Date(NOW.getTime() + 60_000));
    await pollMentions(deps, new Date(NOW.getTime() + 120_000));
    assert.match(replies[1]!.text, /^RECORDED/);
    assert.match(replies[2]!.text, /^\[AMENDED\]/);
    const rows = await t.sql`select slug, amend_count, thread_tweet_ids from claims`;
    assert.equal(rows.length, 1, 'no second claim from the fixes');
    assert.equal(rows[0]!.amend_count, 1);
    assert.deepEqual([...rows[0]!.thread_tweet_ids].sort(), ['55', '56', '57', 'r-55', 'r-56', 'r-57']);
  });
});

describe('failures and limits', () => {
  test('a model outage leaves the mention for the next poll instead of losing it', async () => {
    const down = mention('60', '@vaticeno down: BTC above 150k by 2026-12-31');
    const { deps, replies } = await bot([[down], []]);
    assert.deepEqual(await pollMentions(deps, NOW), { mentions: 1, replies: 0 });
    assert.equal(replies.length, 0);
    assert.equal((await readIngestState(deps.statePath)).mentions_since_id, undefined, 'the cursor did not move past it');
  });

  test('authors outside the allowlist are skipped entirely', async () => {
    const { deps, replies } = await bot([[mention('70', '@vaticeno BTC above 150k by 2026-12-31', { author_id: '666' })]]);
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 0);
    assert.equal((await t.sql`select count(*)::int as n from claims`)[0]!.n, 0);
  });

  test('the per-author hourly cap stops replies', async () => {
    const ms = ['80', '81', '82', '83'].map((id) => mention(id, '@vaticeno ping'));
    const { deps, replies } = await bot([ms]);
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 3);
  });
});
