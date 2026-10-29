// The wager page's hand-encoded calls against the compiled contract (003 T371a): every selector from forge's
// own ABI output, every encoding against `cast`. Needs `forge build` first; CI runs it after Foundry is set up.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  actionsFor,
  capRefusal,
  decodeStake,
  decodeString,
  decodeUintArray,
  encodeAllowance,
  encodeApprove,
  encodeCreditOf,
  encodeLockedOnClaim,
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
  offerLifetime: ['Escrow', 'offerLifetime()'],
  open: ['Escrow', 'open(bytes32,uint64,uint64,bytes,bool,uint128)'],
  accept: ['Escrow', 'accept(uint256)'],
  expire: ['Escrow', 'expire(uint256)'],
  payout: ['Escrow', 'payout(uint256)'],
  refund: ['Escrow', 'refund(uint256)'],
  approve: ['TestToken', 'approve(address,uint256)'],
  allowance: ['TestToken', 'allowance(address,address)'],
  balanceOf: ['TestToken', 'balanceOf(address)'],
  decimals: ['TestToken', 'decimals()'],
  symbol: ['TestUsdc', 'symbol()'],
  minStake: ['EscrowV2', 'minStake()'],
  maxPerClaim: ['EscrowV2', 'maxPerClaim()'],
  maxTotal: ['EscrowV2', 'maxTotal()'],
  lockedOnClaim: ['EscrowV2', 'lockedOnClaim(bytes32)'],
  lockedTotal: ['EscrowV2', 'lockedTotal()'],
  creditOf: ['EscrowV2', 'creditOf(address)'],
  withdraw: ['EscrowV2', 'withdraw()'],
};

// v1's calls the page also sends to v2: the same selectors in both, or the page breaks on one of them.
const SHARED = [
  'stakesOf',
  'stakes',
  'paused',
  'maxStake',
  'feeBps',
  'settlementWindow',
  'timeout',
  'offerLifetime',
  'open',
  'accept',
  'expire',
  'payout',
  'refund',
];

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

  test('every v1 call the page makes is the same call on v2', () => {
    for (const name of SHARED)
      assert.equal(
        SELECTORS[name],
        '0x' + out('EscrowV2').methodIdentifiers[SIGNATURES[name]![1]],
        name,
      );
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
    assert.equal(
      encodeLockedOnClaim(HASH),
      cast('calldata', 'lockedOnClaim(bytes32)', HASH),
    );
    assert.equal(
      encodeCreditOf(ALICE),
      cast('calldata', 'creditOf(address)', ALICE),
    );
    assert.equal(decodeString(cast('abi-encode', 'f(string)', 'tUSDC')), 'tUSDC');
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
    // USDC: 6 decimals, so a cent is 10000 and a millionth is the smallest stake unit.
    assert.equal(parseUnits('1000', 6), 1_000_000_000n);
    assert.equal(parseUnits('0.01', 6), 10_000n);
    assert.throws(() => parseUnits('0.0000001', 6), /decimal places/);
    assert.equal(formatUnits(12_500_000n, 6), '12.5');
  });

  test('v2 names the cap a stake would hit before the wallet signs (SC-026)', () => {
    const USDC = 1_000_000n;
    const caps = {
      minStake: USDC,
      maxStake: 1_000n * USDC,
      lockedOnClaim: 9_500n * USDC,
      maxPerClaim: 10_000n * USDC,
      lockedTotal: 20_000n * USDC,
      maxTotal: 50_000n * USDC,
      decimals: 6,
      symbol: 'USDC',
    };
    assert.equal(
      capRefusal(null, 10n ** 30n, { opening: true }),
      null,
      'v1: no caps',
    );
    assert.equal(capRefusal(caps, 500n * USDC, { opening: true }), null);
    assert.match(capRefusal(caps, USDC / 2n, { opening: true })!, /between 1 USDC/);
    assert.match(
      capRefusal(caps, 1_001n * USDC, { opening: true })!,
      /and 1000 USDC/,
    );
    assert.match(
      capRefusal(caps, 501n * USDC, { opening: true })!,
      /claim's cap is reached: 500 USDC of 10000 USDC left/,
    );
    const full = { ...caps, lockedOnClaim: 0n, lockedTotal: 49_800n * USDC };
    assert.match(
      capRefusal(full, 300n * USDC, { opening: false })!,
      /contract's cap is reached: 200 USDC/,
    );
    // Accepting checks only the caps: an offer already open is never refused for its size.
    assert.equal(capRefusal(caps, 400n * USDC, { opening: false }), null);
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
    const capped = actionsFor(base, {
      ...opts,
      now: 499,
      caps: {
        minStake: 1n,
        maxStake: 10n,
        lockedOnClaim: 20n,
        maxPerClaim: 20n,
        lockedTotal: 20n,
        maxTotal: 100n,
        decimals: 6,
        symbol: 'USDC',
      },
    });
    assert.equal(
      capped[0]!.live,
      false,
      'a full claim shows Accept, refused, with why',
    );
    assert.match(capped[0]!.refused!, /claim's cap/);
    const matched = { ...base, state: 'Matched' };
    assert.deepEqual(actionsFor(matched, { ...opts, now: 1299 }), []);
    assert.deepEqual(
      actionsFor(matched, { ...opts, now: 1300 }).map((a) => a.name),
      ['refund'],
    );
  });
});
