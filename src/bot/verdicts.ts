// Verdict replies on X (owner decision 2026-10-04, constitution VI 2.3.0): when a claim gets its final
// verdict, the bot replies once in the claim's thread, under the author's summon. Never retried.
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { ContractSchema } from '../contract/schema.js';
import { renderStatement } from '../contract/render.js';
import {
  claims,
  corrections,
  evidences,
  optOuts,
  resolutions,
} from '../db/schema.js';
import { log } from '../log.js';
import { alert, captureError } from '../observe.js';
import {
  assertReplyFits,
  hasTagsOrLinks,
  weightedLength,
  X_MAX_CHARS,
} from '../replies/templates.js';
import type { LockResult } from '../lifecycle/lock.js';
import { PostNotSent } from '../x/client.js';
import type { BotDeps } from './mentions.js';

const RECENT_MS = 7 * 24 * 3_600_000; // older verdicts (e.g. before this shipped) are not posted
const MAX_PER_RUN = 20;
const MAX_PER_DAY = 100;

export async function deliverVerdicts(
  deps: BotDeps,
  now: Date,
): Promise<{ posted: number }> {
  const since = new Date(now.getTime() - RECENT_MS);
  const due = await deps.db
    .select({
      id: claims.id,
      slug: claims.slug,
      summonTweetId: claims.summonTweetId,
      authorId: claims.authorXUserId,
      contract: claims.contract,
      outcome: resolutions.outcome,
      voidReason: resolutions.voidReason,
      decidedBy: resolutions.decidedBy,
      evidenceId: resolutions.decidingEvidenceId,
    })
    .from(claims)
    .innerJoin(resolutions, eq(resolutions.claimId, claims.id))
    .where(
      and(
        inArray(claims.status, ['resolved', 'void']),
        eq(resolutions.reviewStatus, 'final'),
        isNull(claims.verdictReplyAt),
        gt(resolutions.decidedAt, since),
      ),
    )
    .limit(MAX_PER_RUN);

  let posted = 0;
  const perAuthor = new Map<string, number>();
  for (const claim of due) {
    // Same gates as mention replies: the allowlist, and the per-author hourly cap within one run.
    const authorCount = perAuthor.get(claim.authorId) ?? 0;
    if (
      !deps.allowAuthor(claim.authorId) ||
      authorCount >= deps.caps.perAuthorPerHour
    )
      continue;
    const [counted] = await deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(claims)
      .where(gt(claims.verdictReplyAt, new Date(now.getTime() - 24 * 3_600_000)));
    if ((counted?.n ?? 0) >= MAX_PER_DAY) {
      alert('verdict.cap_reached', { cap: MAX_PER_DAY });
      break;
    }
    let text: string | null = null;
    try {
      const stopped = await deps.db
        .select({ id: optOuts.xUserId })
        .from(optOuts)
        .where(eq(optOuts.xUserId, claim.authorId))
        .limit(1);
      if (stopped.length === 0) text = await verdictText(deps, claim); // built before the mark: a bad text is retried next run
    } catch (error) {
      captureError(error, { event: 'verdict.text_failed', slug: claim.slug });
      continue;
    }
    // Marked before posting, guarded on "not yet": a crash or a failed post never sends a second verdict.
    const marked = await deps.db
      .update(claims)
      .set({ verdictReplyAt: now })
      .where(and(eq(claims.id, claim.id), isNull(claims.verdictReplyAt)))
      .returning({ id: claims.id });
    if (marked.length === 0) continue;
    if (!text) {
      log('info', 'verdict not posted: author sent STOP', {
        event: 'verdict.opted_out',
        slug: claim.slug,
      });
      continue;
    }
    perAuthor.set(claim.authorId, authorCount + 1);
    try {
      const reply = await deps.postReply(claim.summonTweetId, text);
      // The verdict joins the thread: a reply under it gets the closed-claim refusal, not a new claim.
      await deps.db
        .update(claims)
        .set({
          verdictReplyTweetId: reply.id,
          threadTweetIds: sql`array_append(${claims.threadTweetIds}, ${reply.id}::text)`,
        })
        .where(eq(claims.id, claim.id));
      log('info', 'verdict posted', {
        event: 'verdict.posted',
        slug: claim.slug,
        outcome: claim.outcome,
        reply_tweet_id: reply.id,
      });
      posted++;
    } catch (error) {
      if (error instanceof PostNotSent) {
        // Nothing reached X, so the mark comes off and the next run posts it. Without this a token or
        // permission fault loses the verdict for good — exactly what happened on 2026-10-07 at 00:05.
        await deps.db
          .update(claims)
          .set({ verdictReplyAt: null })
          .where(and(eq(claims.id, claim.id), isNull(claims.verdictReplyTweetId)));
        alert('verdict.not_sent', { slug: claim.slug }); // loud: the whole account is failing to post
        captureError(error, { event: 'verdict.not_sent', slug: claim.slug }); // and the cause, with its stack
        break; // the next claim would fail the same way
      }
      captureError(error, { event: 'verdict.failed', slug: claim.slug }); // not retried: it may have landed
    }
  }
  return { posted };
}

