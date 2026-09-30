// Lock job (spec "Amends and edits before lock", data-model claims): at lock_at the post is re-read once.
// Unchanged → locked with its version + text hash. Edited → the edit is treated like a fix, or the claim
// expires; a contract is never locked against a post version it wasn't built from (constitution I).
import { createHash } from 'node:crypto';
import { and, asc, eq, lte } from 'drizzle-orm';
import { renderStatement } from '../contract/render.js';
import { recordCosts } from '../db/costs.js';
import { claims } from '../db/schema.js';
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
  for (const claim of due) results.push(await lockDraft(deps, claim, now));
  return results;
}

type ClaimRow = typeof claims.$inferSelect;

async function lockDraft(deps: ClaimDeps & { reader: SourceReader }, claim: ClaimRow, now: Date): Promise<LockResult> {
  const { db } = deps;
  const slug = claim.slug;

  // The deadline passed before lock: never judged (FR, lifecycle "draft → expired").
  if (!claim.deadlineAt || claim.deadlineAt.getTime() <= now.getTime()) {
    await expire(db, claim, 'deadline_before_lock');
    return { slug, outcome: 'expired', reply: null };
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
    }).where(and(eq(claims.id, claim.id), eq(claims.status, 'draft'), eq(claims.sourceVersion, post.versionId))).returning({ id: claims.id });
    if (rows.length === 0) return { slug, outcome: 'waiting', reply: null }; // changed meanwhile; next tick decides
    log('info', 'claim locked', { event: 'claim.locked', claim_id: claim.id, slug, source_version: post.versionId });
    return { slug, outcome: 'locked', reply: null };
  }

  // The post was edited after recording: the edited text goes through proposal + checks like a fix.
  if (claim.amendCount >= MAX_AMENDS) {
    await expire(db, claim, 'edit_over_limit');
    return { slug, outcome: 'expired', reply: expiredReply(slug) };
  }
  const { decision, modelId, selfConfidence, costs } = await evaluate(deps, post.text, now);
  if (decision.outcome !== 'recorded') {
    await recordCosts(db, costs.map((cost) => ({ ...cost, claimId: claim.id })));
    await expire(db, claim, 'edit_failed_checks');
    return { slug, outcome: 'expired', reply: expiredReply(slug) };
  }
  const applied = await replaceDraftContract(db, claim, { contract: decision.contract, modelId, selfConfidence, versionId: post.versionId, now, costs, lockNotReached: false });
  if (!applied) return { slug, outcome: 'waiting', reply: null };
  return { slug, outcome: 'amended', reply: amendedReply(slug, renderStatement(decision.contract), MAX_AMENDS - claim.amendCount - 1) };
}

async function expire(db: ClaimDeps['db'], claim: ClaimRow, reason: string): Promise<void> {
  const rows = await db.update(claims).set({ status: 'expired', nextCheckAt: null })
    .where(and(eq(claims.id, claim.id), eq(claims.status, 'draft'))).returning({ id: claims.id });
  if (rows.length > 0) log('info', 'claim expired', { event: 'claim.expired', claim_id: claim.id, slug: claim.slug, reason });
}
