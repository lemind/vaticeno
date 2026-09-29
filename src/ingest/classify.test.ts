import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Mention } from '../x/client.js';
import { classifyMention, redactDecision } from './classify.js';

const BOT_ID = '100';
const AUTHOR_ID = '200';

function mention(overrides: Partial<Mention>): Mention {
  return { id: '9001', text: '@vaticeno record', author_id: AUTHOR_ID, ...overrides };
}

test('bot mentioning itself is ignored', () => {
  assert.deepEqual(classifyMention(mention({ author_id: BOT_ID }), BOT_ID, 'vaticeno'), { outcome: 'ignored', reason: 'self' });
});

test('repost is ignored', () => {
  const repost = mention({ referenced_tweets: [{ type: 'retweeted', id: '1' }] });
  assert.deepEqual(classifyMention(repost, BOT_ID, 'vaticeno'), { outcome: 'ignored', reason: 'repost' });
});

test('mention without a command is ignored', () => {
  assert.deepEqual(classifyMention(mention({ text: '@vaticeno hi' }), BOT_ID, 'vaticeno'), { outcome: 'ignored', reason: 'no_command' });
});

test('inline prediction records against the mention itself', () => {
  const inline = mention({ text: '@vaticeno record BTC > 150k by 2026-12-31' });
  assert.deepEqual(classifyMention(inline, BOT_ID, 'vaticeno'), {
    outcome: 'record', context: 'inline', body: 'BTC > 150k by 2026-12-31', sourceTweetId: '9001',
  });
});

test('reply to own post records against the parent', () => {
  const reply = mention({ referenced_tweets: [{ type: 'replied_to', id: '777' }], in_reply_to_user_id: AUTHOR_ID });
  assert.deepEqual(classifyMention(reply, BOT_ID, 'vaticeno'), {
    outcome: 'record', context: 'parent', body: '', sourceTweetId: '777',
  });
});

test('reply to someone else\'s post is a third-party summon', () => {
  const reply = mention({ referenced_tweets: [{ type: 'replied_to', id: '777' }], in_reply_to_user_id: '300' });
  assert.deepEqual(classifyMention(reply, BOT_ID, 'vaticeno'), { outcome: 'rejected', reason: 'third_party' });
});

test('bare record with nothing to record needs info', () => {
  assert.deepEqual(classifyMention(mention({}), BOT_ID, 'vaticeno'), { outcome: 'needs_info', reason: 'empty_prediction' });
});

test('"record this" under someone else\'s post is still a third-party summon', () => {
  const reply = mention({
    text: '@alice @vaticeno record this',
    referenced_tweets: [{ type: 'replied_to', id: '777' }],
    in_reply_to_user_id: '300',
  });
  assert.deepEqual(classifyMention(reply, BOT_ID, 'vaticeno'), { outcome: 'rejected', reason: 'third_party' });
});

test('"record that one 👆" under your own post records the parent', () => {
  for (const text of ['@vaticeno record that one.', '@vaticeno record 👆']) {
    const reply = mention({ text, referenced_tweets: [{ type: 'replied_to', id: '777' }], in_reply_to_user_id: AUTHOR_ID });
    assert.deepEqual(classifyMention(reply, BOT_ID, 'vaticeno'), {
      outcome: 'record', context: 'parent', body: '', sourceTweetId: '777',
    });
  }
});

test('a full inline prediction under someone else\'s post is the summoner\'s own claim', () => {
  const reply = mention({
    text: '@alice @vaticeno record ETH below $2,000 by 2027-01-01',
    referenced_tweets: [{ type: 'replied_to', id: '777' }],
    in_reply_to_user_id: '300',
  });
  assert.deepEqual(classifyMention(reply, BOT_ID, 'vaticeno'), {
    outcome: 'record', context: 'inline', body: 'ETH below $2,000 by 2027-01-01', sourceTweetId: '9001',
  });
});

test('logged decisions never contain the user\'s text', () => {
  const inline = classifyMention(mention({ text: '@vaticeno record BTC > 150k by 2026-12-31' }), BOT_ID, 'vaticeno');
  assert.deepEqual(redactDecision(inline), { outcome: 'record', context: 'inline', sourceTweetId: '9001', body_chars: 24 });
});
