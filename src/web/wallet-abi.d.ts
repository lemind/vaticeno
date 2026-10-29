// Types for wallet-abi.js, the browser's plain-JS encoder, so its test typechecks (003 T371a).
export const SELECTORS: Record<string, string>;
export const STATES: string[];
export const OUTCOMES: string[];
export function uint(value: bigint | number | string): string;
export function address(value: string): string;
export function bool(value: boolean): string;
export function bytes32(value: string): string;
export function call(selector: string, ...words: string[]): string;
export function encodeOpen(args: {
  claimHash: string;
  deadline: number;
  validUntil: number;
  signature: string;
  makerSaysHit: boolean;
  amount: bigint;
}): string;
export function encodeStakeCall(name: string, id: bigint | number): string;
export function encodeApprove(spender: string, amount: bigint): string;
export function encodeAllowance(owner: string, spender: string): string;
export function encodeBalanceOf(owner: string): string;
export function encodeStakesOf(claimHash: string): string;
export function encodeLockedOnClaim(claimHash: string): string;
export function encodeCreditOf(owner: string): string;
export function decodeUint(hex: string): bigint;
export function decodeString(hex: string): string;
export function decodeUintArray(hex: string): bigint[];
export type Stake = {
  claimHash: string;
  maker: string;
  taker: string;
  amount: bigint;
  deadline: number;
  offerExpiry: number;
  settledAt: number;
  makerSaysHit: boolean;
  state: string;
  outcome: string;
};
export function decodeStake(hex: string): Stake;
export function parseUnits(text: string, decimals: number): bigint;
export function formatUnits(value: bigint, decimals: number): string;
export type Caps = {
  minStake: bigint;
  maxStake: bigint;
  lockedOnClaim: bigint;
  maxPerClaim: bigint;
  lockedTotal: bigint;
  maxTotal: bigint;
  decimals: number;
  symbol: string;
};
export function capRefusal(
  caps: Caps | null,
  amount: bigint,
  opts: { opening: boolean },
): string | null;
export type Action = {
  name: string;
  label: string;
  live: boolean;
  opensAt?: number;
  refused?: string;
};
export function actionsFor(
  stake: Stake,
  opts: {
    now: number;
    account: string | null;
    paused: boolean;
    settlementWindow: number;
    timeout: number;
    caps?: Caps | null;
  },
): Action[];
