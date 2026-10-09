import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressesBot, parseCommand } from './parse.js';

const cases: Array<[string, ReturnType<typeof parseCommand>]> = [
  ['@vaticeno record — BTC closes above $150k before 31 Dec 2026', { kind: 'record', body: 'BTC closes above $150k before 31 Dec 2026' }],
  ['@Vaticeno RECORD: BTC > 150k by 2026-12-31', { kind: 'record', body: 'BTC > 150k by 2026-12-31' }],
  ['BTC closes above $150k before 31 Dec 2026 @vaticeno record', { kind: 'record', body: 'BTC closes above $150k before 31 Dec 2026' }],
  ['@vaticeno on the record Arsenal win the league', { kind: 'record', body: 'Arsenal win the league' }],
  ['@vaticeno otr - ETH below 2k by 2027-01-01', { kind: 'record', body: 'ETH below 2k by 2027-01-01' }],
  ['@alice @vaticeno record', { kind: 'record', body: '' }],
  ['@vaticeno amend BTC daily close above $150,000 by 2026-12-31', { kind: 'amend', body: 'BTC daily close above $150,000 by 2026-12-31' }],
  ['@vaticeno STOP', { kind: 'opt_out' }],
  ['@vaticeno please opt out', { kind: 'opt_out' }],
  ['@vaticeno record BTC won\'t stop until 200k by 2027-06-30', { kind: 'record', body: 'BTC won\'t stop until 200k by 2027-06-30' }],
  ['@vaticeno BTC to the moon', { kind: 'none' }],
  ['@vaticenobot record BTC', { kind: 'none' }],
  ['@vaticeno recording this', { kind: 'none' }],
  ['no mention at all, record', { kind: 'none' }],
];

for (const [text, expected] of cases) {
  test(`parseCommand: ${text}`, () => {
    assert.deepEqual(parseCommand(text, 'vaticeno'), expected);
  });
}

test('parseCommand: ping', () => {
  assert.deepEqual(parseCommand('@vaticeno ping', 'vaticeno'), { kind: 'ping' });
  assert.deepEqual(parseCommand('@alice @vaticeno PING!', 'vaticeno'), { kind: 'ping' });
  assert.deepEqual(parseCommand('@vaticeno @vaticeno ping 1', 'vaticeno'), { kind: 'ping' });
  assert.deepEqual(parseCommand('@vaticeno @alice ping', 'vaticeno'), { kind: 'ping' });
  assert.deepEqual(parseCommand('@vaticeno test ping 2', 'vaticeno'), { kind: 'ping' });
  assert.deepEqual(parseCommand('hey ping @vaticeno', 'vaticeno'), { kind: 'ping' });
  assert.deepEqual(parseCommand('@vaticeno pinging you', 'vaticeno'), { kind: 'none' });
  assert.deepEqual(parseCommand('@vaticeno record ping pong by 2027-01-01', 'vaticeno'), {
    kind: 'record',
    body: 'ping pong by 2027-01-01',
  });
});

test('parseCommand: record after several leading handles', () => {
  assert.deepEqual(parseCommand('@vaticeno @alice record BTC > 150k by 2026-12-31', 'vaticeno'), {
    kind: 'record',
    body: 'BTC > 150k by 2026-12-31',
  });
});

// X prepends participants' handles to replies, so being in a thread is not being asked (owner report 2026-10-09).
const reply = (text: string, inReplyToUserId?: string) => ({
  text, author_id: 'author', in_reply_to_user_id: inReplyToUserId, referenced_tweets: [{ type: 'replied_to', id: 'parent' }],
});
const own = (text: string) => ({ text, author_id: 'author' });

// [name, expected, mention, we already replied in this thread]
const addressed: Array<[string, boolean, ReturnType<typeof reply> | ReturnType<typeof own>, boolean]> = [
  ['a post of its own naming us', true, own('@vaticeno BTC above $150k by 2026-12-31'), false],
  ['a reply to one of our posts (a fix)', true, reply('@vaticeno make it the daily close', 'bot'), true],
  ['a reply under their own post', true, reply('@vaticeno this, by next month', 'author'), true],
  ['tagged into a thread we are not in', true, reply('@vaticeno BTC above $150k by 2026-12-31', 'stranger'), false],
  ['tagged into a thread we are not in, handle carried too', true, reply('@alice @vaticeno Arsenal win the league by 2027-05-31', 'alice'), false],
  ['our handle typed into the body of a thread we are in', true, reply('@alice ask @vaticeno to judge this', 'alice'), true],
  ['strangers talking to each other in a thread we answered', false, reply('@vaticeno @alice no way that happens', 'alice'), true],
  ['the same, several carried handles', false, reply('@alice @vaticeno @bob you are both wrong', 'alice'), true],
  ['a carried handle in front of a bare command word', false, reply('@vaticeno ping', 'alice'), true],
  ['a carried handle and nothing of their own', false, reply('@vaticeno', 'alice'), true],
];

for (const [name, expected, mention, inThread] of addressed) {
  test(`addressesBot: ${name}`, () => {
    assert.equal(addressesBot(mention, 'vaticeno', 'bot', inThread), expected);
  });
}
