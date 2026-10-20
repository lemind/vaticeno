// The wager page's hand-encoded calls against the compiled contract (003 T371a): every selector from forge's
// own ABI output, every encoding against `cast`. Needs `forge build` first; CI runs it after Foundry is set up.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  actionsFor,
  decodeStake,
  decodeUintArray,
  encodeAllowance,
  encodeApprove,
  encodeOpen,
  encodeStakeCall,
  encodeStakesOf,
  formatUnits,
  parseUnits,
  SELECTORS,
  type Stake,
} from '../../src/web/wallet-abi.js';

const out = (contract: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../contracts/out/${contract}.sol/${contract}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { methodIdentifiers: Record<string, string> };
const cast = (...args: string[]) =>
  execFileSync('cast', args, { encoding: 'utf8' }).trim();

const SIGNATURES: Record<string, [string, string]> = {
  stakesOf: ['Escrow', 'stakesOf(bytes32)'],
  stakes: ['Escrow', 'stakes(uint256)'],
  paused: ['Escrow', 'paused()'],
  maxStake: ['Escrow', 'maxStake()'],
  feeBps: ['Escrow', 'feeBps()'],
  settlementWindow: ['Escrow', 'settlementWindow()'],
  timeout: ['Escrow', 'timeout()'],
  open: ['Escrow', 'open(bytes32,uint64,uint64,bytes,bool,uint128)'],
  accept: ['Escrow', 'accept(uint256)'],
  expire: ['Escrow', 'expire(uint256)'],
  payout: ['Escrow', 'payout(uint256)'],
  refund: ['Escrow', 'refund(uint256)'],
  approve: ['TestToken', 'approve(address,uint256)'],
  allowance: ['TestToken', 'allowance(address,address)'],
  balanceOf: ['TestToken', 'balanceOf(address)'],
  decimals: ['TestToken', 'decimals()'],
};

const HASH = '0x' + 'ab'.repeat(32);
const SIG = '0x' + '11'.repeat(32) + '22'.repeat(32) + '1b';
const ALICE = '0x00000000000000000000000000000000000a11ce';
const ESCROW = '0x6281F12b4d4AB4bC3d53719A209381F81aFC0A72';

describe('wager page calls match the deployed contract', () => {
  test('every selector is the one forge compiled', () => {
    for (const [name, [contract, signature]] of Object.entries(SIGNATURES)) {
      assert.equal(
        SELECTORS[name],
        '0x' + out(contract).methodIdentifiers[signature],
        name,
      );
    }
  });

  test('open, with its dynamic signature, encodes exactly as cast does', () => {
    const amount = parseUnits('2.5', 18);
    assert.equal(
      encodeOpen({
        claimHash: HASH,
        deadline: 1798761599,
        validUntil: 1798675199,
        signature: SIG,
        makerSaysHit: true,
        amount,
      }),
      cast(
        'calldata',
        'open(bytes32,uint64,uint64,bytes,bool,uint128)',
        HASH,
        '1798761599',
        '1798675199',
        SIG,
        'true',
        amount.toString(),
      ),
    );
  });

  test('the simple calls encode as cast does', () => {
    for (const name of ['accept', 'expire', 'payout', 'refund', 'stakes'])
      assert.equal(
        encodeStakeCall(name, 7),
        cast('calldata', SIGNATURES[name]![1], '7'),
        name,
      );
    assert.equal(
      encodeApprove(ESCROW, 10n ** 20n),
      cast('calldata', 'approve(address,uint256)', ESCROW, (10n ** 20n).toString()),
    );
    assert.equal(
      encodeAllowance(ALICE, ESCROW),
      cast('calldata', 'allowance(address,address)', ALICE, ESCROW),
    );
    assert.equal(encodeStakesOf(HASH), cast('calldata', 'stakesOf(bytes32)', HASH));
  });

  test('a stake and a list of ids decode from what the contract returns', () => {
    const encoded = cast(
      'abi-encode',
      'f(bytes32,address,address,uint128,uint64,uint64,uint64,bool,uint8,uint8)',
      HASH,
      ALICE,
      ESCROW,
      '100000000000000000000',
      '1798761599',
      '1798000000',
      '1798800000',
      'false',
      '3',
      '2',
    );
    assert.deepEqual(decodeStake(encoded), {
      claimHash: HASH,
      maker: ALICE,
      taker: ESCROW.toLowerCase(),
      amount: 10n ** 20n,
      deadline: 1798761599,
      offerExpiry: 1798000000,
      settledAt: 1798800000,
      makerSaysHit: false,
      state: 'Settled',
      outcome: 'Miss',
    });
    assert.deepEqual(
      decodeUintArray(cast('abi-encode', 'f(uint256[])', '[1,2,9]')),
      [1n, 2n, 9n],
    );
  });

  test('amounts are whole token units, never floats, up to the maximum stake', () => {
    assert.equal(parseUnits('100', 18), 10n ** 20n); // the deployed maximum
    assert.equal(parseUnits('0.000000000000000001', 18), 1n);
    assert.throws(() => parseUnits('0.0000000000000000001', 18), /decimal places/);
    assert.throws(() => parseUnits('1e3', 18));
    assert.equal(formatUnits(2_500_000_000_000_000_000n, 18), '2.5');
  });

  test('actions follow the contract: accept before expiry, return after, pay out after the hold', () => {
    const base: Stake = {
      claimHash: HASH,
      maker: ALICE,
      taker: '0x' + '0'.repeat(40),
      amount: 1n,
      deadline: 1000,
      offerExpiry: 500,
      settledAt: 0,
      makerSaysHit: true,
      state: 'Open',
      outcome: 'None',
    };
    const opts = {
      account: ESCROW,
      paused: false,
      settlementWindow: 100,
      timeout: 300,
    };
    assert.deepEqual(
      actionsFor(base, { ...opts, now: 499 }).map((a) => a.name),
      ['accept'],
    );
    assert.deepEqual(
      actionsFor(base, { ...opts, now: 499, account: ALICE }),
      [],
      'the maker never takes their own offer',
    );
    assert.deepEqual(actionsFor(base, { ...opts, now: 499, paused: true }), []);
    assert.deepEqual(
      actionsFor(base, { ...opts, now: 500 }).map((a) => a.name),
      ['expire'],
    );
    const settled = { ...base, state: 'Settled', settledAt: 1100 };
    assert.equal(actionsFor(settled, { ...opts, now: 1199 })[0]!.live, false);
    assert.equal(actionsFor(settled, { ...opts, now: 1200 })[0]!.live, true);
    const matched = { ...base, state: 'Matched' };
    assert.deepEqual(actionsFor(matched, { ...opts, now: 1299 }), []);
    assert.deepEqual(
      actionsFor(matched, { ...opts, now: 1300 }).map((a) => a.name),
      ['refund'],
    );
  });
});
