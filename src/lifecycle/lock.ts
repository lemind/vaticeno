// Lock job: at lock_at the post is re-read once. Unchanged → locked (version + text hash); edited → a fix, or
// expired. Never locked against a version it wasn't built from (constitution I, spec "Amends and edits").
import { createHash } from 'node:crypto';
import { and, asc, eq, lte } from 'drizzle-orm';
import { alert, captureError } from '../observe.js';
import { renderStatement } from '../contract/render.js';
import { recordCosts } from '../db/costs.js';
import { type ClaimRow, claims } from '../db/schema.js';
import { log } from '../log.js';
import { amendedReply, expiredReply } from '../replies/templates.js';
import { type ClaimDeps, evaluateClaimText, MAX_AMENDS, recordingCostsOnFailure, replaceDraftContract } from './claims.js';
import type { CallCost } from '../llm/client.js';
import type { SourceReader } from './source-reader.js';
import { X_POST_READ_USD } from '../x/prices.js';

const MAX_DRAFTS_PER_RUN = 100;
// A draft that still can't be locked a day after lock_at (post unreadable, model or feed down) expires with an
// alert, instead of retrying forever and holding up newer drafts.
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

// summonTweetId / authorId: where an [AMENDED] / [EXPIRED] reply goes (posted by the scheduler when X is on).
export type LockResult = { slug: string; outcome: 'locked' | 'amended' | 'expired' | 'waiting'; reply: string | null; summonTweetId?: string; authorId?: string };

export async function lockDueDrafts(deps: ClaimDeps & { reader: SourceReader }, now: Date): Promise<LockResult[]> {
  const due = await deps.db.select().from(claims)
    .where(and(eq(claims.status, 'draft'), lte(claims.lockAt, now)))
    .orderBy(asc(claims.lockAt))
    .limit(MAX_DRAFTS_PER_RUN);

  const results: LockResult[] = [];
  for (const claim of due) {
    try {
      results.push(await lockDraft(deps, claim, now));
    } catch (error) {
      // One broken draft (model or feed down, …) never stops the others: it waits, then gives up.
      captureError(error, { event: 'claim.lock_failed', claim_id: claim.id, slug: claim.slug });
      results.push(await waitOrGiveUp(deps.db, claim, now, 'lock_failed'));
    }
  }
  return results;
}

async function lockDraft(deps: ClaimDeps & { reader: SourceReader }, claim: ClaimRow, now: Date): Promise<LockResult> {
  const { db } = deps;
  const slug = claim.slug;

  // The deadline came before lock_at: never lockable, never judged (lifecycle "draft → expired"). Judged
  // against lock_at, not the job's run time — the claim is locked at lock_at even if the job runs late.
  if (!claim.deadlineAt || !claim.lockAt || claim.deadlineAt.getTime() <= claim.lockAt.getTime()) {
    return expireDraft(db, claim, 'deadline_before_lock', null);
  }

  let post;
  try {
    post = await deps.reader.readVersion(claim.sourceTweetId);
    // Recorded only once the post is in hand: X bills for posts it returns, and an unreadable post is
    // re-tried every minute for a day — billing each attempt would invent most of the ledger.
    await recordCosts(db, [{ provider: 'x', operation: 'thread_read', units: 1, usdCost: X_POST_READ_USD, claimId: claim.id }]);
  } catch (error) {
    // Can't see the post: never lock blind (constitution I); retry, and give up after a day.
    log('warn', 'post unreadable at lock; waiting', { event: 'claim.lock_wait', claim_id: claim.id, slug, error: String(error) });
    return waitOrGiveUp(db, claim, now, 'post_unreadable');
  }

  if (post.versionId === claim.sourceVersion) {
    const rows = await db.update(claims).set({
      status: 'locked',
      lockedSourceVersion: post.versionId,
      lockedSourceHash: createHash('sha256').update(post.text).digest('hex'), // the text itself is never stored
      nextCheckAt: claim.deadlineAt,
    }).where(and(
      eq(claims.id, claim.id), eq(claims.status, 'draft'), eq(claims.sourceVersion, post.versionId),
      eq(claims.amendCount, claim.amendCount), lte(claims.lockAt, now), // a fix that landed meanwhile restarts the wait
    )).returning({ id: claims.id });
    if (rows.length === 0) return { slug, outcome: 'waiting', reply: null }; // changed meanwhile; next tick decides
    log('info', 'claim locked', { event: 'claim.locked', claim_id: claim.id, slug, source_version: post.versionId });
    return { slug, outcome: 'locked', reply: null };
  }

  // The post was edited after recording: the edited text goes through proposal + checks like a fix.
  if (claim.amendCount >= MAX_AMENDS) return expireDraft(db, claim, 'edit_over_limit', expiredReply(slug));
  const costs: CallCost[] = [];
  const { decision, modelId, selfConfidence } = await recordingCostsOnFailure(db, claim.id, costs, () => evaluateClaimText(deps, post.text, now, costs));
  if (decision.outcome !== 'recorded') {
    await recordCosts(db, costs.map((cost) => ({ ...cost, claimId: claim.id })));
    return expireDraft(db, claim, 'edit_failed_checks', expiredReply(slug));
  }
  let reply: string;
  try {
    reply = amendedReply(slug, renderStatement(decision.contract), MAX_AMENDS - claim.amendCount - 1); // before any write
  } catch {
    await recordCosts(db, costs.map((cost) => ({ ...cost, claimId: claim.id })));
    return expireDraft(db, claim, 'edit_reply_too_long', expiredReply(slug)); // same answer every retry: don't pay again
  }
  const applied = await replaceDraftContract(db, claim, { contract: decision.contract, modelId, selfConfidence, versionId: post.versionId, now, costs, lockNotReached: false });
  if (!applied) return { slug, outcome: 'waiting', reply: null };
  return { slug, outcome: 'amended', reply, summonTweetId: claim.summonTweetId, authorId: claim.authorXUserId };
}

async function waitOrGiveUp(db: ClaimDeps['db'], claim: ClaimRow, now: Date, reason: string): Promise<LockResult> {
  if (claim.lockAt && now.getTime() - claim.lockAt.getTime() >= GIVE_UP_AFTER_MS) {
    alert('claim.lock_gave_up', { claim_id: claim.id, slug: claim.slug, reason });
    return expireDraft(db, claim, reason, null);
  }
  return { slug: claim.slug, outcome: 'waiting', reply: null };
}

// 0 rows (a fix landed meanwhile) → no reply; the next tick decides again.
async function expireDraft(db: ClaimDeps['db'], claim: ClaimRow, reason: string, reply: string | null): Promise<LockResult> {
  const rows = await db.update(claims).set({ status: 'expired', nextCheckAt: null })
    .where(and(eq(claims.id, claim.id), eq(claims.status, 'draft'), eq(claims.amendCount, claim.amendCount))).returning({ id: claims.id });
  if (rows.length === 0) return { slug: claim.slug, outcome: 'waiting', reply: null };
  log('info', 'claim expired', { event: 'claim.expired', claim_id: claim.id, slug: claim.slug, reason });
  return { slug: claim.slug, outcome: 'expired', reply, summonTweetId: claim.summonTweetId, authorId: claim.authorXUserId };
}
