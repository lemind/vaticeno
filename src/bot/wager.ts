// `@vaticeno wager` (003 Story 5): one link reply per claim, one plain refusal per reason, nothing anywhere
// else. The row is written before the reply goes, so a crash mid-post loses the link rather than send two.
import { and, count, eq, gte } from 'drizzle-orm';
import { claims, wagerReplies, type WagerReplyKind } from '../db/schema.js';
import type { Db } from '../db/client.js';
import { log } from '../log.js';
import { alert } from '../observe.js';
import {
  wagerClosedReply,
  wagerLinkReply,
  wagerNotLockedReply,
  wagerNotPriceReply,
} from '../replies/templates.js';
import { wagerKind } from '../wager/terms.js';

export type WagerDeps = {
  db: Db;
  wager?: { host: string; linksPerDay: number };
};

export async function wagerReply(
  deps: WagerDeps,
  slug: string,
  mentionId: string,
  now: Date,
): Promise<{ action: string; reply: string | null; slug?: string }> {
  const [claim] = await deps.db
    .select({
      id: claims.id,
      status: claims.status,
      resolutionMethod: claims.resolutionMethod,
      deadlineAt: claims.deadlineAt,
      lockAt: claims.lockAt,
      contract: claims.contract,
    })
    .from(claims)
    .where(eq(claims.slug, slug))
    .limit(1);
  // A claim still asking for its prediction has nothing to wager on yet, and nothing to say about it.
  if (!claim?.contract) return { action: 'wager_no_contract', reply: null };
  if (!deps.wager) {
    alert('wager.not_configured', { slug });
    return { action: 'wager_not_configured', reply: null };
  }

  const kind = wagerKind(claim, now);
  if (
    kind === 'link' &&
    (await linksToday(deps.db, now)) >= deps.wager.linksPerDay
  ) {
    alert('wager.daily_cap', { slug, cap: deps.wager.linksPerDay }); // nothing spent: a later ask can still get it
    return { action: 'wager_capped', reply: null, slug };
  }
  const spent = await deps.db
    .insert(wagerReplies)
    .values({ claimId: claim.id, kind, mentionId, createdAt: now })
    .onConflictDoNothing()
    .returning({ id: wagerReplies.id });
  if (spent.length === 0) {
    log('info', 'wager already answered for this claim; no reply', {
      event: 'wager.spent',
      slug,
      kind,
      tweet_id: mentionId,
    });
    return { action: `wager_${kind}_spent`, reply: null, slug };
  }
  return {
    action: `wager_${kind}`,
    reply: replyFor(kind, deps.wager.host, slug, claim.lockAt, now),
    slug,
  };
}

function replyFor(
  kind: WagerReplyKind,
  host: string,
  slug: string,
  lockAt: Date | null,
  now: Date,
): string {
  switch (kind) {
    case 'link':
      return wagerLinkReply(host, slug);
    case 'not_locked':
      return wagerNotLockedReply(slug, lockAt, now);
    case 'not_price':
      return wagerNotPriceReply(slug);
    case 'closed':
      return wagerClosedReply(slug);
  }
}

// UTC day, link rows only: refusals count against the ordinary reply caps (003 FR-038).
async function linksToday(db: Db, now: Date): Promise<number> {
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const [row] = await db
    .select({ n: count() })
    .from(wagerReplies)
    .where(and(eq(wagerReplies.kind, 'link'), gte(wagerReplies.createdAt, day)));
  return row?.n ?? 0;
}
