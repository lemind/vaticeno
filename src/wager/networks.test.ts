import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWagerNetworks } from './networks.js';

const A = '0x' + '11'.repeat(20);
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

test('each network is named once, with its own escrow, and a mainnet takes native USDC only', () => {
  const [sepolia, base] = parseWagerNetworks(
    `84532:1:${A}:${A}, 8453:2:${A}:${BASE_USDC}`,
  );
  assert.deepEqual(
    [sepolia!.name, sepolia!.version, base!.name, base!.version],
    ['Base Sepolia', 1, 'Base', 2],
  );
  assert.throws(() => parseWagerNetworks(`8453:2:${A}:${A}`), /native USDC only/);
  assert.throws(
    () => parseWagerNetworks(`84532:1:${A}:${A},84532:2:${A}:${A}`),
    /named twice/,
  );
  assert.throws(() => parseWagerNetworks(`1:2:${A}:${A}`), /unknown network/);
  assert.throws(() => parseWagerNetworks(`84532:3:${A}:${A}`), /version/);
});

test('Arbitrum One carries a USDT0 market beside its USDC one, under its own key; Base takes no USDT', () => {
  const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const USDT0 = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
  const [usdc, usdt] = parseWagerNetworks(
    `42161:2:${A}:${USDC},42161:2:${A}:${USDT0}`,
  );
  assert.deepEqual(
    [usdc!.key, usdc!.symbol, usdt!.key, usdt!.symbol],
    ['42161', 'USDC', '42161-usdt', 'USDT'],
  );
  assert.throws(
    () => parseWagerNetworks(`8453:2:${A}:${USDT0}`),
    /native USDC only/,
  );
  assert.throws(
    () => parseWagerNetworks(`42161:2:${A}:${USDT0},42161:2:${A}:${USDT0}`),
    /named twice/,
  );
});
