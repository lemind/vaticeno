import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSourcePolicy, PRICE_FEED_SOURCE, registrableDomain, trustLevel } from './trust.js';

const policy = loadSourcePolicy();
const contract = (kind: string, locator = 'https://www.accessdata.fda.gov/scripts/cder/daf/') => ({ source: { kind, locator } });

test('the committed policy file is valid', () => {
  assert.ok(policy.version >= 1);
});

test('official only from the policy list, including subdomains', () => {
  assert.equal(trustLevel('https://www.fda.gov/news-events/x', contract('regulatory'), policy), 'official');
  assert.equal(trustLevel('https://accessdata.fda.gov/scripts/x', contract('regulatory'), policy), 'official');
  assert.equal(trustLevel(PRICE_FEED_SOURCE, contract('crypto_price'), policy), 'official');
});

test('lookalike domains are never official or trusted', () => {
  assert.equal(trustLevel('https://fda.gov.evil.com/approval', contract('regulatory'), policy), 'other');
  assert.equal(trustLevel('https://notfda.gov/approval', contract('regulatory'), policy), 'other');
  assert.equal(trustLevel('https://reuters.com.fake.net/x', contract('regulatory'), policy), 'other');
});

test('trusted sites depend on the contract kind; an unknown kind selects no list', () => {
  assert.equal(trustLevel('https://www.reuters.com/x', contract('regulatory'), policy), 'trusted');
  assert.equal(trustLevel('https://www.skysports.com/x', contract('regulatory'), policy), 'other');
  assert.equal(trustLevel('https://www.skysports.com/x', contract('football_results'), policy), 'trusted');
  assert.equal(trustLevel('https://www.reuters.com/x', contract('made_up_kind', 'https://example.org/'), policy), 'other');
});

test('the contract locator not on the official list is trusted, never official', () => {
  const c = contract('made_up_kind', 'https://records.some-league.org/table');
  assert.equal(trustLevel('https://www.some-league.org/news', c, policy), 'trusted');
  assert.equal(trustLevel('https://other-league.org/news', c, policy), 'other');
});

test('garbage and non-web URLs are other', () => {
  assert.equal(trustLevel('not a url', contract('regulatory'), policy), 'other');
  assert.equal(trustLevel('ftp://fda.gov/x', contract('regulatory'), policy), 'other');
});

test('registrable domain handles two-part suffixes', () => {
  assert.equal(registrableDomain('www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(registrableDomain('news.bbc.com'), 'bbc.com');
  assert.equal(registrableDomain('www.ema.europa.eu'), 'ema.europa.eu');
  assert.equal(registrableDomain('www.aa.com.tr'), 'aa.com.tr');
  assert.equal(registrableDomain('news.gov.au'), 'news.gov.au');
  assert.equal(registrableDomain('www.guardian.ng'), 'guardian.ng');
  assert.equal(registrableDomain('www.interieur.gouv.fr'), 'interieur.gouv.fr');
});
