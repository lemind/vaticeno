import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanDates, wagerLinkReply } from './templates.js';

test('dates in posted text read as "16 Oct 2026", and nothing else is touched', () => {
  assert.equal(
    humanDates('BTC daily close above $150,000 on any day by 2026-10-16'),
    'BTC daily close above $150,000 on any day by 16 Oct 2026',
  );
  assert.equal(
    humanDates('RECORDED · #ab12c\n"City beat Arsenal — by 2026-01-02"'),
    'RECORDED · #ab12c\n"City beat Arsenal — by 2 Jan 2026"',
  );
  // A time of day keeps its UTC clock, only the date changes.
  assert.equal(
    humanDates('deadline 2026-12-31 18:30 UTC'),
    'deadline 31 Dec 2026 18:30 UTC',
  );
  // Not a date: left alone.
  assert.equal(humanDates('score 2-1 in 2026'), 'score 2-1 in 2026');
  assert.equal(humanDates('version 2026-99-01'), 'version 2026-99-01');
});

test('the wager reply names Tron with the other USDT network (spec 007 FR-011)', () => {
  const text = wagerLinkReply('https://vaticeno.test', 'abcde', [
    { name: 'Base', symbol: 'USDC' },
    { name: 'Arbitrum One', symbol: 'USDC' },
    { name: 'Arbitrum One', symbol: 'USDT' },
    { name: 'Tron', symbol: 'USDT' },
  ]);
  assert.match(
    text,
    /\nUSDC on Base or Arbitrum One; USDT on Arbitrum One or Tron\.$/,
  );
});
