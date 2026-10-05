import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCoreConfig } from './config.js';

const DB = 'postgres://postgres:dev@localhost:5432/vaticeno';

test('replay mode needs only DATABASE_URL', () => {
  const config = loadCoreConfig({ DATABASE_URL: DB, GEMINI_API_KEY: '' });
  assert.equal(config.LLM_MODE, 'replay');
  assert.equal(config.GEMINI_API_KEY, undefined);
  assert.equal(config.PORT, 3000);
});

test('live and record modes require the API key; model ids always have a default', () => {
  for (const mode of ['live', 'record']) {
    assert.throws(() => loadCoreConfig({ DATABASE_URL: DB, LLM_MODE: mode }), /GEMINI_API_KEY/);
  }
  assert.equal(loadCoreConfig({ DATABASE_URL: DB, LLM_MODE: 'live', GEMINI_API_KEY: 'k', ARBITER_MODEL: 'd' }).ARBITER_MODEL, 'd');
  assert.equal(loadCoreConfig({ DATABASE_URL: DB, NORMALIZER_MODEL: '' }).NORMALIZER_MODEL, 'gemini-3.1-flash-lite');
});

test('DATABASE_URL is required and must be postgres', () => {
  assert.throws(() => loadCoreConfig({}), /DATABASE_URL/);
  assert.throws(() => loadCoreConfig({ DATABASE_URL: 'mysql://x' }), /postgres/);
});

// The feed must never post by accident: off, and dry-run even when switched on (spec 002 FR-007).
test('the content feed is off and dry-run by default', () => {
  const config = loadCoreConfig({ DATABASE_URL: DB });
  assert.equal(config.ENABLE_FEED, false);
  assert.equal(config.FEED_DRY_RUN, true);
  assert.equal(config.FEED_DAILY_USD_CAP, 0.3);
  assert.equal(config.FEED_PLATFORM_ACCOUNT_ID, undefined);
  assert.equal(loadCoreConfig({ DATABASE_URL: DB, ENABLE_FEED: 'true', ENABLE_JOBS: 'true' }).FEED_DRY_RUN, true);
  assert.throws(() => loadCoreConfig({ DATABASE_URL: DB, ENABLE_FEED: 'true' }), /ENABLE_JOBS/);
  assert.throws(() => loadCoreConfig({ DATABASE_URL: DB, FEED_PLATFORM_ACCOUNT_ID: 'kalshi' }), /FEED_PLATFORM_ACCOUNT_ID/);
});
