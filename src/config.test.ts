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

test('live and record modes require the key and every model id', () => {
  for (const mode of ['live', 'record']) {
    assert.throws(() => loadCoreConfig({ DATABASE_URL: DB, LLM_MODE: mode, NORMALIZER_MODEL: 'm' }), /GEMINI_API_KEY/);
  }
  const full = { GEMINI_API_KEY: 'k', NORMALIZER_MODEL: 'a', JUDGE_MODEL_A: 'b', JUDGE_MODEL_B: 'c', ARBITER_MODEL: 'd' };
  assert.equal(loadCoreConfig({ DATABASE_URL: DB, LLM_MODE: 'live', ...full }).ARBITER_MODEL, 'd');
});

test('DATABASE_URL is required and must be postgres', () => {
  assert.throws(() => loadCoreConfig({}), /DATABASE_URL/);
  assert.throws(() => loadCoreConfig({ DATABASE_URL: 'mysql://x' }), /postgres/);
});
