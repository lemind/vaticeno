// Lock job: at lock_at the post is re-read once. Unchanged → locked (version + text hash); edited → a fix, or
// expired. Never locked against a version it wasn't built from (constitution I, spec "Amends and edits").
import { createHash } from 'node:crypto';
import { and, asc, eq, lte } from 'drizzle-orm';
import { captureError } from '../observe.js';
import { renderStatement } from '../contract/render.js';
import { recordCosts } from '../db/costs.js';
import { type ClaimRow, claims } from '../db/schema.js';
import { log } from '../log.js';
import { amendedReply, expiredReply } from '../replies/templates.js';
import { type ClaimDeps, evaluate, MAX_AMENDS, replaceDraftContract } from './claims.js';
import type { SourceReader } from './source-reader.js';

const MAX_DRAFTS_PER_RUN = 100;

export type LockOutcome = 'locked' | 'amended' | 'expired' | 'waiting';
export type LockResult = { slug: string; outcome: LockOutcome; reply: string | null };

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
      // One broken draft (model or feed down, …) never stops the others; it is retried on the next tick.
      captureError(error, { event: 'claim.lock_failed', claim_id: claim.id, slug: claim.slug });
      results.push({ slug: claim.slug, outcome: 'waiting', reply: null });
    }
  }
  return results;
}

async function lockDraft(deps: ClaimDeps & { reader: SourceReader }, claim: ClaimRow, now: Date): Promise<LockResult> {
  const { db } = deps;
  const slug = claim.slug;

  // The deadline passed before lock: never judged (FR, lifecycle "draft → expired").
  if (!claim.deadlineAt || claim.deadlineAt.getTime() <= now.getTime()) {
    return expire(db, claim, 'deadline_before_lock', null);
  }

  let post;
  try {
    post = await deps.reader.readVersion(claim.sourceTweetId);
  } catch (error) {
    // Can't see the post: don't lock blind, retry on the next tick (constitution III).
    log('warn', 'post unreadable at lock; waiting', { event: 'claim.lock_wait', claim_id: claim.id, slug, error: String(error) });
    return { slug, outcome: 'waiting', reply: null };
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
  if (claim.amendCount >= MAX_AMENDS) return expire(db, claim, 'edit_over_limit', expiredReply(slug));
  const { decision, modelId, selfConfidence, costs } = await evaluate(deps, post.text, now);
  if (decision.outcome !== 'recorded') {
    await recordCosts(db, costs.map((cost) => ({ ...cost, claimId: claim.id })));
    return expire(db, claim, 'edit_failed_checks', expiredReply(slug));
  }
  const applied = await replaceDraftContract(db, claim, { contract: decision.contract, modelId, selfConfidence, versionId: post.versionId, now, costs, lockNotReached: false });
  if (!applied) return { slug, outcome: 'waiting', reply: null };
  return { slug, outcome: 'amended', reply: amendedReply(slug, renderStatement(decision.contract), MAX_AMENDS - claim.amendCount - 1) };
}

// 0 rows (a fix landed meanwhile) → no reply; the next tick decides again.
async function expire(db: ClaimDeps['db'], claim: ClaimRow, reason: string, reply: string | null): Promise<LockResult> {
  const rows = await db.update(claims).set({ status: 'expired', nextCheckAt: null })
    .where(and(eq(claims.id, claim.id), eq(claims.status, 'draft'), eq(claims.amendCount, claim.amendCount))).returning({ id: claims.id });
  if (rows.length === 0) return { slug: claim.slug, outcome: 'waiting', reply: null };
  log('info', 'claim expired', { event: 'claim.expired', claim_id: claim.id, slug: claim.slug, reason });
  return { slug: claim.slug, outcome: 'expired', reply };
}