type Due = {
  slug: string;
  contract: unknown;
  outcome: string | null;
  voidReason: string | null;
  decidedBy: string | null;
  evidenceId: string | null;
};

async function verdictText(deps: BotDeps, claim: Due): Promise<string> {
  const contract = ContractSchema.parse(claim.contract);
  const head = `${(claim.outcome ?? 'void').toUpperCase()} · #${claim.slug}\n"${renderStatement(contract)}"`;
  if (claim.outcome === 'void') {
    const why =
      claim.voidReason === 'unresolvable'
        ? 'the subject no longer exists'
        : 'no source confirmed the result';
    return assertReplyFits(`${head}\nVoid: ${why}.`);
  }
  if (claim.decidedBy === 'human')
    return assertReplyFits(`${head}\nDecided on review.`);
  const [evidence] = claim.evidenceId
    ? await deps.db
        .select({
          source: evidences.sourceName,
          value: evidences.value,
          date: evidences.eventDate,
          result: evidences.resultSummary,
          basis: evidences.basis,
        })
        .from(evidences)
        .where(eq(evidences.id, claim.evidenceId))
        .limit(1)
    : [];
  if (!evidence) return assertReplyFits(head);
  if (contract.price && evidence.value !== null) {
    const quote = contract.price.product_id.split('-')[1];
    const amount = Number(evidence.value).toLocaleString('en-US', {
      maximumFractionDigits: 8,
    });
    return assertReplyFits(
      `${head}\nCoinbase daily close ${evidence.date}: ${quote === 'USD' ? `$${amount}` : `${amount} ${quote}`}`,
    );
  }
  // The site without its domain ending: X turns "nfl.com" into a link (ugly, and links cost extra).
  const site = siteLabel(evidence.source);
  if (evidence.result && !hasTagsOrLinks(evidence.result)) {
    const withResult = `${head}\n${evidence.result} · ${site}`;
    if (weightedLength(withResult) <= X_MAX_CHARS) return withResult;
  }
  // A record-based hit or miss with nothing to show is a judging defect, not a reply: the verdict still
  // goes out and we are told (FR-032). An absence-based miss has no outcome to report, so it is exempt.
  if (evidence.basis === 'record') {
    alert('verdict.no_result', {
      slug: claim.slug,
      outcome: claim.outcome,
      source: evidence.source,
      had_result: Boolean(evidence.result),
    });
  }
  return assertReplyFits(
    `${head}\nSource: ${site}${evidence.date ? ` (${evidence.date})` : ''}`,
  );
}

function siteLabel(domain: string): string {
  const name = domain.replace(/^www\./, '').split('.')[0] ?? domain;
  return name.length <= 4
    ? name.toUpperCase()
    : name.charAt(0).toUpperCase() + name.slice(1);
}

// An edit found at lock changed or expired the contract: the author is told once, in the claim's thread,
// through the same gates as other replies. The state change already happened once; a failed post is not retried.
const LOCK_REPLIES_PER_RUN = 20;

export async function postLockReplies(
  deps: BotDeps,
  results: LockResult[],
): Promise<void> {
  const perAuthor = new Map<string, number>();
  let posted = 0;
  for (const result of results) {
    if (
      !result.reply ||
      !result.summonTweetId ||
      !result.authorId ||
      !deps.allowAuthor(result.authorId)
    )
      continue;
    // Same self-imposed caps as other replies: per author per run, and per run overall.
    const authorCount = perAuthor.get(result.authorId) ?? 0;
    if (
      authorCount >= deps.caps.perAuthorPerHour ||
      posted >= LOCK_REPLIES_PER_RUN
    ) {
      alert('lock.reply_capped', { slug: result.slug });
      continue;
    }
    perAuthor.set(result.authorId, authorCount + 1);
    posted++;
    try {
      const stopped = await deps.db
        .select({ id: optOuts.xUserId })
        .from(optOuts)
        .where(eq(optOuts.xUserId, result.authorId))
        .limit(1);
      if (stopped.length > 0) continue;
      const reply = await deps.postReply(result.summonTweetId, result.reply);
      // Joins the claim's thread: a reply under [AMENDED] is a fix, under [EXPIRED] the closed-claim refusal.
      await deps.db
        .update(claims)
        .set({
          threadTweetIds: sql`array_append(${claims.threadTweetIds}, ${reply.id}::text)`,
        })
        .where(eq(claims.slug, result.slug));
      log('info', 'lock reply posted', {
        event: 'lock.reply_posted',
        slug: result.slug,
        outcome: result.outcome,
        reply_tweet_id: reply.id,
      });
    } catch (error) {
      captureError(error, { event: 'lock.reply_failed', slug: result.slug });
    }
  }
}

