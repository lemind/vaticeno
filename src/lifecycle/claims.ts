// Claim services: take their dependencies and `now` as arguments (plan.md "Architecture").
import { and, eq, gt } from 'drizzle-orm';
import { type RejectReason, runChecks } from '../contract/checks.js';
import type { Proposal, UnclearItem } from '../contract/proposal.js';
import { renderStatement } from '../contract/render.js';
import type { Contract } from '../contract/schema.js';
import { newSlug } from '../contract/slug.js';
import type { Db } from '../db/client.js';
import { recordCosts } from '../db/costs.js';
import { type ClaimRow, claims, positions } from '../db/schema.js';
import type { Coinbase } from '../feeds/coinbase.js';
import type { CallCost, LlmClient } from '../llm/client.js';
import { proposeContract } from '../llm/normalize.js';
import { log } from '../log.js';
import { buildNeedsInfoReply } from '../replies/needs-info.js';
import { NEEDS_INFO_WINDOW_MS } from './expire.js';
import { REACHED_LOCK } from './transitions.js';
import {
  alreadyRecordedReply, amendedReply, HELP_REPLY, notChangedReply, recordedReply, stillNotRecordedReply, type RefusalReason, refusedReply, rejectedReply, rejectReasonWords,
} from '../replies/templates.js';
import type { SourceReader } from './source-reader.js';

export const LOCK_DELAY_MS = 15 * 60 * 1000;

export type ClaimDeps = { db: Db; llm: LlmClient; coinbase: Coinbase; normalizerModel: string };

export type SubmitInput = {
  text: string; // used for the proposal only — never stored or logged (FR-029)
  authorId: string;
  sourceTweetId: string;
  summonTweetId: string;
  sourceVersion: string;
  now: Date;
};

export type SubmitResult = {
  outcome: 'recorded' | 'needs_info' | 'rejected' | 'duplicate' | 'help';
  slug: string | null; // null for help: no claim is created
  rejectReason?: RejectReason;
  reply: string;
};

type Decision =
  | { outcome: 'recorded'; contract: Contract }
  | { outcome: 'needs_info'; unclear: UnclearItem[]; explanation: string; proposal: Proposal | null }
  | { outcome: 'rejected'; reason: Exclude<RejectReason, 'duplicate'> };

type Evaluation = { decision: Decision; modelId: string; selfConfidence: number | null };

// Proposal → checks → price feed confirmation. Shared by submit, fixes and edits found at lock. Paid calls go
// into `costs` as they happen, so a feed outage after the model call still leaves its cost to record.
export async function evaluateClaimText(deps: ClaimDeps, text: string, now: Date, costs: CallCost[]): Promise<Evaluation> {
  const proposed = await proposeContract(deps.llm, deps.normalizerModel, text, now.toISOString().slice(0, 10));
  costs.push(...proposed.costs);
  if (proposed.kind === 'malformed') {
    const explanation = "I couldn't turn this into a checkable prediction.";
    return { decision: { outcome: 'needs_info', unclear: [], explanation, proposal: null }, modelId: proposed.modelId, selfConfidence: null };
  }
  const { proposal } = proposed;
  const checked = runChecks(proposal, now, { sourcePostClaimed: false });
  let decision: Decision;
  if (checked.outcome === 'rejected') decision = { outcome: 'rejected', reason: checked.reason as Exclude<RejectReason, 'duplicate'> };
  else if (checked.outcome === 'needs_info') decision = { outcome: 'needs_info', unclear: checked.unclear, explanation: proposal.unclear_explanation, proposal };
  else decision = await confirmPriceFeed(deps.coinbase, checked.contract, proposal);
  return { decision, modelId: proposed.modelId, selfConfidence: proposal.self_confidence };
}

// A step that throws after paid calls (feed outage, unreadable post) still records what was spent (FR-031).
export async function recordingCostsOnFailure<T>(db: Db, claimId: string | null, costs: CallCost[], step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    await recordCosts(db, costs.map((cost) => ({ ...cost, claimId })));
    throw error;
  }
}

