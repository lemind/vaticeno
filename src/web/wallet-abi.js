// Hand-encoded calls to the escrow and its token (003 plan: no browser library, VII). Every selector and
// encoding here is checked against the compiled contract by tests/abi/wallet-abi.test.ts.
// Plain ES module: the browser loads it from the wager page, and the test imports it as is.

export const SELECTORS = {
  stakesOf: '0xad7d22f4', // stakesOf(bytes32)
  stakes: '0xd5a44f86', // stakes(uint256)
  paused: '0x5c975abb',
  maxStake: '0xea1b28e0',
  feeBps: '0x24a9d853',
  settlementWindow: '0xb4a7bdf9',
  timeout: '0x70dea79a',
  offerLifetime: '0x13738b0b',
  open: '0x1c4cf960', // open(bytes32,uint64,uint64,bytes,bool,uint128)
  accept: '0x19b05f49',
  expire: '0xbf81bf43',
  payout: '0xe1152343',
  refund: '0x278ecde1',
  // v2 only (docs/decisions/007-escrow-v2.md): the minimum, the caps, what they hold, and the credits.
  minStake: '0x375b3c0a',
  maxPerClaim: '0xe14e4386',
  maxTotal: '0x648e3c26',
  lockedOnClaim: '0x136b3206', // lockedOnClaim(bytes32)
  lockedTotal: '0xf145c73b',
  creditOf: '0x75807250', // creditOf(address)
  withdraw: '0x3ccfd60b',
  approve: '0x095ea7b3', // approve(address,uint256)
  allowance: '0xdd62ed3e', // allowance(address,address)
  balanceOf: '0x70a08231',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
};

// Escrow.State and Escrow.Outcome, in the contract's own order.
export const STATES = ['None', 'Open', 'Matched', 'Settled', 'Paid', 'Voided', 'Refunded', 'Expired'];
export const OUTCOMES = ['None', 'Hit', 'Miss', 'Void'];

const strip = (hex) => (hex.startsWith('0x') ? hex.slice(2) : hex);

function word(hex) {
  const h = strip(hex).toLowerCase();
  if (!/^[0-9a-f]*$/.test(h) || h.length > 64) throw new Error(`not a 32-byte value: ${hex}`);
  return h.padStart(64, '0');
}

export const uint = (value) => {
  const n = BigInt(value);
  if (n < 0n) throw new Error('negative uint');
  return word(n.toString(16));
};
export const address = (value) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`not an address: ${value}`);
  return word(value);
};
export const bool = (value) => uint(value ? 1 : 0);
export const bytes32 = (value) => {
  if (strip(value).length !== 64) throw new Error(`not bytes32: ${value}`);
  return strip(value).toLowerCase();
};

export const call = (selector, ...words) => selector + words.join('');

// open's sixth-word head ends where the signature's length word starts: 6 × 32 bytes.
export function encodeOpen({ claimHash, deadline, validUntil, signature, makerSaysHit, amount }) {
  const sig = strip(signature);
  if (sig.length !== 130) throw new Error('the authorization must be 65 bytes');
  const tail = uint(65) + sig.padEnd(192, '0');
  return call(SELECTORS.open, bytes32(claimHash), uint(deadline), uint(validUntil), uint(6 * 32), bool(makerSaysHit), uint(amount)) + tail;
}

export const encodeStakeCall = (name, id) => call(SELECTORS[name], uint(id));
export const encodeApprove = (spender, amount) => call(SELECTORS.approve, address(spender), uint(amount));
export const encodeAllowance = (owner, spender) => call(SELECTORS.allowance, address(owner), address(spender));
export const encodeBalanceOf = (owner) => call(SELECTORS.balanceOf, address(owner));
export const encodeStakesOf = (claimHash) => call(SELECTORS.stakesOf, bytes32(claimHash));
export const encodeLockedOnClaim = (claimHash) => call(SELECTORS.lockedOnClaim, bytes32(claimHash));
export const encodeCreditOf = (owner) => call(SELECTORS.creditOf, address(owner));

