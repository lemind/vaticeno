// A mention burst at ten times the live rate: exactly one reply per mention, none lost, and the backlog
// drains without help (003 SC-004, FR-010). The lease and reservation rules are what this tests.
//
// It lives here, not in `load/`, because the job path and its stubs are TypeScript; the locust harness in
// `load/` drives the public pages, which are HTTP and have no such dependency.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { type BotDeps, pollMentions } from '../../src/bot/mentions.js';
import type { Coinbase } from '../../src/feeds/coinbase.js';
import type { LlmClient } from '../../src/llm/client.js';
import { createMemorySourceReader } from '../../src/lifecycle/source-reader.js';
import type { Mention, XClient } from '../../src/x/client.js';
import { setupTestDb, type TestDb, VALID_CONTRACT } from '../integration/helpers.js';

// Ten times the live rate: §9 budgets ~500 replies a month, about 17 a day, so 170 in a single poll.
const BURST = 170;
const NOW = new Date('2026-10-01T12:00:00Z');

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

// The narrowest stub that reaches the recording path: every mention is one plain, complete prediction.
// This measures the lifecycle under load, not the engine's judgement, which bot.test.ts covers.
const llm = {
  generateJson: async ({ instructionVersion }: { instructionVersion: string }) => {
    if (instructionVersion.startsWith('intent.'))
      return { data: { intent: 'prediction' }, costs: [] };
    if (instructionVersion.startsWith('match.'))
      return { data: { found: false }, costs: [] };
    return {
      data: {
        is_prediction: true,
        x_rules_ok: true,
        contract: VALID_CONTRACT,
        unclear: [],
        unclear_explanation: '',
        examples: [],
        self_confidence: 0.9,
      },
      costs: [],
    };
  },
} as unknown as LlmClient;

async function burstBot(mentionsByPoll: Mention[][]) {
  const replies: Array<{ to: string; text: string }> = [];
  let poll = 0;
  const x = {
    getMentionsPage: async () => ({
      data: [...(mentionsByPoll[poll++] ?? [])].reverse(),
      meta: { result_count: 0 },
    }),
    getTweet: async (id: string) => Promise.reject(new Error(`404 ${id}`)),
    getConversation: async () => [],
  } as unknown as XClient;
  const deps: BotDeps = {
    db: t.db,
    llm,
    coinbase: { productStatus: async () => 'online' } as unknown as Coinbase,
    normalizerModel: 'm',
    answerModel: 'm',
    x,
    reader: createMemorySourceReader({}),
    botUserId: 'bot',
    botHandle: 'vaticeno',
    fetchPage: async (url: string) => ({
      url,
      text: '',
      sha256: 'x',
      simhash: null,
      retrievedAt: NOW,
    }),
    postReply: async (to, text) => {
      replies.push({ to, text });
      return { id: `r-${to}` };
    },
    allowAuthor: () => true,
    // The live caps, unchanged: a burst must not be answered by raising them.
    caps: { perAuthorPerHour: 3, perDay: 300 },
    statePath: join(await mkdtemp(join(tmpdir(), 'vaticeno-burst-')), 'ingest.json'),
  };
  return { deps, replies };
}

// One mention per author, so the burst measures the pipeline rather than the per-author cap.
const crowd = (count: number, offset = 0): Mention[] =>
  Array.from({ length: count }, (_, i) => ({
    id: String(100_000 + offset + i),
    text: `@vaticeno BTC daily close above $150,000 by 2026-12-31 #${offset + i}`,
    author_id: String(900_000 + offset + i),
    conversation_id: String(100_000 + offset + i),
  }));

test(`${BURST} mentions in one poll are answered exactly once each`, async () => {
  const mentions = crowd(BURST);
  const { deps, replies } = await burstBot([mentions]);

  const started = Date.now();
  const result = await pollMentions(deps, NOW);
  const elapsed = Date.now() - started;

  assert.equal(
    result.mentions,
    BURST,
    'every mention was taken up; none was dropped',
  );
  assert.equal(replies.length, BURST, 'one reply each');
  const targets = new Set(replies.map((reply) => reply.to));
  assert.equal(targets.size, BURST, 'no mention answered twice');
  assert.deepEqual(
    [...targets].sort(),
    mentions.map((m) => m.id).sort(),
    'answered the mentions we were sent',
  );
  // Not a threshold to pass, just the figure the capacity table quotes.
  console.log(
    `burst: ${BURST} mentions in ${elapsed} ms (${(BURST / (elapsed / 1000)).toFixed(1)}/s)`,
  );
});

test('the same burst seen again adds no reply, and the next one still drains', async () => {
  const first = crowd(BURST);
  const second = crowd(20, BURST);
  // Poll 1: the burst. Poll 2: the same mentions again, as X would re-serve them. Poll 3: new arrivals.
  const { deps, replies } = await burstBot([first, first, second]);

  await pollMentions(deps, NOW);
  const afterFirst = replies.length;
  const repeat = await pollMentions(deps, NOW);
  assert.equal(
    replies.length,
    afterFirst,
    'a re-served mention is never answered twice (INIT_SPEC §6.7)',
  );
  assert.equal(repeat.replies, 0);

  const next = await pollMentions(deps, NOW);
  assert.equal(next.replies, 20, 'the backlog drains without intervention');
  assert.equal(replies.length, afterFirst + 20);
});

test('one author flooding is capped, and the cap is not a lost mention', async () => {
  // 20 mentions from one author against a cap of 3 an hour: the rest are withheld, not dropped, and
  // nothing is answered twice (INIT_SPEC §6.1).
  const flood = Array.from({ length: 20 }, (_, i) => ({
    id: String(500_000 + i),
    text: `@vaticeno BTC daily close above $150,000 by 2026-12-31 #${i}`,
    author_id: '777',
    conversation_id: String(500_000 + i),
  }));
  const { deps, replies } = await burstBot([flood]);
  const result = await pollMentions(deps, NOW);

  assert.equal(result.mentions, 20, 'all twenty were read');
  assert.ok(replies.length <= 3, `the cap held: ${replies.length} replies`);
  assert.equal(
    new Set(replies.map((r) => r.to)).size,
    replies.length,
    'no duplicate reply',
  );
});
