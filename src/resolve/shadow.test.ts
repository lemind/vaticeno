import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VERIFIER_MODEL, wouldConclude } from './shadow.js';
import type { VerifierResult } from './verifier.js';

const read = (entail: number, contradict: number): VerifierResult => ({
  ok: true,
  model: VERIFIER_MODEL,
  entail,
  contradict,
  windows: 1,
  truncated: false,
  latencyMs: 10,
});

test('two pages that both clearly entail would finalise HIT, at the weaker one', () => {
  const row = wouldConclude([read(0.97, 0.01), read(0.92, 0.03)]);
  assert.deepEqual(
    [row.wouldFinalise, row.wouldOutcome, row.minConfidence],
    [true, 'hit', 0.92],
  );
});

test('a page that entails and contradicts at once escalates, however high either side is', () => {
  const row = wouldConclude([read(0.95, 0.93), read(0.95, 0.93)]);
  assert.equal(row.wouldFinalise, false);
});

test('one page alone, or one page that disagrees, escalates', () => {
  assert.equal(wouldConclude([read(0.99, 0.0)]).wouldFinalise, false);
  assert.equal(
    wouldConclude([read(0.99, 0.0), read(0.02, 0.97)]).wouldFinalise,
    false,
  );
});

test('one unread page means no finalising answer, and the row keeps the error', () => {
  const row = wouldConclude([
    read(0.99, 0.0),
    read(0.99, 0.0),
    { ok: false, error: 'timeout', latencyMs: 20_000 },
  ]);
  assert.deepEqual(
    [row.wouldFinalise, row.errorTag, row.latencyMs],
    [false, 'timeout', 20_000],
  );
});

test('an answer from any model but the frozen one is refused, never counted', () => {
  const row = wouldConclude([
    read(0.99, 0.0),
    { ...read(0.99, 0.0), model: 'other@1' } as VerifierResult,
  ]);
  assert.deepEqual([row.wouldFinalise, row.errorTag], [false, 'model_mismatch']);
});
