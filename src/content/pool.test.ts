// The weighted pick (spec 002 FR-002): shares follow the weights, the previous account never repeats,
// and an account without a known id is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POOL, PLATFORM_HANDLE, pickAccount, poolAccounts } from './pool.js';

// A small deterministic generator, so the shares are the same on every run.
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const IDS = Object.fromEntries(POOL.filter((e) => e.handle !== PLATFORM_HANDLE).map((e, i) => [e.handle, `id${i}`]));

test('the pool is the 17 accounts of docs/content-rules.md, weights summing to 157', () => {
  assert.equal(POOL.length, 17);
  assert.equal(POOL.reduce((sum, e) => sum + e.weight, 0), 157);
});

test('an account is read only with a known numeric id', () => {
  assert.equal(poolAccounts(undefined, IDS).length, 16, 'the platform account needs its env id');
  assert.equal(poolAccounts('p9', IDS).length, 17);
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
    const expected = account.weight / 157;
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

test('a disabled account is never picked', () => {
  const accounts = poolAccounts('p9', IDS).map((a) => (a.handle === 'OptaJoe' ? { ...a, enabled: false } : a));
  const enabled = accounts.filter((a) => a.enabled);
  const random = seeded(11);
  for (let i = 0; i < 2000; i++) assert.notEqual(pickAccount(enabled, null, random)!.handle, 'OptaJoe');
});
