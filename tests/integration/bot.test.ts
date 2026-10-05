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

let jokeText = 'I predicted this joke. Check the receipt.';
// Posts the stub X returns for thread reads: id → post.
const threadPosts: Record<string, { id: string; text: string; author_id: string; referenced_tweets?: Array<{ type: string; id: string }> }> = {
  'q-bot': { id: 'q-bot', text: '“Luck is…” — Seneca', author_id: '1' },
};

// A football claim; the stub's match search finds "Liverpool" fixtures only.
const { price: _price, ...MODEL_BASE } = VALID_CONTRACT;
const MATCH_CONTRACT = {
  ...MODEL_BASE, subject: 'Liverpool', criterion: 'Liverpool beat Real Madrid 3–1', deadline_at: '2026-10-01T23:59:59Z',
  source: { ...VALID_CONTRACT.source, name: 'UEFA results', kind: 'football_results', locator: 'https://www.uefa.com/', scope: 'UCL', entity_id: 'Liverpool' },
  negative_condition: 'Liverpool do not win 3–1', resolution_method: 'model',
};

// Stub model: "vague…" is unclear, "down…" means the model is unavailable, "match…" is a football claim,
// anything else is the BTC contract.
const llm = {
  mode: 'replay',
  generateJson: async ({ input, instructionVersion }: { input: string; instructionVersion: string }) => {
    if (instructionVersion === 'joke.v1') return { data: { joke: jokeText }, costs: [] };
    if (instructionVersion === 'intent.v1') {
      const { text, thread } = JSON.parse(input) as { text: string; thread: Array<{ from: string; text: string }> };
      if (text === 'so?' && thread[0]?.from === 'bot') return { data: { intent: 'quote', answer: null }, costs: [] };
      if (text.endsWith('?')) return { data: { intent: 'question', answer: 'I record predictions and check them at the deadline.' }, costs: [] };
      return { data: { intent: 'other', answer: null }, costs: [] };
    }
    if (instructionVersion.startsWith('fixture')) {
      const { subject } = JSON.parse(input) as { subject: string };
      const found = subject === 'Liverpool';
      return { data: { found, home: found ? 'Liverpool' : null, away: found ? 'Real Madrid' : null, competition: found ? 'UEFA Champions League' : null,
        kickoff_utc: found ? '2026-10-01T19:00:00Z' : null, criterion: found ? 'Liverpool beat Real Madrid 3–1 (UEFA Champions League)' : null }, costs: [] };
    }
    const { text } = JSON.parse(input) as { text: string };
    if (text.startsWith('match')) {
      const subject = text.includes('Invented') ? 'Invented FC' : 'Liverpool';
      return { data: { is_prediction: true, x_rules_ok: true, contract: { ...MATCH_CONTRACT, subject }, unclear: [], unclear_explanation: '', examples: [], self_confidence: 0.8 }, costs: [] };
    }
    if (text.startsWith('down')) throw new LlmUnavailable('model down');
    if (text.endsWith('?')) return { data: { is_prediction: false, x_rules_ok: true, contract: null, unclear: [], unclear_explanation: '', examples: [], self_confidence: 0.9 }, costs: [] };
    const data: Proposal = text.startsWith('vague')
      ? { is_prediction: true, x_rules_ok: true, contract: null, unclear: ['deadline'], unclear_explanation: 'No date given.', examples: [], self_confidence: 0.3 }
      : { is_prediction: true, x_rules_ok: true, contract: VALID_CONTRACT as Proposal['contract'], unclear: [], unclear_explanation: '', examples: [], self_confidence: 0.8 };
    return { data, costs: [] };
  },
} as unknown as LlmClient;

