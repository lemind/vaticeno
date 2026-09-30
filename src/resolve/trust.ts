// Trust level of an evidence source, in code, from the curated source policy (data-model "Trust level").
// Only the policy grants trust on its own; the contract's locator (model-chosen) is trusted at most. Pure.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { TRUST_LEVELS } from '../db/schema.js';

export type TrustLevel = (typeof TRUST_LEVELS)[number];

const domain = z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'bare lowercase domain, no scheme or path');
export const SourcePolicySchema = z.object({
  version: z.number().int().positive(),
  official: z.record(z.string(), z.array(domain).min(1)),
  trusted: z.record(z.string(), z.array(domain)),
});
export type SourcePolicy = z.infer<typeof SourcePolicySchema>;

export function loadSourcePolicy(path = new URL('../../config/source-policy.json', import.meta.url)): SourcePolicy {
  return SourcePolicySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export const PRICE_FEED_SOURCE = 'coinbase-candles';

export function trustLevel(url: string, contract: { source: { kind: string; locator: string } }, policy: SourcePolicy): TrustLevel {
  if (url === PRICE_FEED_SOURCE) return 'official';
  const host = hostOf(url);
  if (!host) return 'other';
  if (Object.values(policy.official).some((domains) => domains.some((d) => onDomain(host, d)))) return 'official';
  const trustedForKind = policy.trusted[contract.source.kind] ?? [];
  if (trustedForKind.some((d) => onDomain(host, d))) return 'trusted';
  // The contract's own link counts as trusted (never official), so it always needs a second source.
  const locatorHost = hostOf(contract.source.locator);
  if (locatorHost && registrableDomain(host) === registrableDomain(locatorHost)) return 'trusted';
  return 'other';
}

// host equals the domain or is a subdomain of it: fda.gov, www.fda.gov — never fda.gov.evil.com.
export function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
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
// independence gate and the locator rule; the curated policy itself matches by onDomain.
const GENERIC_SECOND_LEVEL = new Set(['com', 'co', 'org', 'net', 'gov', 'gouv', 'ac', 'edu', 'or', 'ne', 'go', 'gob']);
const MULTI_PART_SUFFIXES = new Set(['europa.eu']);

export function registrableDomain(host: string): string {
  const labels = host.split('.');
  const [second, top] = labels.slice(-2);
  const countrySuffix = top?.length === 2 && second !== undefined && GENERIC_SECOND_LEVEL.has(second);
  return countrySuffix || MULTI_PART_SUFFIXES.has(labels.slice(-2).join('.')) ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
}