const words = (hex) => strip(hex).match(/.{64}/g) ?? [];
export const decodeUint = (hex) => BigInt('0x' + (words(hex)[0] ?? '0'));

// uint256[]: offset, length, items.
export function decodeUintArray(hex) {
  const w = words(hex);
  const start = Number(BigInt('0x' + w[0]) / 32n);
  const length = Number(BigInt('0x' + w[start]));
  return w.slice(start + 1, start + 1 + length).map((item) => BigInt('0x' + item));
}

// string: offset, length, UTF-8 bytes.
export function decodeString(hex) {
  const h = strip(hex);
  const start = Number(BigInt('0x' + h.slice(0, 64))) * 2;
  const length = Number(BigInt('0x' + h.slice(start, start + 64))) * 2;
  const bytes = h.slice(start + 64, start + 64 + length).match(/../g) ?? [];
  return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16))));
}

// The public `stakes` getter: ten static words, in Escrow.Stake's order.
export function decodeStake(hex) {
  const w = words(hex);
  if (w.length < 10) throw new Error('short stake');
  const n = (i) => BigInt('0x' + w[i]);
  const addr = (i) => '0x' + w[i].slice(24);
  return {
    claimHash: '0x' + w[0],
    maker: addr(1),
    taker: addr(2),
    amount: n(3),
    deadline: Number(n(4)),
    offerExpiry: Number(n(5)),
    settledAt: Number(n(6)),
    makerSaysHit: n(7) === 1n,
    state: STATES[Number(n(8))] ?? 'Unknown',
    outcome: OUTCOMES[Number(n(9))] ?? 'Unknown',
  };
}

// Whole token units only: "12.5" with 18 decimals is 12500000000000000000n, never a float (003 FR-043).
export function parseUnits(text, decimals) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(text).trim());
  if (!match) throw new Error('enter an amount like 10 or 2.5');
  const [, whole, fraction = ''] = match;
  if (fraction.length > decimals) throw new Error(`at most ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

export function formatUnits(value, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

// Why v2 would refuse a stake of `amount`, in the contract's own order, or null; checked before the wallet
// signs (003 SC-026). `opening`: open also checks the amount, accept only the caps. v1 has no caps: null.
export function capRefusal(caps, amount, { opening }) {
  if (!caps) return null;
  const { minStake, maxStake, lockedOnClaim, maxPerClaim, lockedTotal, maxTotal, decimals, symbol } = caps;
  const units = (value) => `${formatUnits(value, decimals)} ${symbol}`;
  if (opening && (amount < minStake || amount > maxStake))
    return `the stake must be between ${units(minStake)} and ${units(maxStake)}`;
  if (lockedOnClaim + amount > maxPerClaim)
    return `this claim's cap is reached: ${units(maxPerClaim - lockedOnClaim)} of ${units(maxPerClaim)} left`;
  if (lockedTotal + amount > maxTotal)
    return `the contract's cap is reached: ${units(maxTotal - lockedTotal)} of ${units(maxTotal)} left`;
  return null;
}

// What the page may offer for one stake, by the contract's own conditions (003 FR-043). `now` in seconds.
export function actionsFor(stake, { now, account, paused, settlementWindow, timeout, caps = null }) {
  const mine = account && stake.maker.toLowerCase() === account.toLowerCase();
  if (stake.state === 'Open') {
    if (now >= stake.offerExpiry) return [{ name: 'expire', label: 'Return expired offer', live: true }];
    if (mine || paused) return [];
    const refused = capRefusal(caps, stake.amount, { opening: false });
    return [refused ? { name: 'accept', label: 'Accept', live: false, refused } : { name: 'accept', label: 'Accept', live: true }];
  }
  if (stake.state === 'Settled') {
    const opens = stake.settledAt + settlementWindow;
    return [{ name: 'payout', label: 'Pay out', live: now >= opens, opensAt: opens }];
  }
  if (stake.state === 'Matched' && now >= stake.deadline + timeout)
    return [{ name: 'refund', label: 'Refund both', live: true }];
  return [];
}
