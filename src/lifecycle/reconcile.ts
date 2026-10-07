// The "nothing fell through the cracks" sweep (owner decision 2026-10-07). On 2026-10-06/07 the account
// could not post for fifteen hours and nothing said so: two verdicts were owed, a claim was never shown to
// its author, and the only trace was one Sentry mail at 00:05. This runs every two hours and names what is
// owed.
//
// It reports and does not repair, on purpose. Everything here is work that may already have reached X —
// a verdict marked before a post that may have landed, a feed row reserved by a process that died mid-post.
// Redoing those is how an account posts twice (INIT_SPEC §6.7). The failures we can prove never left the
// machine are already retried where they happen (PostNotSent, src/x/client.ts), so whatever surfaces here
// is the uncertain kind and wants a human. A silent cracks sweep would be worthless, so each find alerts.
import { and, eq, inArray, isNull, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { claims, feedPosts, resolutions } from '../db/schema.js';
import { log } from '../log.js';
import { alert } from '../observe.js';

// A verdict or a feed post in flight is normal for a moment; owed for an hour is not.
const IN_FLIGHT_MS = 60 * 60 * 1000;

export type OwedWork = {
  verdictsOwed: string[]; // final verdicts marked as replied, with no reply id to show for it
  reservedPosts: number; // feed rows reserved but never marked posted or failed
  claimsNeverShown: string[]; // drafts whose RECORDED reply never posted (lock withheld)
  resolverStuck: string[]; // past their check time, still waiting on the resolver
};

export async function auditOwedWork(db: Db, now: Date): Promise<OwedWork> {
  const inFlightBefore = new Date(now.getTime() - IN_FLIGHT_MS);

  const verdicts = await db.select({ slug: claims.slug }).from(claims)
    .innerJoin(resolutions, eq(resolutions.claimId, claims.id))
    .where(and(
      eq(resolutions.reviewStatus, 'final'),
      isNotNull(claims.verdictReplyAt),
      isNull(claims.verdictReplyTweetId),
      lt(claims.verdictReplyAt, inFlightBefore),
    ));

  const [reserved] = await db.select({ n: sql<number>`count(*)::int` }).from(feedPosts)
    .where(and(eq(feedPosts.status, 'reserved'), lt(feedPosts.createdAt, inFlightBefore)));

  const neverShown = await db.select({ slug: claims.slug }).from(claims)
    .where(and(eq(claims.status, 'draft'), isNull(claims.lockAt)));

  const stuck = await db.select({ slug: claims.slug }).from(claims)
    .where(and(
      inArray(claims.status, ['locked', 'resolving']),
      isNotNull(claims.nextCheckAt),
      lt(claims.nextCheckAt, inFlightBefore),
    ));

  const owed: OwedWork = {
    verdictsOwed: verdicts.map((row) => row.slug),
    reservedPosts: reserved?.n ?? 0,
    claimsNeverShown: neverShown.map((row) => row.slug),
    resolverStuck: stuck.map((row) => row.slug),
  };

  // One alert per kind, with the slugs: a verdict nobody was told is the worst thing this account can do.
  if (owed.verdictsOwed.length > 0) alert('reconcile.verdicts_owed', { slugs: owed.verdictsOwed });
  if (owed.claimsNeverShown.length > 0) alert('reconcile.claims_never_shown', { slugs: owed.claimsNeverShown });
  if (owed.reservedPosts > 0) alert('reconcile.feed_posts_in_flight', { count: owed.reservedPosts });
  if (owed.resolverStuck.length > 0) alert('reconcile.resolver_stuck', { slugs: owed.resolverStuck });

  log('info', 'owed-work sweep', {
    event: 'reconcile.run',
    verdicts_owed: owed.verdictsOwed.length,
    claims_never_shown: owed.claimsNeverShown.length,
    feed_posts_in_flight: owed.reservedPosts,
    resolver_stuck: owed.resolverStuck.length,
  });
  return owed;
}