async function bot(mentionsByPoll: Mention[][], posts: Record<string, { versionId: string; text: string }> = {}, pageText = '') {
  const replies: Array<{ to: string; text: string }> = [];
  let poll = 0;
  const x = {
    getMentionsPage: async () => ({ data: [...(mentionsByPoll[poll++] ?? [])].reverse(), meta: { result_count: 0 } }),
    getTweet: async (id: string) => threadPosts[id] ?? Promise.reject(new Error('404')),
  } as unknown as XClient;
  const deps: BotDeps = {
    db: t.db, llm, coinbase: { productStatus: async () => 'online' } as unknown as Coinbase, normalizerModel: 'm',
    x, reader: createMemorySourceReader(posts), botUserId: BOT,
    fetchPage: async (url: string) => ({ url, text: pageText, sha256: 'x', simhash: null, retrievedAt: NOW }),
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

describe('sports matches', () => {
  test('a real match is recorded with its competition filled in', async () => {
    const { deps, replies } = await bot([[mention('110', '@vaticeno match Liverpool vs Madrid tomorrow 3:1')]]);
    await pollMentions(deps, NOW);
    assert.match(replies[0]!.text, /^RECORDED[\s\S]*Liverpool beat Real Madrid 3–1 \(UEFA Champions League\)/);
  });

  test('a match search cannot find is not recorded', async () => {
    const { deps, replies } = await bot([[mention('111', '@vaticeno match Invented FC vs Nobody tomorrow 3:1')]]);
    await pollMentions(deps, NOW);
    assert.match(replies[0]!.text, /^NOT RECORDED — I can't find that match/);
    const [claim] = await t.sql`select status, reject_reason from claims`;
    assert.deepEqual([claim!.status, claim!.reject_reason], ['rejected', 'event_not_found']);
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

  test('someone else replying under the bot answer is ignored: no claim, no reply, no model call', async () => {
    const summon = mention('58', '@vaticeno BTC daily close above $150,000 by 2026-12-31');
    const stranger = mention('59', '@vaticeno lol no way', { author_id: '300', conversation_id: '58', in_reply_to_user_id: BOT, referenced_tweets: [{ type: 'replied_to', id: 'r-58' }] });
    const { deps, replies } = await bot([[summon], [stranger]]);
    await pollMentions(deps, NOW);
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 1);
    assert.equal((await t.sql`select count(*)::int as n from claims`)[0]!.n, 1);
  });

  test('a new prediction elsewhere in the thread of an open claim is a new claim, not a fix', async () => {
    const summon = mention('60a', '@vaticeno vague BTC to the moon');
    const other = mention('61a', '@vaticeno BTC daily close above $150,000 by 2026-12-31', { conversation_id: '60a', referenced_tweets: [{ type: 'replied_to', id: 'someone-else-in-thread' }] });
    const { deps } = await bot([[summon], [other]]);
    await pollMentions(deps, NOW);
    await pollMentions(deps, NOW);
    assert.equal((await t.sql`select count(*)::int as n from claims`)[0]!.n, 2);
  });
});

describe('selfpromo and quote', () => {
  test('selfpromo is a motto plus a joke', async () => {
    const { deps, replies } = await bot([[mention('120', '@vaticeno selfpromote')]]);
    await pollMentions(deps, NOW);
    assert.match(replies[0]!.text, /Vaticeno[\s\S]*\n\nI predicted this joke/);
  });

  test('a quote is posted with its author; if the source is down it is retried later, not dropped', async () => {
    const found = await bot([[mention('121', '@vaticeno quote 1')]]);
    found.deps.quoteSource = async () => ({ text: 'Never put money down unless you are sure', by: 'Bugsy Siegel' });
    await pollMentions(found.deps, NOW);
    assert.equal(found.replies[0]!.text, '“Never put money down unless you are sure” — Bugsy Siegel');

    const down = await bot([[mention('122', '@vaticeno quote')], [], []]);
    let up = false;
    down.deps.quoteSource = async () => (up ? { text: 'Luck is what happens when preparation meets opportunity', by: 'Seneca' } : null);
    await pollMentions(down.deps, NOW);
    assert.equal(down.replies.length, 0, 'no fallback reply');
    up = true;
    await pollMentions(down.deps, new Date(NOW.getTime() + 30_000));
    assert.equal(down.replies.length, 0, 'not before the 1-minute retry');
    await pollMentions(down.deps, new Date(NOW.getTime() + 61_000));
    assert.equal(down.replies[0]!.to, '122');
    assert.match(down.replies[0]!.text, /Seneca$/);

    // STOP arrives in the same poll the retry is due: it still wins.
    const stopped = await bot([[mention('123', '@vaticeno quote')], [], [mention('124', '@vaticeno STOP')]]);
    let ready = false;
    stopped.deps.quoteSource = async () => (ready ? { text: 'Luck is what happens when preparation meets opportunity', by: 'Seneca' } : null);
    await pollMentions(stopped.deps, NOW);
    await pollMentions(stopped.deps, new Date(NOW.getTime() + 10_000));
    ready = true;
    await pollMentions(stopped.deps, new Date(NOW.getTime() + 61_000));
    assert.deepEqual(stopped.replies.map((r) => r.to), ['124'], 'STOP drops the waiting quote');
  });

  test('a joke that tags someone is dropped: the motto goes out alone', async () => {
    jokeText = 'Ask @someone, they called it';
    try {
      const { deps, replies } = await bot([[mention('124', '@vaticeno selfpromo')]]);
      await pollMentions(deps, NOW);
      assert.doesNotMatch(replies[0]!.text, /@/);
      assert.match(replies[0]!.text, /Vaticeno/);
    } finally {
      jokeText = 'I predicted this joke. Check the receipt.';
    }
  });
});

describe('unclear mentions: the model reads the thread', () => {
  test('"so?" under the bot\'s quote gets a new quote', async () => {
    const { deps, replies } = await bot([[mention('130', '@vaticeno so?', { in_reply_to_user_id: BOT, referenced_tweets: [{ type: 'replied_to', id: 'q-bot' }] })]]);
    deps.quoteSource = async () => ({ text: 'Never put money down unless you are sure', by: 'Bugsy Siegel' });
    await pollMentions(deps, NOW);
    assert.equal(replies[0]!.text, '“Never put money down unless you are sure” — Bugsy Siegel');
  });

  test('a question gets a short answer; anything else unclear gets help', async () => {
    const { deps, replies } = await bot([[mention('131', '@vaticeno what is this?'), mention('132', '@vaticeno quote me something nice')]]);
    deps.quoteSource = async () => ({ text: 'Never put money down unless you are sure', by: 'Bugsy Siegel' });
    await pollMentions(deps, NOW);
    assert.equal(replies[0]!.text, 'I record predictions and check them at the deadline.');
    assert.match(replies[1]!.text, /Tag me under your prediction/, 'the stub says "other" → help');
  });
});

describe('STOP', () => {
  test('STOP is confirmed and recorded; tagging the bot again resumes', async () => {
    const { deps, replies } = await bot([[mention('100', '@vaticeno STOP')], [mention('101', '@vaticeno ping')]]);
    await pollMentions(deps, NOW);
    assert.match(replies[0]!.text, /^STOPPED/);
    assert.equal((await t.sql`select count(*)::int as n from opt_outs`)[0]!.n, 1);
    await pollMentions(deps, NOW);
    assert.match(replies[1]!.text, /^pong/);
    assert.equal((await t.sql`select count(*)::int as n from opt_outs`)[0]!.n, 0);
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

  test('the per-author hourly cap stops replies — and nothing is recorded past it', async () => {
    const ms = ['80', '81', '82', '83'].map((id) => mention(id, '@vaticeno ping'));
    const { deps, replies } = await bot([[...ms, mention('84', '@vaticeno BTC daily close above $150,000 by 2026-12-31')]]);
    await pollMentions(deps, NOW);
    assert.equal(replies.length, 3);
    assert.equal((await t.sql`select count(*)::int as n from claims`)[0]!.n, 0, 'no silent claim past the cap');
  });

  test('a mention that keeps failing is skipped after 3 polls, then the next one is handled', async () => {
    const bad = mention('90', '@vaticeno down: BTC above 150k by 2026-12-31');
    const good = mention('91', '@vaticeno ping');
    const { deps, replies } = await bot([[bad, good], [bad, good], [bad, good]]);
    for (let i = 0; i < 3; i++) await pollMentions(deps, NOW);
    assert.deepEqual(replies.map((r) => r.to), ['91']);
    assert.equal((await readIngestState(deps.statePath)).mentions_since_id, '91');
  });

  test('a mention is saved as answered before the post: a failed post is never retried', async () => {
    const m = mention('95', '@vaticeno ping');
    const { deps, replies } = await bot([[m], [m]]);
    let calls = 0;
    deps.postReply = async () => { calls++; throw new Error('network'); };
    await pollMentions(deps, NOW);
    await pollMentions(deps, NOW);
    assert.equal(calls, 1);
    assert.equal(replies.length, 0);
  });
});