// A correction is told where the verdict was told: once, in the claim's thread, naming what it was and
// what it is (001 FR-035). Never retried — a correction that may have landed is not sent twice (§6.7).
export async function postCorrection(
  deps: BotDeps,
  slug: string,
  now = new Date(),
): Promise<{ posted: string | null }> {
  const [row] = await deps.db
    .select({
      claimId: claims.id,
      summon: claims.summonTweetId,
      authorId: claims.authorXUserId,
      contract: claims.contract,
      from: corrections.fromOutcome,
      to: corrections.toOutcome,
      reason: corrections.reason,
      sent: corrections.postedAt,
      evidenceId: corrections.decidingEvidenceId,
    })
    .from(corrections)
    .innerJoin(claims, eq(claims.id, corrections.claimId))
    .where(eq(claims.slug, slug))
    .limit(1);
  if (!row || row.sent) return { posted: null };
  const stopped = await deps.db
    .select({ id: optOuts.xUserId })
    .from(optOuts)
    .where(eq(optOuts.xUserId, row.authorId))
    .limit(1);
  if (stopped.length > 0 || !deps.allowAuthor(row.authorId)) return { posted: null };

  const contract = ContractSchema.parse(row.contract);
  const [evidence] = row.evidenceId
    ? await deps.db
        .select({
          source: evidences.sourceName,
          value: evidences.value,
          result: evidences.resultSummary,
        })
        .from(evidences)
        .where(eq(evidences.id, row.evidenceId))
        .limit(1)
    : [];
  const shown =
    evidence?.result && !hasTagsOrLinks(evidence.result)
      ? `\n${evidence.result}`
      : evidence?.value
        ? `\n${evidence.value}`
        : '';
  // The correction and the result, nothing else: the stored reason is for the claim page, not the reply
  // — it is written for us, so it runs long and may name an account (owner decision 2026-10-15).
  // The result line is dropped rather than overflow, the same way a verdict reply degrades (buildReply):
  // a correction must go out, and the claim page carries the detail.
  const head = `CORRECTED · #${slug}\n"${renderStatement(contract)}"\nWas ${row.from.toUpperCase()}, is ${row.to.toUpperCase()}`;
  const text =
    shown && weightedLength(head + shown) <= X_MAX_CHARS
      ? head + shown
      : assertReplyFits(head);

  // Marked before posting, guarded on "not yet": the same rule a verdict reply follows (deliverVerdicts).
  const marked = await deps.db
    .update(corrections)
    .set({ postedAt: now })
    .where(and(eq(corrections.claimId, row.claimId), isNull(corrections.postedAt)))
    .returning({ id: corrections.id });
  if (marked.length === 0) return { posted: null };
  try {
    const reply = await deps.postReply(row.summon, text);
    await deps.db
      .update(corrections)
      .set({ postedTweetId: reply.id })
      .where(eq(corrections.claimId, row.claimId));
    // The correction joins the claim's thread, so a reply under it arrives with the claim in hand.
    await deps.db
      .update(claims)
      .set({
        threadTweetIds: sql`array_append(${claims.threadTweetIds}, ${reply.id}::text)`,
      })
      .where(eq(claims.id, row.claimId));
    log('info', 'correction posted', {
      event: 'verdict.corrected_posted',
      slug,
      from: row.from,
      to: row.to,
      reply_tweet_id: reply.id,
    });
    return { posted: reply.id };
  } catch (error) {
    // Nothing reached X: the mark comes off and the command can be run again. Any other failure may have
    // landed, so the mark stays and it is never retried (§6.7).
    if (error instanceof PostNotSent) {
      await deps.db
        .update(corrections)
        .set({ postedAt: null })
        .where(
          and(
            eq(corrections.claimId, row.claimId),
            isNull(corrections.postedTweetId),
          ),
        );
    }
    captureError(error, { event: 'verdict.correction_failed', slug });
    return { posted: null };
  }
}