export async function submitClaim(deps: ClaimDeps, input: SubmitInput): Promise<SubmitResult> {
  const { db } = deps;

  // "@vaticeno help": the list of actions, no model call, no claim. Stage 1 must test the mention's own
  // text here, not the prediction post's.
  if (/^\s*help[!?.]*\s*$/i.test(input.text.replace(/@\w+/g, ''))) return { outcome: 'help', slug: null, reply: HELP_REPLY };

  // A re-summon of a claimed post is a cheap duplicate: no model call (data-model "claims").
  const existing = await findSlugBySourceTweet(db, input.sourceTweetId);
  if (existing) return duplicate(existing, input);

  const costs: CallCost[] = [];
  const { decision, modelId, selfConfidence, slug, reply } = await recordingCostsOnFailure(db, null, costs, async () => {
    const evaluated = await evaluateClaimText(deps, input.text, input.now, costs);
    const newSlugValue = await newSlug(async (candidate) => (await db.select({ id: claims.id }).from(claims).where(eq(claims.slug, candidate)).limit(1)).length > 0);
    return { ...evaluated, slug: newSlugValue, reply: await replyFor(deps, evaluated.decision, newSlugValue, input.text, input.now, costs) };
  });

  const inserted = await db.transaction(async (tx) => {
    const row = claimRow(decision, slug, input, modelId, selfConfidence);
    const [claim] = await tx.insert(claims).values(row).onConflictDoNothing({ target: claims.sourceTweetId }).returning({ id: claims.id });
    if (!claim) return null;
    await tx.insert(positions).values({ claimId: claim.id, xUserId: input.authorId, stance: 'agree', isAuthor: true });
    await recordCosts(tx, costs.map((cost) => ({ ...cost, claimId: claim.id })));
    return claim;
  });

  // Lost a concurrent race for the same post (FR-003a): the other summon's claim stands.
  if (!inserted) {
    await recordCosts(db, costs.map((cost) => ({ ...cost, claimId: null })));
    const winner = await findSlugBySourceTweet(db, input.sourceTweetId);
    return duplicate(winner ?? slug, input);
  }

  log('info', 'claim submitted', {
    event: 'claim.submitted', claim_id: inserted.id, slug, outcome: decision.outcome,
    reason: decision.outcome === 'rejected' ? decision.reason : undefined,
    model: modelId, usd_cost: sumUsd(costs), reply_chars: reply.length,
  });
  return { outcome: decision.outcome, slug, reply, ...(decision.outcome === 'rejected' ? { rejectReason: decision.reason } : {}) };
}

export type AmendInput = { slug: string; authorId: string; text: string; now: Date };
// `ignored` (someone other than the author): no reply at all (FR-010).
export type AmendResult =
  | { outcome: 'recorded' | 'amended' | 'still_needs_info' | 'not_changed' | 'refused'; reply: string }
  | { outcome: 'ignored'; reply: null };

export const MAX_AMENDS = 2;

