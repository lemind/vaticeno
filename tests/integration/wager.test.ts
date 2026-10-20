// `@vaticeno wager` and the wager page (003 Story 5, T372): one link per claim, refusals in order, nothing
// outside a claim's thread, and a page that serves the authorization only while acceptance is open.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { type BotDeps, pollMentions } from '../../src/bot/mentions.js';
import type { Coinbase } from '../../src/feeds/coinbase.js';
import { createMemorySourceReader } from '../../src/lifecycle/source-reader.js';
import type { LlmClient } from '../../src/llm/client.js';
import { buildServer } from '../../src/web/server.js';
import type { Mention, XClient } from '../../src/x/client.js';
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

const NOW = new Date('2026-10-20T12:00:00Z'); // the claim's deadline is 2026-12-31: wagering is open
const BOT = '1';
const STRANGER = '300';
const HOST = 'vaticeno.test';

// No model is ever asked: `wager` is matched in code.
const llm = new Proxy(
  {},
  { get: () => () => Promise.reject(new Error('no model call expected')) },
) as unknown as LlmClient;

async function bot(
  mentionsByPoll: Mention[][],
  opts: { linksPerDay?: number; failPosts?: number } = {},
) {
  const replies: Array<{ to: string; text: string }> = [];
  let poll = 0;
  let failures = opts.failPosts ?? 0;
  const deps: BotDeps = {
    db: t.db,
    llm,
    coinbase: { productStatus: async () => 'online' } as unknown as Coinbase,
    normalizerModel: 'm',
    answerModel: 'm',
    x: {
      getMentionsPage: async () => ({
        data: [...(mentionsByPoll[poll++] ?? [])].reverse(),
        meta: { result_count: 0 },
      }),
    } as unknown as XClient,
    reader: createMemorySourceReader({}),
    botUserId: BOT,
    botHandle: 'vaticeno',
    fetchPage: async () => {
      throw new Error('no page read expected');
    },
    postReply: async (to, text) => {
      if (failures-- > 0) throw new Error('X timed out'); // a post whose fate is unknown: never retried
      replies.push({ to, text });
      return { id: `r-${to}` };
    },
    allowAuthor: () => true,
    caps: { perAuthorPerHour: 30, perDay: 300 },
    wager: { host: HOST, linksPerDay: opts.linksPerDay ?? 10 },
    statePath: join(await mkdtemp(join(tmpdir(), 'vaticeno-wager-')), 'ingest.json'),
  };
  return { deps, replies };
}

// A `wager` from someone who is not the author, replying to the bot's RECORDED reply (7000): once we are in a
// thread, a reply to us is what addresses us, not a handle X carries along (src/commands/parse.ts).
const wager = (id: string, parent = BOT_REPLY, author = STRANGER): Mention => ({
  id,
  text: '@vaticeno wager',
  author_id: author,
  conversation_id: '5000',
  in_reply_to_user_id: BOT,
  referenced_tweets: [{ type: 'replied_to', id: parent }],
});
const BOT_REPLY = '7000';
const THREAD = {
  source_tweet_id: '5000',
  summon_tweet_id: '5001',
  thread_tweet_ids: [BOT_REPLY],
};

async function lockedPriceClaim(overrides: Record<string, unknown> = {}) {
  return insertClaim(t.sql, 'locked', { ...THREAD, ...overrides });
}

describe('the wager command', () => {
  test('a burst on one claim posts one link, from anyone in the thread, and never again', async () => {
    const claim = await lockedPriceClaim();
    const { deps, replies } = await bot([
      [wager('10'), wager('11', BOT_REPLY, '301'), wager('12', BOT_REPLY, '302')],
    ]);
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 1, 'one link per claim');
    assert.equal(replies[0]!.to, '10');
    assert.match(replies[0]!.text, new RegExp(`^WAGER · #${claim.slug}\\n`));
    assert.ok(replies[0]!.text.includes(`${HOST}/claim/${claim.slug}/wager`));
    assert.match(replies[0]!.text, /Testnet only: the token has no value\./);
    const rows = await t.sql`select kind, mention_id from wager_replies`;
    assert.deepEqual(
      rows.map((r) => [r.kind, r.mention_id]),
      [['link', '10']],
    );
  });

  test('a crash between the record and the post never sends a second link', async () => {
    await lockedPriceClaim();
    const { deps, replies } = await bot([[wager('10')], [wager('11')]], {
      failPosts: 1,
    });
    await pollMentions(deps, NOW); // the post dies: the link is spent, the mention is answered
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 0, 'at most once: lost, never doubled');
  });

  test('a price claim before lock is told when it opens, and the link is still there after it', async () => {
    const claim = await insertClaim(t.sql, 'draft', {
      ...THREAD,
      lock_at: '2026-10-20T12:10:00Z',
    });
    const { deps, replies } = await bot([
      [wager('10')],
      [wager('11')],
      [wager('12')],
    ]);
    await pollMentions(deps, NOW);
    assert.match(replies[0]!.text, /opens when it locks, in about 10 min/);
    assert.ok(
      !/https?:|\/claim\//.test(replies[0]!.text),
      'a refusal carries no link',
    );
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 1, 'the refusal is said once per claim');
    await t.sql`update claims set status = 'locked' where id = ${claim.id}`;
    await pollMentions(deps, NOW);
    assert.match(
      replies[1]!.text,
      /^WAGER · /,
      'the link was not used up by the refusal',
    );
  });

  test('a model-judged claim is "not a price claim" even before it locks, once', async () => {
    const { price: _price, ...modelContract } = VALID_CONTRACT;
    await insertClaim(t.sql, 'draft', {
      ...THREAD,
      resolution_method: 'model',
      contract: JSON.stringify({ ...modelContract, resolution_method: 'model' }),
    });
    const { deps, replies } = await bot([[wager('10'), wager('11')]]);
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 1);
    assert.match(replies[0]!.text, /only claims decided by a price feed/);
  });

  test('a claim whose wagering has closed refuses once, without a link', async () => {
    await lockedPriceClaim({ deadline_at: '2026-10-21T06:00:00Z' }); // under 24 hours away
    const { deps, replies } = await bot([[wager('10'), wager('11')]]);
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 1);
    assert.match(
      replies[0]!.text,
      /is closed: it shuts 24 hours before the deadline/,
    );
  });

  test("a wager whose parent is not the claim's gets nothing: no reply, no claim", async () => {
    await lockedPriceClaim();
    const { deps, replies } = await bot([[wager('10', '9999')]]);
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 0);
    assert.equal(
      (await t.sql`select count(*)::int as n from wager_replies`)[0]!.n,
      0,
    );
    assert.equal(
      (await t.sql`select count(*)::int as n from claims`)[0]!.n,
      1,
      'never recorded as a claim',
    );
  });

  test('past the daily cap the link waits, unspent, and alerts', async () => {
    const claim = await lockedPriceClaim();
    const { deps, replies } = await bot([[wager('10')]], { linksPerDay: 0 });
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 0);
    assert.equal(
      (
        await t.sql`select count(*)::int as n from wager_replies where claim_id = ${claim.id}`
      )[0]!.n,
      0,
    );
  });
});

