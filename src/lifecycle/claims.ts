// Claim services: take their dependencies and `now` as arguments (plan.md "Architecture").
import { and, eq } from 'drizzle-orm';
import { type RejectReason, runChecks } from '../contract/checks.js';
import type { Proposal, UnclearItem } from '../contract/proposal.js';
import { renderStatement } from '../contract/render.js';
import type { Contract } from '../contract/schema.js';
import { newSlug } from '../contract/slug.js';
import type { Db } from '../db/client.js';
import { recordCosts } from '../db/costs.js';
import { claims, positions } from '../db/schema.js';
import type { Coinbase } from '../feeds/coinbase.js';
import type { CallCost, LlmClient } from '../llm/client.js';
import { proposeContract } from '../llm/normalize.js';
import { log } from '../log.js';
import { buildNeedsInfoReply } from '../replies/needs-info.js';
import { NEEDS_INFO_WINDOW_MS } from './expire.js';
import { alreadyRecordedReply, assertReplyFits, recordedReply, rejectedReply, rejectReasonWords } from '../replies/templates.js';
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
  outcome: 'recorded' | 'needs_info' | 'rejected' | 'duplicate';
  slug: string;
  rejectReason?: RejectReason;
  reply: string;
};

type Decision =
  | { outcome: 'recorded'; contract: Contract }
  | { outcome: 'needs_info'; unclear: UnclearItem[]; explanation: string; proposal: Proposal | null }
  | { outcome: 'rejected'; reason: Exclude<RejectReason, 'duplicate'> };

type Evaluation = { decision: Decision; modelId: string; selfConfidence: number | null; costs: CallCost[] };

// Proposal → checks → price feed confirmation. Shared by submit and amend.
async function evaluate(deps: ClaimDeps, text: string, now: Date): Promise<Evaluation> {
  const proposed = await proposeContract(deps.llm, deps.normalizerModel, text, now.toISOString().slice(0, 10));
  const costs = [...proposed.costs];
  if (proposed.kind === 'malformed') {
    const explanation = "I couldn't turn this into a checkable prediction.";
    return { decision: { outcome: 'needs_info', unclear: [], explanation, proposal: null }, modelId: proposed.modelId, selfConfidence: null, costs };
  }
  const { proposal } = proposed;
  const checked = runChecks(proposal, now, { sourcePostClaimed: false });
  let decision: Decision;
  if (checked.outcome === 'rejected') decision = { outcome: 'rejected', reason: checked.reason as Exclude<RejectReason, 'duplicate'> };
  else if (checked.outcome === 'needs_info') decision = { outcome: 'needs_info', unclear: checked.unclear, explanation: proposal.unclear_explanation, proposal };
  else decision = await confirmPriceFeed(deps.coinbase, checked.contract, proposal);
  return { decision, modelId: proposed.modelId, selfConfidence: proposal.self_confidence, costs };
}

export async function submitClaim(deps: ClaimDeps, input: SubmitInput): Promise<SubmitResult> {
  const { db } = deps;

  // A re-summon of a claimed post is a cheap duplicate: no model call (data-model "claims").
  const existing = await findSlugBySourceTweet(db, input.sourceTweetId);
  if (existing) return duplicate(existing, input);

  const { decision, modelId, selfConfidence, costs } = await evaluate(deps, input.text, input.now);
  const slug = await newSlug(async (candidate) => (await db.select({ id: claims.id }).from(claims).where(eq(claims.slug, candidate)).limit(1)).length > 0);
  const reply = await replyFor(deps, decision, slug, input.text, input.now, costs);

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
export type AmendResult = { outcome: 'recorded' | 'still_needs_info' | 'refused'; reply: string };

// Amend from needs info (FR-010): a valid amend makes a draft and does NOT count against the limit.
// Amends of a draft (counted, max 2) arrive with US4 (tasks T063).
export async function amendClaim(deps: ClaimDeps & { reader: SourceReader }, input: AmendInput): Promise<AmendResult> {
  const { db } = deps;
  const [claim] = await db.select().from(claims).where(eq(claims.slug, input.slug)).limit(1);
  if (!claim) throw new Error(`no claim ${input.slug}`);
  if (claim.authorXUserId !== input.authorId) return refused(claim.id, 'not_author', 'Only the author can amend this prediction.');
  if (claim.status !== 'needs_info') {
    if (claim.status === 'draft') throw new Error('amending a draft arrives with US4 (tasks T063)');
    return refused(claim.id, 'not_amendable', `#${claim.slug} can no longer be amended.`);
  }
  // Past the 24 h window it is expired even if the expiry job has not run yet (FR-011).
  if (claim.needsInfoSince && input.now.getTime() - claim.needsInfoSince.getTime() >= NEEDS_INFO_WINDOW_MS) {
    return refused(claim.id, 'expired', `#${claim.slug} expired: no valid amend within 24 hours.`);
  }

  const { decision, modelId, selfConfidence, costs } = await evaluate(deps, input.text, input.now);

  if (decision.outcome !== 'recorded') {
    const why = decision.outcome === 'rejected' ? rejectReasonWords(decision.reason) : decision.explanation;
    await db.transaction(async (tx) => {
      if (decision.outcome === 'needs_info') {
        await tx.update(claims).set({ unclear: decision.unclear }).where(and(eq(claims.id, claim.id), eq(claims.status, 'needs_info')));
      }
      await recordCosts(tx, costs.map((cost) => ({ ...cost, claimId: claim.id })));
    });
    log('info', 'amend still unclear', { event: 'claim.amend_unclear', claim_id: claim.id, slug: claim.slug, usd_cost: sumUsd(costs) });
    return { outcome: 'still_needs_info', reply: assertReplyFits(`STILL NOT RECORDED — ${why.trim() || 'Something essential is still missing.'}\nReply with the prediction and a date.`) };
  }

  // Record the tweet version the amend applies to, so an earlier edit is not replayed at lock.
  const { versionId } = await deps.reader.readVersion(claim.sourceTweetId);
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
  if (!updated) return refused(claim.id, 'not_amendable', `#${claim.slug} changed meanwhile; nothing was amended.`);

  log('info', 'claim amended', { event: 'claim.amended', claim_id: claim.id, slug: claim.slug, from: 'needs_info', usd_cost: sumUsd(costs) });
  return { outcome: 'recorded', reply: recordedReply(claim.slug, renderStatement(decision.contract)) };
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

function refused(claimId: string, reason: string, reply: string): AmendResult {
  log('info', 'amend refused', { event: 'claim.amend_refused', claim_id: claimId, reason });
  return { outcome: 'refused', reply };
}

const sumUsd = (costs: CallCost[]) => costs.reduce((sum, c) => sum + c.usdCost, 0);
