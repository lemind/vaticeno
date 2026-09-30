// Earned source standing (data-model "sources"): a site gets a row on its first confirmed final verdict and
// +1 per later one. Known sources (≥ 5) are a search hint only; standing never changes a trust level.
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { evidences, sources } from '../db/schema.js';
import { hostOf, registrableDomain } from './trust.js';

export const KNOWN_SOURCE_MIN = 5;
const KNOWN_SOURCES_LIMIT = 30;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function knownSources(db: Db): Promise<string[]> {
  const rows = await db.select({ domain: sources.domain }).from(sources)
    .where(gte(sources.agreedCount, KNOWN_SOURCE_MIN))
    .orderBy(desc(sources.agreedCount))
    .limit(KNOWN_SOURCES_LIMIT);
  return rows.map((row) => row.domain);
}

// Call inside the transaction that writes a final HIT/MISS. Once per domain per claim: re-runs and several
// pages from one site count once. Only web evidence whose quote was found on the page counts.
export async function recordSourceStanding(tx: Tx | Db, claimId: string, outcome: 'hit' | 'miss', now: Date): Promise<string[]> {
  const rows = await tx.select({ url: evidences.url, gates: evidences.gates }).from(evidences)
    .where(and(eq(evidences.claimId, claimId), eq(evidences.sourceKind, 'web'), eq(evidences.says, outcome)));
  const domains = new Set<string>();
  for (const row of rows) {
    const host = row.url ? hostOf(row.url) : null;
    if (host && (row.gates as { quote_found?: boolean | null }).quote_found === true) domains.add(registrableDomain(host));
  }
  for (const domain of domains) {
    await tx.insert(sources).values({ domain, agreedCount: 1, firstAgreedAt: now, lastAgreedAt: now })
      .onConflictDoUpdate({ target: sources.domain, set: { agreedCount: sql`${sources.agreedCount} + 1`, lastAgreedAt: now } });
  }
  return [...domains];
}
