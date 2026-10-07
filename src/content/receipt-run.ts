// Receipts (spec 002 US3): the bot quote-posts its own verdict reply on the main feed, so the profile
// shows the product working. Our text is the verdict line only — no tags, no links, nothing of the
// author's words (constitution V, VI 2.4.0). At most two a day, never the same verdict twice.
import { and, desc, eq, gt, isNotNull, notExists } from 'drizzle-orm';
import { claims, evidences, feedPosts, optOuts, resolutions } from '../db/schema.js';
import { log } from '../log.js';
import { captureError } from '../observe.js';
import type { OriginalDeps } from './original-run.js';
import { HAND_RUN_SLOTS, type RunOptions } from './pool-run.js';
import { FEED_CAPS, markPosted, recordPostFailure, reserveSlot, utcDay } from './slots.js';
import { hasTagsOrLinks, weightedLength, X_MAX_CHARS } from '../replies/templates.js';
import { overSpendCap, recordFeedPost } from './spend.js';
import { X_POST_CREATE_USD } from '../x/prices.js';

const RECENT_MS = 7 * 24 * 3_600_000; // an old verdict is not news; receipts follow the live feed

export type ReceiptDeps = OriginalDeps;

export async function runReceipts(deps: ReceiptDeps, now: Date, options: RunOptions = {}): Promise<{ posted: number }> {
  if (!options.force && await overSpendCap(deps, now)) return { posted: 0 };
  const since = new Date(now.getTime() - RECENT_MS);
  const due = await deps.db
    .select({
      slug: claims.slug, authorId: claims.authorXUserId, replyId: claims.verdictReplyTweetId,
      outcome: resolutions.outcome, result: evidences.resultSummary,
    })
    .from(claims)
    .innerJoin(resolutions, eq(resolutions.claimId, claims.id))
    // The deciding evidence carries the outcome in the judge's own words — a final score, a close price.
    .leftJoin(evidences, eq(evidences.id, resolutions.decidingEvidenceId))
    .where(and(
      isNotNull(claims.verdictReplyTweetId),
      gt(claims.verdictReplyAt, since),
      eq(resolutions.reviewStatus, 'final'),
      isNotNull(resolutions.outcome),
      // The author's STOP covers the feed too: no receipt for their claim (constitution IV).
      notExists(deps.db.select({ id: optOuts.xUserId }).from(optOuts).where(eq(optOuts.xUserId, claims.authorXUserId))),
      // Verdicts we have already quoted (or tried to) are out of the running: without this, two old
      // verdicts would be picked again every run and a fresh verdict would never get its receipt.
      notExists(deps.db.select({ id: feedPosts.id }).from(feedPosts).where(eq(feedPosts.sourcePostId, claims.verdictReplyTweetId))),
    ))
    .orderBy(desc(claims.verdictReplyAt)) // newest verdict first: a receipt is only interesting while fresh
    .limit(FEED_CAPS.receipt);

  let posted = 0;
  for (const claim of due) {
    // `#slug` is the house style, in replies and here (owner decision 2026-10-06): the one hashtag an
    // own-feed post may carry, because it is the claim's own id and nothing else. A match shows its
    // score, a price its close — the number is the point of a receipt.
    const result = (claim.result ?? '').trim();
    const line = `RECEIPT · ${claim.outcome!.toUpperCase()} · #${claim.slug}`;
    // The slug's "#" is ours and intended; the judge's words are checked for anything else (a handle,
    // a link, another hashtag) and dropped whole if they carry it or make the post too long.
    const withResult = `${line} · ${result}`;
    const text = result && !hasTagsOrLinks(result) && weightedLength(withResult) <= X_MAX_CHARS ? withResult : line;
    const day = utcDay(now);
    if (deps.dryRun) {
      log('info', 'feed dry run: would post a receipt', { event: 'feed.dry_run_receipt', slug: claim.slug, text });
      continue;
    }
    // The verdict reply is the source: one receipt per verdict, whatever happens next.
    const slot = await reserveSlot(deps.db, { kind: 'receipt', day, sourcePostId: claim.replyId! }, options.force ? HAND_RUN_SLOTS : 0);
    if (!slot) continue; // already posted, or both of today's receipt slots are used

    try {
      const quote = await deps.quotePost(claim.replyId!, text);
      await markPosted(deps.db, slot.id, quote.id);
      await recordFeedPost(deps, X_POST_CREATE_USD);
      posted += 1;
      log('info', 'receipt posted', { event: 'feed.receipt_posted', slug: claim.slug, outcome: claim.outcome, posted_id: quote.id });
    } catch (error) {
      await recordPostFailure(deps.db, slot.id, error); // never sent: this verdict keeps its receipt
      captureError(error, { event: 'feed.receipt_failed', slug: claim.slug });
    }
  }
  return { posted };
}
