// `@vaticeno wager` (003 Story 5): one link reply per claim, one plain refusal per reason, nothing anywhere
// else. The row is written before the reply goes, so a crash mid-post loses the link rather than send two;
// only a post that provably never left gives it back.
import { and, count, eq, gte } from 'drizzle-orm';
import {
  claims,
  settlementOutbox,
  wagerReplies,
  type WagerReplyKind,
} from '../db/schema.js';
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

// A switched-on network, as far as the reply needs it (src/wager/networks.ts).
type ReplyNetwork = { chainId: number; name: string; testnet: boolean };

export type WagerDeps = {
  db: Db;
  wager?: { host: string; linksPerDay: number; networks: readonly ReplyNetwork[] };
};

export async function wagerReply(
  deps: WagerDeps,
  slug: string,
  mentionId: string,
  now: Date,
): Promise<{
  action: string;
  reply: string | null;
  slug?: string;
  onNotSent?: () => Promise<void>;
}> {
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

  // Each network the claim has a row on and that is switched on now answers for itself (FR-036d): the
  // link goes out if any of them can still take an offer, and names only those.
  const rows = await deps.db
    .select({
      network: settlementOutbox.network,
      authorizedUntil: settlementOutbox.authorizedUntil,
    })
    .from(settlementOutbox)
    .where(eq(settlementOutbox.claimId, claim.id));
  const answers = deps.wager.networks.flatMap((network) => {
    const row = rows.find((r) => r.network === String(network.chainId));
    return row ? [{ network, kind: wagerKind({ ...claim, outbox: row }, now) }] : [];
  });
  const open = answers.filter((a) => a.kind === 'link');
  // No row on any switched-on network is a claim no worker will sign: the same answer as no row (terms.ts).
  const kind = open.length
    ? 'link'
    : (answers[0]?.kind ?? wagerKind({ ...claim, outbox: null }, now));
  const realMoney = open
    .filter((a) => !a.network.testnet)
    .map((a) => a.network.name);
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
  const [row] = spent;
  return {
    action: `wager_${kind}`,
    reply: replyFor(kind, deps.wager.host, realMoney, slug, claim.lockAt, now),
    slug,
    // A post that provably never left (PostNotSent) gives the link back; an uncertain one never does (§6.7).
    onNotSent: async () => {
      await deps.db.delete(wagerReplies).where(eq(wagerReplies.id, row!.id));
    },
  };
}

function replyFor(
  kind: WagerReplyKind,
  host: string,
  realMoney: readonly string[],
  slug: string,
  lockAt: Date | null,
  now: Date,
): string {
  switch (kind) {
    case 'link':
      return wagerLinkReply(host, slug, realMoney);
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
