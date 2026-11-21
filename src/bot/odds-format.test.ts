import assert from 'node:assert/strict';
import { test } from 'node:test';
import { averaged, fractional, oddsText } from './odds-format.js';
import { weightedLength } from '../replies/templates.js';

test('decimal prices land on the common fractional ladder', () => {
  assert.equal(fractional(3.0), '2:1');
  assert.equal(fractional(1.5), '1:2');
  assert.equal(fractional(1.25), '1:4');
  assert.equal(fractional(1.06), '1:16', 'a heavy favourite, as Grok gave Kabayel');
  assert.equal(fractional(1.01), '1:100');
  assert.equal(fractional(6.0), '5:1');
  assert.equal(fractional(3.7), '11:4', 'never 27:10');
  assert.equal(fractional(2.0), '1:1');
  assert.equal(fractional(101), '100:1');
});

test('only outcomes two bookmakers price, averaged, shortest first', () => {
  const lines = averaged([
    { name: 'City', prices: [2.2, 2.3] },
    { name: 'Draw', prices: [3.5] },
    { name: 'Arsenal', prices: [3.0, 3.2, 0.5, Number.NaN] },
  ]);
  assert.deepEqual(
    lines.map((l) => [l.name, l.decimal.toFixed(2), l.low, l.high]),
    [
      ['City', '2.25', 2.2, 2.3],
      ['Arsenal', '3.10', 3.0, 3.2],
    ],
  );
});

test('a match: every outcome with its decimal, no handle, link or bookmaker count', () => {
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
    'Arsenal v Man City bookie: City 6:5 (2.20) · Arsenal 2:1 (3.00) · Draw 5:2 (3.50)',
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
    /Horse Number 5 [\d:–]+ \(\d+\.\d\d–\d+\.\d\d\) · rest \d+:\d+–\d+:\d+$/,
  );
  assert.ok(!text.includes('Horse Number 6 '), 'the sixth is in the range');
  assert.ok(weightedLength(text) <= 280);
});

test('review 2026-11-19: no bare domain, no empty head, long shots, and too long never reads as "no prices"', () => {
  const two = (a: string, b: string) =>
    averaged([
      { name: a, prices: [2, 2] },
      { name: b, prices: [3, 3] },
    ]);
  const domains = oddsText('Derby on bet365.com', two('Arsenal', 'bet365.com'));
  assert.equal(
    domains,
    null,
    'an outcome that was only a domain leaves one outcome: no odds',
  );
  assert.ok(!oddsText('bet365.com', two('A', 'B'))!.includes('bet365'));
  assert.match(
    oddsText('#', two('A', 'B'))!,
    /^A 1:1/,
    'an empty event leaves the body alone',
  );
  assert.equal(fractional(251), '250:1');
  const long = Array.from({ length: 12 }, (_, i) => ({
    name: `A Very Long Racehorse Name Number ${i + 1} Of The Field`,
    prices: [3 + i, 3 + i],
  }));
  const text = oddsText(
    'The Longest Race Name Anyone Has Ever Written Down',
    averaged(long),
  )!;
  assert.ok(text && weightedLength(text) <= 280, 'shortened to fit, not refused');
  assert.match(text, /rest \d+:\d+–\d+:\d+$/);
});

test("each outcome shows the bookmakers' range; one price when they agree", () => {
  const text = oddsText(
    'Kabayel v Hysa',
    averaged([
      { name: 'Kabayel', prices: [1.25, 1.29, 1.22] },
      { name: 'Hysa', prices: [4.0, 4.0] },
    ]),
  );
  assert.equal(
    text,
    'Kabayel v Hysa: Kabayel 2:9–2:7 (1.22–1.29) · Hysa 3:1 (4.00)',
  );
});

test('a dotted name is a name, not a domain; a bookmaker domain is still dropped', () => {
  const text = oddsText('Final', [
    { name: 'J.Sinner bet365.com', decimal: 1.5, low: 1.5, high: 1.5 },
    { name: 'C.Alcaraz', decimal: 2.6, low: 2.5, high: 2.7 },
  ]);
  assert.ok(text?.includes('J.Sinner'), text ?? '');
  assert.ok(text?.includes('C.Alcaraz'), text ?? '');
  assert.ok(!text?.includes('bet365'), text ?? '');
});
