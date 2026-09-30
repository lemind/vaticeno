// Trust level of an evidence source (data-model "Trust level"). No fixed site list: the judge rates each
// page, and code caps it — only the price feed and the contract's own source domain can be primary. Pure.
import type { TRUST_LEVELS } from '../db/schema.js';

export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const PRICE_FEED_SOURCE = 'coinbase-candles';

export function capTrust(rated: TrustLevel, url: string, contract: { source: { locator: string } }): TrustLevel {
  if (url === PRICE_FEED_SOURCE) return 'primary';
  const host = hostOf(url);
  if (!host) return 'weak';
  if (rated !== 'primary') return rated;
  // A model can't make an arbitrary site decide alone: primary only on the source fixed at lock.
  const locatorHost = hostOf(contract.source.locator);
  return locatorHost && registrableDomain(host) === registrableDomain(locatorHost) ? 'primary' : 'established';
}

export function hostOf(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:' && protocol !== 'http:') return null;
    return hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

// Registrable domain without a public-suffix dependency: a generic second level under a country code
// (com.tr, co.uk, gov.au, …) or a few known multi-part suffixes take three labels. Enough for the
// independence gate, the locator rule and source standing.
const GENERIC_SECOND_LEVEL = new Set(['com', 'co', 'org', 'net', 'gov', 'gouv', 'ac', 'edu', 'or', 'ne', 'go', 'gob']);
const MULTI_PART_SUFFIXES = new Set(['europa.eu']);

export function registrableDomain(host: string): string {
  const labels = host.split('.');
  const [second, top] = labels.slice(-2);
  const countrySuffix = top?.length === 2 && second !== undefined && GENERIC_SECOND_LEVEL.has(second);
  return countrySuffix || MULTI_PART_SUFFIXES.has(labels.slice(-2).join('.')) ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
}
