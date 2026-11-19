import assert from 'node:assert/strict';
import { test } from 'node:test';
import { averaged, fractional, oddsText } from './odds-format.js';
import { weightedLength } from '../replies/templates.js';

test('decimal prices land on the common fractional ladder', () => {
  assert.equal(fractional(3.0), '2:1');
  assert.equal(fractional(1.5), '1:2');
  assert.equal(fractional(1.25), '1:4');
  assert.equal(fractional(6.0), '5:1');
  assert.equal(fractional(3.7), '11:4', 'never 27:10');
  assert.equal(fractional(2.0), '1:1');
  assert.equal(fractional(500), '100:1');
});

test('only outcomes two bookmakers price, averaged, shortest first', () => {
  const lines = averaged([
    { name: 'City', prices: [2.2, 2.3] },
    { name: 'Draw', prices: [3.5] },
    { name: 'Arsenal', prices: [3.0, 3.2, 0.5, Number.NaN] },
  ]);
  assert.deepEqual(
    lines.map((l) => [l.name, l.decimal.toFixed(2), l.bookmakers]),
    [
      ['City', '2.25', 2],
      ['Arsenal', '3.10', 2],
    ],
  );
});

test('a match: every outcome with its decimal, the bookmaker count, no handle or link', () => {
  const text = oddsText(
    'Arsenal v Man City @bookie https://x.y',
    averaged([
      { name: 'Arsenal', prices: [3.0, 3.0, 3.0] },
      { name: 'Draw', prices: [3.5, 3.5] },
      { name: '#City', prices: [2.2, 2.2] },
    ]),
  );
  assert.equal(
    text,
    'Arsenal v Man City bookie: City 6:5 (2.20) · Arsenal 2:1 (3.00) · Draw 5:2 (3.50) — about, from 2 bookmakers',
  );
  assert.equal(
    oddsText('x', averaged([{ name: 'A', prices: [2, 2] }])),
    null,
    'one outcome is no odds',
  );
});

test('a race: the five shortest named, then one range on the ladder, within one post', () => {
  const runners = Array.from({ length: 14 }, (_, i) => ({
    name: `Horse Number ${i + 1}`,
    prices: [2 + i * 3.1, 2.1 + i * 3.1],
  }));
  const text = oddsText('Hong Kong Cup', averaged(runners))!;
  assert.match(
    text,
    /Horse Number 5 \S+ \(\d+\.\d\d\) · rest \d+:\d+–\d+:\d+ — about, from 2 bookmakers$/,
  );
  assert.ok(!text.includes('Horse Number 6 '), 'the sixth is in the range');
  assert.ok(weightedLength(text) <= 280);
});