describe('the wager page', () => {
  const config = {
    escrow: '0x6281F12b4d4AB4bC3d53719A209381F81aFC0A72',
    token: '0x5C2cfb7a6a87cbD0D927EDe2ea01BFc8C816c2d7',
    chainId: 84532,
    chainName: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
  };
  const app = (now = NOW) =>
    buildServer({ db: t.db, now: () => now, wager: config });
  const pageData = (body: string) =>
    JSON.parse(
      /<script type="application\/json" id="wager-data">(.*?)<\/script>/s.exec(
        body,
      )![1]!,
    ) as Record<string, unknown>;

  async function withAuthorization() {
    const claim = await lockedPriceClaim();
    await t.sql`insert into settlement_outbox (claim_id, claim_hash, open_authorization, authorized_until)
      values (${claim.id}, ${'0x' + 'ab'.repeat(32)}, ${'0x' + '11'.repeat(65)}, '2026-12-30T23:59:59Z')`;
    return claim;
  }

  test('it serves the terms, the script and the authorization while acceptance is open, uncached', async () => {
    const claim = await withAuthorization();
    const res = await app().inject(`/claim/${claim.slug}/wager`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.body, /Testnet only\./);
    assert.match(res.body, /Anyone can make an offer on any claim/);
    assert.match(res.body, /<script type="module" src="\/assets\/wallet.js">/);
    const data = pageData(res.body);
    assert.equal(data.authorization, '0x' + '11'.repeat(65));
    assert.equal(data.validUntil, Date.parse('2026-12-30T23:59:59Z') / 1000);
    assert.equal(data.deadline, Date.parse(VALID_CONTRACT.deadline_at) / 1000);
    const script = await app().inject('/assets/wallet-abi.js');
    assert.match(script.headers['content-type'] as string, /text\/javascript/);
  });

  test('after acceptance closes the authorization is no longer served', async () => {
    const claim = await withAuthorization();
    const res = await app(new Date('2026-12-31T00:00:00Z')).inject(
      `/claim/${claim.slug}/wager`,
    );
    assert.equal(pageData(res.body).authorization, null);
    assert.match(res.body, /Wagering is closed for new offers/);
  });

  test('a locked claim the worker has not signed yet says wagering opens shortly', async () => {
    const claim = await lockedPriceClaim();
    const res = await app().inject(`/claim/${claim.slug}/wager`);
    assert.match(res.body, /Wagering opens shortly/);
  });

  test('a model-judged claim has no wager controls', async () => {
    const { price: _price, ...modelContract } = VALID_CONTRACT;
    const claim = await insertClaim(t.sql, 'locked', {
      resolution_method: 'model',
      contract: JSON.stringify({ ...modelContract, resolution_method: 'model' }),
    });
    const res = await app().inject(`/claim/${claim.slug}/wager`);
    assert.match(res.body, /can't carry a wager/);
    assert.doesNotMatch(res.body, /wallet\.js/);
  });

  test('a contract field cannot break out of the page or its data', async () => {
    const claim = await insertClaim(t.sql, 'locked', {
      contract: JSON.stringify({
        ...VALID_CONTRACT,
        criterion: '</script><img src=x onerror=alert(1)>',
      }),
    });
    const res = await app().inject(`/claim/${claim.slug}/wager`);
    assert.doesNotMatch(res.body, /<img src=x/);
  });

  test('old /c/ links move for good to /claim/', async () => {
    const claim = await lockedPriceClaim();
    const res = await app().inject(`/c/${claim.slug}`);
    assert.equal(res.statusCode, 308);
    assert.equal(res.headers.location, `/claim/${claim.slug}`);
    assert.equal((await app().inject(`/claim/${claim.slug}`)).statusCode, 200);
  });
});
