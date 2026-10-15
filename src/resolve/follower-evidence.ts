// Follower-count claims: one read of the account's count, and the count at that read decides
// (004 T420, owner decision 2026-10-15).
import { createHash } from 'node:crypto';
import type { FollowerTerms } from '../contract/schema.js';
import type { CallCost } from '../llm/client.js';
import { X_USER_READ_USD } from '../x/prices.js';
import { SourceUnavailable } from './fetch.js';
import type { EvidenceDraft } from './gates.js';

export type FollowerReader = {
  getFollowerCount(userId: string): Promise<number | null>;
};

export function compareFollowers(
  terms: FollowerTerms,
  count: number,
): 'hit' | 'miss' {
  const meets =
    terms.comparison === 'AT_LEAST'
      ? count >= terms.threshold
      : count < terms.threshold;
  return meets ? 'hit' : 'miss';
}

export async function gatherFollowerEvidence(
  x: FollowerReader | undefined,
  terms: FollowerTerms,
  locator: string,
  deadlineAt: Date,
  now: Date,
  costs: CallCost[],
): Promise<{ draft: EvidenceDraft; value: number | null; contentSha256: string }> {
  if (!x) throw new SourceUnavailable('no X client configured for follower counts');
  let count: number | null;
  try {
    count = await x.getFollowerCount(terms.user_id);
  } catch (error) {
    throw new SourceUnavailable('X user lookup failed', { cause: error });
  }
  costs.push({
    provider: 'x',
    operation: 'fetch',
    units: 1,
    usdCost: X_USER_READ_USD,
  });

  const before = now.getTime() < deadlineAt.getTime();
  const says =
    count === null
      ? 'entity_gone'
      : before
        ? 'pending'
        : compareFollowers(terms, count);
  return {
    draft: {
      sourceKind: 'web',
      basis: 'record',
      trustLevel: 'primary',
      says,
      eventDate:
        count === null || before ? null : deadlineAt.toISOString().slice(0, 10), // X keeps no history: the read stands for the deadline
      eventStart: null,
      url: locator,
      retrievedAt: now,
      quoteFound: count !== null, // the number is read from the API itself, not quoted by a model
      eventMatch: 'not_applicable', // the account's own profile, not a page about an event (004 FR-014)
      selfConsistent: null,
      isFinalResult: says === 'hit' || says === 'miss',
      originalSource: null,
      simhash: null,
    },
    value: count,
    contentSha256: createHash('sha256')
      .update(JSON.stringify({ user_id: terms.user_id, count }))
      .digest('hex'),
  };
}
