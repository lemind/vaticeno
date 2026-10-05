// The weighted pick (spec 002 FR-002): shares follow the weights, the previous account never repeats,
// and an account without a known id is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POOL, PLATFORM_HANDLE, pickAccount, poolAccounts } from './pool.js';

// mulberry32: a deterministic generator, so the shares are the same on every run. Math.imul keeps every
// step inside 32 bits — a plain `state * 1103515245` would pass 2^53 and silently lose its low bits.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

const IDS = Object.fromEntries(POOL.filter((e) => e.handle !== PLATFORM_HANDLE).map((e, i) => [e.handle, `id${i}`]));

test('the pool is the 16 accounts of docs/content-rules.md, weights summing to 147', () => {
  assert.equal(POOL.length, 16);
  assert.equal(POOL.reduce((sum, e) => sum + e.weight, 0), 147);
});

test('an account is read only with a known numeric id', () => {
  assert.equal(poolAccounts(undefined, IDS).length, 15, 'the platform account needs its env id');
  assert.equal(poolAccounts('p9', IDS).length, 16);
  assert.equal(poolAccounts('p9', IDS).find((a) => a.handle === PLATFORM_HANDLE)?.id, 'p9');
  assert.equal(poolAccounts('p9', {}).length, 1, 'no lookup has run yet: only the configured account');
});

test('picks follow the weights', () => {
  const accounts = poolAccounts('p9', IDS);
  const random = seeded(7);
  const picks = new Map<string, number>();
  const runs = 20_000;
  for (let i = 0; i < runs; i++) {
    const account = pickAccount(accounts, null, random)!;
    picks.set(account.handle, (picks.get(account.handle) ?? 0) + 1);
  }
  for (const account of accounts) {
    const share = (picks.get(account.handle) ?? 0) / runs;
    const expected = account.weight / 147;
    assert.ok(Math.abs(share - expected) < 0.015, `${account.handle}: ${share.toFixed(3)} vs ${expected.toFixed(3)}`);
  }
});

test('the previous run’s account never comes up again, and a lone account yields nothing', () => {
  const accounts = poolAccounts('p9', IDS);
  const random = seeded(3);
  for (let i = 0; i < 2000; i++) assert.notEqual(pickAccount(accounts, 'id0', random)!.id, 'id0');
  assert.equal(pickAccount([accounts[0]!], accounts[0]!.id), null);
  assert.equal(pickAccount([], null), null);
});

test('a disabled account is dropped from the pool, so it is never read or picked', () => {
  const pool = POOL.map((e) => (e.handle === 'OptaJoe' ? { ...e, enabled: false } : e));
  const accounts = poolAccounts('p9', IDS, pool);
  assert.equal(accounts.length, 15);
  assert.equal(accounts.find((a) => a.handle === 'OptaJoe'), undefined);
  const random = seeded(11);
  for (let i = 0; i < 2000; i++) assert.notEqual(pickAccount(accounts, null, random)!.handle, 'OptaJoe');
});
