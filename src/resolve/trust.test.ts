import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capTrust, PRICE_FEED_SOURCE, registrableDomain } from './trust.js';

const contract = (locator = 'https://www.accessdata.fda.gov/scripts/cder/daf/') => ({ source: { locator } });

test('the price feed is always primary', () => {
  assert.equal(capTrust('weak', PRICE_FEED_SOURCE, contract()), 'primary');
});

test('primary stands only on the contract source domain, including its subdomains', () => {
  assert.equal(capTrust('primary', 'https://www.accessdata.fda.gov/x', contract()), 'primary');
  assert.equal(capTrust('primary', 'https://fda.gov/news', contract()), 'primary');
  assert.equal(capTrust('primary', 'https://www.fda.gov/news', contract()), 'primary');
});

test('primary anywhere else is capped to established', () => {
  assert.equal(capTrust('primary', 'https://www.reuters.com/x', contract()), 'established');
  assert.equal(capTrust('primary', 'https://ema.europa.eu/x', contract()), 'established');
});

test('lookalike domains never get the contract source\'s primary', () => {
  assert.equal(capTrust('primary', 'https://fda.gov.evil.com/approval', contract()), 'established');
  assert.equal(capTrust('primary', 'https://notfda.gov/approval', contract()), 'established');
});

test('established and weak are kept as rated, also on the contract source domain', () => {
  assert.equal(capTrust('established', 'https://www.reuters.com/x', contract()), 'established');
  assert.equal(capTrust('weak', 'https://www.reuters.com/x', contract()), 'weak');
  assert.equal(capTrust('weak', 'https://www.fda.gov/x', contract()), 'weak');
});

test('garbage and non-web URLs are weak whatever the rating', () => {
  assert.equal(capTrust('primary', 'not a url', contract()), 'weak');
  assert.equal(capTrust('established', 'ftp://fda.gov/x', contract()), 'weak');
});

test('a broken contract locator makes nothing primary', () => {
  assert.equal(capTrust('primary', 'https://www.fda.gov/x', contract('not a url')), 'established');
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