// The author's reply under a bot reply = a fix (FR-010): from needs info it doesn't count; from draft
// (before lock) it counts, max 2; a failed fix never counts.
export async function amendClaim(deps: ClaimDeps & { reader: SourceReader }, input: AmendInput): Promise<AmendResult> {
  const { db } = deps;
  const [claim] = await db.select().from(claims).where(eq(claims.slug, input.slug)).limit(1);
  if (!claim) throw new Error(`no claim ${input.slug}`);
  if (claim.authorXUserId !== input.authorId) {
    log('info', 'reply from someone else ignored', { event: 'claim.amend_ignored', claim_id: claim.id });
    return { outcome: 'ignored', reply: null };
  }
  if (claim.status === 'draft') return amendDraft(deps, claim, input);
  if (claim.status !== 'needs_info') {
    return refused(claim, REACHED_LOCK.has(claim.status) ? 'locked' : 'closed');
  }
  // Past the 24 h window it is expired even if the expiry job has not run yet (FR-011).
  if (claim.needsInfoSince && input.now.getTime() - claim.needsInfoSince.getTime() >= NEEDS_INFO_WINDOW_MS) {
    return refused(claim, 'expired');
  }

  const costs: CallCost[] = [];
  const { decision, modelId, selfConfidence } = await recordingCostsOnFailure(db, claim.id, costs, () => evaluateClaimText(deps, input.text, input.now, costs));

  if (decision.outcome !== 'recorded') {
    const why = decision.outcome === 'rejected' ? rejectReasonWords(decision.reason) : decision.explanation;
    await db.transaction(async (tx) => {
      if (decision.outcome === 'needs_info') {
        await tx.update(claims).set({ unclear: decision.unclear }).where(and(eq(claims.id, claim.id), eq(claims.status, 'needs_info')));
      }
      await recordCosts(tx, costs.map((cost) => ({ ...cost, claimId: claim.id })));
    });
    log('info', 'amend still unclear', { event: 'claim.amend_unclear', claim_id: claim.id, slug: claim.slug, usd_cost: sumUsd(costs) });
    return { outcome: 'still_needs_info', reply: stillNotRecordedReply(why) };
  }

  // Record the tweet version the amend applies to, so an earlier edit is not replayed at lock.
  // The reply is built before any write: a fix is never saved with a reply that can't be posted.
  const { reply, versionId } = await recordingCostsOnFailure(db, claim.id, costs, async () => ({
    reply: recordedReply(claim.slug, renderStatement(decision.contract)),
    versionId: (await deps.reader.readVersion(claim.sourceTweetId)).versionId,
  }));
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(claims).set({
      status: 'draft',
      contract: decision.contract,
      resolutionMethod: decision.contract.resolution_method,
      deadlineAt: new Date(decision.contract.deadline_at),
      lockAt: new Date(input.now.getTime() + LOCK_DELAY_MS),
      sourceVersion: versionId,
      unclear: null,
      contractModelId: modelId,
      selfConfidence,
    }).where(and(eq(claims.id, claim.id), eq(claims.status, 'needs_info'))).returning({ id: claims.id });
    await recordCosts(tx, costs.map((cost) => ({ ...cost, claimId: claim.id })));
    return rows.length > 0;
  });
  if (!updated) return refused(claim, 'conflict');

  log('info', 'claim amended', { event: 'claim.amended', claim_id: claim.id, slug: claim.slug, from: 'needs_info', usd_cost: sumUsd(costs) });
  return { outcome: 'recorded', reply };
}

async function amendDraft(deps: ClaimDeps & { reader: SourceReader }, claim: ClaimRow, input: AmendInput): Promise<AmendResult> {
  // The claim IS locked at lock_at, even before the job flips the status (data-model claims.lock_at).
  if (!claim.lockAt || input.now.getTime() >= claim.lockAt.getTime()) return refused(claim, 'locked');
  if (claim.amendCount >= MAX_AMENDS) return refused(claim, 'limit');

  const costs: CallCost[] = [];
  const { decision, modelId, selfConfidence } = await recordingCostsOnFailure(deps.db, claim.id, costs, () => evaluateClaimText(deps, input.text, input.now, costs));
  if (decision.outcome !== 'recorded') {
    await recordCosts(deps.db, costs.map((cost) => ({ ...cost, claimId: claim.id })));
    const why = decision.outcome === 'rejected' ? rejectReasonWords(decision.reason) : decision.explanation;
    log('info', 'fix not applied', { event: 'claim.amend_failed', claim_id: claim.id, slug: claim.slug, usd_cost: sumUsd(costs) });
    return { outcome: 'not_changed', reply: notChangedReply(claim.slug, why) };
  }

  // The version the fix applies to, so an earlier edit of the post is not replayed at lock.
  const { reply, versionId } = await recordingCostsOnFailure(deps.db, claim.id, costs, async () => ({
    reply: amendedReply(claim.slug, renderStatement(decision.contract), MAX_AMENDS - claim.amendCount - 1), // before any write
    versionId: (await deps.reader.readVersion(claim.sourceTweetId)).versionId,
  }));
  const applied = await replaceDraftContract(deps.db, claim, { contract: decision.contract, modelId, selfConfidence, versionId, now: input.now, costs, lockNotReached: true });
  if (!applied) return refused(claim, 'conflict');
  return { outcome: 'amended', reply };
}

