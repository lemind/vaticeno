// The networks a wager can be on (003 FR-036a, FR-036d). Public facts only: names, explorers, public nodes,
// Circle's native USDC and, on Arbitrum One, Tether's USDT0; on Tron, Tether's USDT (spec 007). Which ones are switched on, and their escrow, comes from WAGER_NETWORKS (config.ts).
import { fromTronAddress } from './tron-address.js';

export type KnownNetwork = {
  name: string;
  // EVM networks and Tron sign, send and show addresses differently (spec 007, ADR 010).
  family: 'evm' | 'tron';
  testnet: boolean;
  explorer: string;
  explorerName: string;
  rpcUrls: string[];
  // Native USDC (FR-036c); a mainnet escrow in any other token is refused at start, as the contract refuses it.
  usdc?: string;
  // A second market on the same network, in Tether's USDT0: its own contract and offers (owner, 2026-11-05).
  usdt?: string;
};

export const KNOWN_NETWORKS: Record<number, KnownNetwork> = {
  84532: {
    name: 'Base Sepolia',
    family: 'evm',
    testnet: true,
    explorer: 'https://sepolia.basescan.org',
    explorerName: 'Basescan',
    rpcUrls: [
      'https://base-sepolia-rpc.publicnode.com',
      'https://base-sepolia.drpc.org',
      'https://base-sepolia.gateway.tenderly.co',
      'https://sepolia.base.org',
    ],
  },
  421614: {
    name: 'Arbitrum Sepolia',
    family: 'evm',
    testnet: true,
    explorer: 'https://sepolia.arbiscan.io',
    explorerName: 'Arbiscan',
    rpcUrls: [
      'https://arbitrum-sepolia-rpc.publicnode.com',
      'https://sepolia-rollup.arbitrum.io/rpc',
    ],
  },
  8453: {
    name: 'Base',
    family: 'evm',
    testnet: false,
    explorer: 'https://basescan.org',
    explorerName: 'Basescan',
    rpcUrls: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  42161: {
    name: 'Arbitrum One',
    family: 'evm',
    testnet: false,
    explorer: 'https://arbiscan.io',
    explorerName: 'Arbiscan',
    rpcUrls: [
      'https://arbitrum-one-rpc.publicnode.com',
      'https://arb1.arbitrum.io/rpc',
    ],
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  // Chain ids as published for Tron; the contract's own view of them is measured in spec 007 T703.
  3448148188: {
    name: 'Tron Nile',
    family: 'tron',
    testnet: true,
    explorer: 'https://nile.tronscan.org/#',
    explorerName: 'Tronscan',
    rpcUrls: ['https://nile.trongrid.io'],
  },
  728126428: {
    name: 'Tron',
    family: 'tron',
    testnet: false,
    explorer: 'https://tronscan.org/#',
    explorerName: 'Tronscan',
    rpcUrls: ['https://api.trongrid.io'],
    usdt: fromTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')!, // Tether's TRC-20 USDT
  },
};

// One switched-on network: what the wager page needs to read and send on it.
export type WagerNetwork = KnownNetwork & {
  // The market's name in the outbox and the health row: the chain id, or `<chain id>-usdt` for USDT0.
  key: string;
  symbol: 'USDC' | 'USDT' | 'tokens';
  chainId: number;
  version: 1 | 2;
  escrow: string;
  token: string;
};

// What is switched on: WAGER_NETWORKS, or the one network the Stage 2 variables name. Empty: wagering is off.
export function wagerNetworks(config: {
  WAGER_NETWORKS?: string | undefined;
  ESCROW_ADDRESS?: string | undefined;
  STAKE_TOKEN_ADDRESS?: string | undefined;
  ESCROW_CHAIN_ID: number;
  ESCROW_VERSION: 1 | 2;
  PUBLIC_RPC_URLS?: string[] | undefined;
}): WagerNetwork[] {
  if (config.WAGER_NETWORKS) return parseWagerNetworks(config.WAGER_NETWORKS);
  if (!config.ESCROW_ADDRESS || !config.STAKE_TOKEN_ADDRESS) return [];
  const known = KNOWN_NETWORKS[config.ESCROW_CHAIN_ID];
  if (!known) throw new Error(`unknown ESCROW_CHAIN_ID ${config.ESCROW_CHAIN_ID}`);
  return [
    {
      ...known,
      rpcUrls: config.PUBLIC_RPC_URLS ?? known.rpcUrls,
      key: String(config.ESCROW_CHAIN_ID),
      symbol: known.usdc ? 'USDC' : 'tokens',
      chainId: config.ESCROW_CHAIN_ID,
      version: config.ESCROW_VERSION,
      escrow: config.ESCROW_ADDRESS,
      token: config.STAKE_TOKEN_ADDRESS,
    },
  ];
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// An address as WAGER_NETWORKS gives it, stored `0x…`: a Tron network also takes its `T…` form.
function addressOn(
  family: KnownNetwork['family'],
  text: string | undefined,
): string | null {
  if (text && ADDRESS.test(text)) return text;
  return family === 'tron' && text ? fromTronAddress(text) : null;
}

// `chainId:version:escrow:token`, comma-separated, e.g. `84532:1:0x62…:0x5C…,421614:2:0x…:0x…`. Throws on
// anything it can't vouch for: an unknown chain, a market named twice, a bad address, a mainnet token that is
// neither its USDC nor its USDT0.
export function parseWagerNetworks(raw: string): WagerNetwork[] {
  const networks = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [chain, version, escrowText, tokenText, ...rest] = entry.split(':');
      const chainId = Number(chain);
      const known = KNOWN_NETWORKS[chainId];
      if (!known || rest.length > 0) throw new Error(`unknown network: ${entry}`);
      if (version !== '1' && version !== '2')
        throw new Error(`escrow version must be 1 or 2: ${entry}`);
      const escrow = addressOn(known.family, escrowText);
      const token = addressOn(known.family, tokenText);
      if (!escrow || !token) throw new Error(`bad address in: ${entry}`);
      const isUsdt =
        !!known.usdt && token.toLowerCase() === known.usdt.toLowerCase();
      if (known.usdc && !isUsdt && token.toLowerCase() !== known.usdc.toLowerCase())
        throw new Error(`${known.name} takes native USDC only (${known.usdc})`);
      if (!known.testnet && !known.usdc && !isUsdt)
        throw new Error(`${known.name} takes Tether's USDT only`);
      return {
        ...known,
        key: isUsdt ? `${chainId}-usdt` : String(chainId),
        symbol: isUsdt
          ? ('USDT' as const)
          : known.usdc
            ? ('USDC' as const)
            : ('tokens' as const),
        chainId,
        version: Number(version) as 1 | 2,
        escrow,
        token,
      };
    });
  const keys = networks.map((n) => n.key);
  if (new Set(keys).size !== keys.length)
    throw new Error('a network is named twice');
  return networks;
}
