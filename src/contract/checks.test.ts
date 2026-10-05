import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runChecks } from './checks.js';
import type { Proposal } from './proposal.js';

const NOW = new Date('2026-09-30T12:00:00Z');

const priceContract = {
  subject: 'BTC',
  criterion: 'BTC-USD daily close above 150000',
  deadline_at: '2026-12-31T23:59:59Z',
  source: {
    name: 'Coinbase BTC-USD daily candles',
    kind: 'crypto_price',
    locator: 'https://api.exchange.coinbase.com/products/BTC-USD/candles',
    scope: 'BTC-USD',
    entity_id: 'BTC-USD',
    absence_is_meaningful: false,
    fallback: 'same_issuer_only' as const,
  },
  negative_condition: 'no daily close above 150000 in the window',
  resolution_method: 'price_feed' as const,
  price: { provider: 'coinbase' as const, product_id: 'BTC-USD', comparison: 'CLOSE_ABOVE' as const, threshold: 150000, window_mode: 'any_time_before' as const },
};

function proposal(overrides: Partial<Proposal> = {}, contract: Record<string, unknown> = {}): Proposal {
  return {
    is_prediction: true,
    x_rules_ok: true,
    contract: { ...priceContract, ...contract } as Proposal['contract'],
    unclear: [],
    unclear_explanation: '',
    examples: [],
    self_confidence: 0.9,
    ...overrides,
  };
}

const check = (p: Proposal, claimed = false) => runChecks(p, NOW, { sourcePostClaimed: claimed });

test('a complete contract is recorded', () => {
  assert.equal(check(proposal()).outcome, 'recorded');
});

test('not a prediction and X-rules violations are rejected, in that order', () => {
  assert.deepEqual(check(proposal({ is_prediction: false, x_rules_ok: false })), { outcome: 'rejected', reason: 'not_prediction' });
  assert.deepEqual(check(proposal({ x_rules_ok: false })), { outcome: 'rejected', reason: 'x_rules' });
});

test('missing or event-derived deadline is needs info, never a guess', () => {
  assert.deepEqual(check(proposal({ contract: null, unclear: ['subject'] })), { outcome: 'needs_info', unclear: ['subject', 'deadline'] });
  assert.deepEqual(check(proposal({ unclear: ['deadline'] })), { outcome: 'needs_info', unclear: ['deadline'] });
});

test('deadline must be more than 24 h away (exactly 24 h is rejected)', () => {
  assert.deepEqual(check(proposal({}, { deadline_at: '2026-10-01T12:00:00Z' })), { outcome: 'rejected', reason: 'deadline_too_close' });
  assert.equal(check(proposal({}, { deadline_at: '2026-10-01T12:00:01Z' })).outcome, 'recorded');
  assert.deepEqual(check(proposal({}, { deadline_at: '2026-09-01T00:00:00Z' })), { outcome: 'rejected', reason: 'deadline_too_close' });
});

test('a sports match only needs the deadline after the 15 min lock (a game starting soon is fine)', () => {
  const model = (deadline_at: string) => check(proposal({}, { resolution_method: 'model', deadline_at, source: { ...priceContract.source, kind: 'football_results' } }));
  assert.notEqual(model('2026-09-30T13:00:00Z').outcome, 'rejected', 'an hour away');
  assert.deepEqual(model('2026-09-30T12:15:00Z'), { outcome: 'rejected', reason: 'deadline_too_close' });
  assert.deepEqual(model('2026-09-29T12:00:00Z'), { outcome: 'rejected', reason: 'deadline_too_close' });
  const stock = check(proposal({}, { resolution_method: 'model', deadline_at: '2026-09-30T13:00:00Z', source: { ...priceContract.source, kind: 'company_news' } }));
  assert.deepEqual(stock, { outcome: 'rejected', reason: 'deadline_too_close' }, 'anything else keeps 24 h');
});

test('deadline must be within 10 years (exactly 10 years is allowed)', () => {
  assert.equal(check(proposal({}, { deadline_at: '2036-09-30T12:00:00Z' })).outcome, 'recorded');
  assert.deepEqual(check(proposal({}, { deadline_at: '2036-09-30T12:00:01Z' })), { outcome: 'rejected', reason: 'deadline_too_far' });
});

test('anything unclear is needs info with the model’s list', () => {
  assert.deepEqual(check(proposal({ unclear: ['threshold', 'source'] })), { outcome: 'needs_info', unclear: ['threshold', 'source'] });
});

test('structural gaps are needs info: missing negative condition, bad source, price terms', () => {
  assert.deepEqual(check(proposal({}, { negative_condition: '' })), { outcome: 'needs_info', unclear: ['success_condition'] });
  assert.deepEqual(check(proposal({}, { source: { ...priceContract.source, locator: 'not a url' } })), { outcome: 'needs_info', unclear: ['source'] });
  assert.deepEqual(check(proposal({}, { price: undefined })), { outcome: 'needs_info', unclear: ['threshold'] });
  assert.deepEqual(check(proposal({}, { resolution_method: 'model' })), { outcome: 'needs_info', unclear: ['threshold'] });
});

test('a claimed source post is a duplicate', () => {
  assert.deepEqual(check(proposal(), true), { outcome: 'rejected', reason: 'duplicate' });
});
