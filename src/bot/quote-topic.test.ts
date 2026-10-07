// The topic cascade (spec 002 phase 7): the free steps must catch the obvious cases, and a paid read
// must only ever happen when nothing cheaper found a subject.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuoteTopic, topicFromWords } from './quote-topic.js';
import type { ExtrasDeps } from './extras.js';

test('a subject in their own words needs no model and no read', () => {
  assert.equal(topicFromWords('quote about btc'), 'Bitcoin');
  assert.equal(topicFromWords('@vaticeno quote me something on the odds'), 'Betting');
  assert.equal(topicFromWords('quote, forecasting edition'), 'Forecasting');
  assert.equal(topicFromWords('a quote about luck please'), 'Luck');
  // The most specific topic wins: both "crypto" and "trading" are here.
  assert.equal(topicFromWords('quote for crypto trading'), 'Bitcoin');
  assert.equal(topicFromWords('quote'), null);
  // Whole words only, so ordinary prose does not trigger a topic.
  assert.equal(topicFromWords('better luckily modelling'), null);
});

function deps(answers: Array<string | null>): { deps: ExtrasDeps; calls: Array<readonly string[]> } {
  const calls: Array<readonly string[]> = [];
  return {
    calls,
    deps: {
      db: {} as never,
      normalizerModel: 'stub',
      llm: {
        generateJson: async ({ input }: { input: string }) => {
          const parsed = JSON.parse(input) as { context?: string[] };
          calls.push(parsed.context ?? []);
          return { data: { topic: answers.shift() ?? null }, costs: [] };
        },
      },
    } as unknown as ExtrasDeps,
  };
}

test('the model is asked about the request alone before anything is read', async () => {
  const { deps: d, calls } = deps(['Chance']);
  const reads: number[] = [];
  const decided = await resolveQuoteTopic(d, 'quote me something fitting', async (depth) => { reads.push(depth); return []; });
  assert.deepEqual(decided, { topic: 'Chance', step: 'model' });
  assert.deepEqual(calls, [[]], 'asked once, with no context');
  assert.deepEqual(reads, [], 'nothing was read');
});

test('the parent is read only after the request itself said nothing', async () => {
  const { deps: d, calls } = deps([null, 'Bitcoin']);
  const reads: number[] = [];
  const decided = await resolveQuoteTopic(d, 'quote', async (depth) => { reads.push(depth); return ['BTC to 150k by Friday']; });
  assert.deepEqual(decided, { topic: 'Bitcoin', step: 'parent' });
  assert.deepEqual(reads, [1], 'one post, not three');
  assert.deepEqual(calls[1], ['BTC to 150k by Friday']);
});

test('two more posts are read only if the parent did not settle it, and random is the floor', async () => {
  const { deps: d } = deps([null, null, 'Risk']);
  const reads: number[] = [];
  const thread = await resolveQuoteTopic(d, 'quote', async (depth) => { reads.push(depth); return depth === 1 ? ['hmm'] : ['first', 'second', 'hmm']; });
  assert.deepEqual(thread, { topic: 'Risk', step: 'thread' });
  assert.deepEqual(reads, [1, 3]);

  const { deps: blind } = deps([null, null, null]);
  const nothing = await resolveQuoteTopic(blind, 'quote', async () => ['one', 'two', 'three']);
  assert.deepEqual(nothing, { topic: null, step: 'random' }, 'a quote still goes out, from a random topic');
});

test('a request that is not a reply never pays for a read', async () => {
  const { deps: d, calls } = deps([null]);
  let readCalls = 0;
  const decided = await resolveQuoteTopic(d, 'quote', async () => { readCalls += 1; return []; });
  assert.deepEqual(decided, { topic: null, step: 'random' });
  assert.equal(calls.length, 1, 'the model was asked once, about the request');
  assert.equal(readCalls, 1, 'the reader was consulted, and it had nothing to give');
});