// A fix or an edit found at lock: new contract, +1 fix, lock restarts. 0 rows (a concurrent change won, or
// `lockNotReached` and lock_at passed) → nothing happened.
export async function replaceDraftContract(
  db: Db,
  claim: ClaimRow,
  fix: { contract: Contract; modelId: string; selfConfidence: number | null; versionId: string; now: Date; costs: CallCost[]; lockNotReached: boolean },
): Promise<boolean> {
  const applied = await db.transaction(async (tx) => {
    const rows = await tx.update(claims).set({
      contract: fix.contract,
      resolutionMethod: fix.contract.resolution_method,
      deadlineAt: new Date(fix.contract.deadline_at),
      lockAt: new Date(fix.now.getTime() + LOCK_DELAY_MS),
      sourceVersion: fix.versionId,
      amendCount: claim.amendCount + 1,
      contractModelId: fix.modelId,
      selfConfidence: fix.selfConfidence,
    }).where(and(
      eq(claims.id, claim.id), eq(claims.status, 'draft'), eq(claims.amendCount, claim.amendCount),
      ...(fix.lockNotReached ? [gt(claims.lockAt, fix.now)] : []),
    )).returning({ id: claims.id });
    await recordCosts(tx, fix.costs.map((cost) => ({ ...cost, claimId: claim.id })));
    return rows.length > 0;
  });
  if (applied) log('info', 'claim amended', { event: 'claim.amended', claim_id: claim.id, slug: claim.slug, from: 'draft', amend_count: claim.amendCount + 1, usd_cost: sumUsd(fix.costs) });
  return applied;
}

// FR-004: a price contract is recorded only if the feed answers for the asset. Outage → throws (retry later).
async function confirmPriceFeed(coinbase: Coinbase, contract: Contract, proposal: Proposal): Promise<Decision> {
  if (contract.resolution_method !== 'price_feed' || !contract.price) return { outcome: 'recorded', contract };
  const status = await coinbase.productStatus(contract.price.product_id);
  if (status === 'online') return { outcome: 'recorded', contract };
  const explanation = `Coinbase has no active ${contract.price.product_id} market to read the daily close from.`;
  return { outcome: 'needs_info', unclear: ['subject'], explanation, proposal: { ...proposal, examples: [] } };
}

function claimRow(decision: Decision, slug: string, input: SubmitInput, modelId: string, selfConfidence: number | null): typeof claims.$inferInsert {
  const base = {
    slug,
    sourceTweetId: input.sourceTweetId,
    summonTweetId: input.summonTweetId,
    sourceVersion: input.sourceVersion,
    authorXUserId: input.authorId,
    contractModelId: modelId,
    selfConfidence,
  };
  if (decision.outcome === 'recorded') {
    return {
      ...base,
      status: 'draft',
      contract: decision.contract,
      resolutionMethod: decision.contract.resolution_method,
      deadlineAt: new Date(decision.contract.deadline_at),
      lockAt: new Date(input.now.getTime() + LOCK_DELAY_MS),
    };
  }
  if (decision.outcome === 'needs_info') {
    return { ...base, status: 'needs_info', unclear: decision.unclear, needsInfoSince: input.now };
  }
  return { ...base, status: 'rejected', rejectReason: decision.reason };
}

// NEEDS INFO replies carry only examples that passed the checks (FR-008); their calls join `costs`.
async function replyFor(deps: ClaimDeps, decision: Decision, slug: string, text: string, now: Date, costs: CallCost[]): Promise<string> {
  if (decision.outcome === 'recorded') return recordedReply(slug, renderStatement(decision.contract));
  if (decision.outcome === 'rejected') return rejectedReply(decision.reason);
  const built = await buildNeedsInfoReply(deps, { text, proposal: decision.proposal, explanation: decision.explanation, now });
  costs.push(...built.costs);
  return built.reply;
}

async function findSlugBySourceTweet(db: Db, sourceTweetId: string): Promise<string | undefined> {
  const [row] = await db.select({ slug: claims.slug }).from(claims).where(eq(claims.sourceTweetId, sourceTweetId)).limit(1);
  return row?.slug;
}

function duplicate(slug: string, input: SubmitInput): SubmitResult {
  log('info', 'duplicate summon', { event: 'claim.duplicate', slug, source_tweet_id: input.sourceTweetId });
  return { outcome: 'duplicate', slug, rejectReason: 'duplicate', reply: alreadyRecordedReply(slug) };
}

function refused(claim: ClaimRow, reason: RefusalReason): AmendResult {
  log('info', 'amend refused', { event: 'claim.amend_refused', claim_id: claim.id, reason });
  return { outcome: 'refused', reply: refusedReply(reason, claim.slug) };
}

const sumUsd = (costs: CallCost[]) => costs.reduce((sum, c) => sum + c.usdCost, 0);
