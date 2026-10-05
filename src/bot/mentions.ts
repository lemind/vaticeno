// X intake (Stage 1): each new mention of the bot becomes one engine call and at most one reply, in the same
// thread (constitution IV). Mention and post text live in memory only — logs and DB get ids and lengths.
import { arrayContains, desc, eq, or, sql } from 'drizzle-orm';
import { claims, optOuts } from '../db/schema.js';
import { readIngestState, writeIngestState, type IngestState } from '../ingest/state.js';
import { amendClaim, type ClaimDeps, submitClaim } from '../lifecycle/claims.js';
import type { SourceReader } from '../lifecycle/source-reader.js';
import { log } from '../log.js';
import { resolveCommand } from './commands.js';
import { type ExtrasDeps, quoteReply, selfpromoReply } from './extras.js';
import { alert, captureError } from '../observe.js';
import { HELP_REPLY, STOPPED_REPLY, THIRD_PARTY_REPLY } from '../replies/templates.js';
import { type Mention, XApiError, type XClient } from '../x/client.js';

export type BotDeps = ExtrasDeps & {
  x: XClient;
  reader: SourceReader;
  botUserId: string;
  postReply: (inReplyToTweetId: string, text: string) => Promise<{ id: string }>;
  allowAuthor: (authorId: string) => boolean; // pre-launch gate: REPLY_ALLOWLIST_USER_IDS ('*' = anyone)
  caps: { perAuthorPerHour: number; perDay: number };
  statePath?: string;
};

type Routed = { action: string; reply: string | null; slug?: string | null; deferQuote?: boolean }; // slug: the claim this mention belongs to

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const FIRST_RUN_PAGE_SIZE = 10; // no cursor yet: only recent mentions, keep the first bill small
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const REPLIED_IDS_KEPT = 1000;
const MAX_ATTEMPTS = 3;
// A quote is always answered: if Wikiquote is down, retry after 1, 5, 30 and 120 minutes, then give up with an alert.
const QUOTE_RETRY_MINUTES = [1, 5, 30, 120]; // polls a failing mention is retried before it is skipped with an alert
// A mention that only points at the post above ("this", "👆", nothing) means that post is the prediction.
const POINTS_AT_PARENT = /^(this|that|it|this one|that one|above|here|[^\p{L}\p{N}]*)$/iu;

// What one mention means and what the bot answers (null = say nothing).
export async function routeMention(deps: BotDeps, mention: Mention, now: Date): Promise<Routed> {
  if (mention.author_id === deps.botUserId) return { action: 'ignored_self', reply: null };
  if (mention.referenced_tweets?.some((ref) => ref.type === 'retweeted')) return { action: 'ignored_repost', reply: null };

  const body = mention.text.replace(/@\w+/g, ' ').replace(/\s+/g, ' ').trim();
  const command = resolveCommand(body); // closed set, matched in code: no model call
  if (command === 'stop') {
    await deps.db.insert(optOuts).values({ xUserId: mention.author_id }).onConflictDoNothing();
    return { action: 'stop', reply: STOPPED_REPLY };
  }
  // Tagging the bot again after STOP resumes (owner decision 2026-09-30, constitution IV).
  await deps.db.delete(optOuts).where(eq(optOuts.xUserId, mention.author_id));
  if (command === 'help') return { action: 'help', reply: HELP_REPLY };
  if (command === 'selfpromo') return { action: 'selfpromo', reply: await selfpromoReply(deps) };
  if (command === 'quote') {
    const quote = await quoteReply(deps);
    return quote ? { action: 'quote', reply: quote } : { action: 'quote_deferred', reply: null, deferQuote: true };
  }
  // HACK(x): SPECULATIVE (carried from the POC) — X rejects a post identical to a recent one, so pong carries the time. See src/poc/poll.ts.
  // REVISIT: if a repeated pong without the time is ever accepted.
  if (command === 'ping') return { action: 'ping', reply: `pong · ${now.toISOString().slice(11, 19)} UTC` };
  const repliedTo = mention.referenced_tweets?.find((ref) => ref.type === 'replied_to')?.id;

  // A reply in a claim's thread is the author's fix (FR-010, no keyword); anyone else is ignored, and a closed
  // claim gets the refusal — no model call either way.
  const claim = body ? await claimInThread(deps, mention, repliedTo) : null;
  if (claim) {
    const fixed = await amendClaim({ ...deps, reader: deps.reader }, { slug: claim.slug, authorId: mention.author_id, text: body, now });
    return { action: `fix_${fixed.outcome}`, reply: fixed.reply, slug: claim.slug };
  }

  // Empty mention (or "this") under a post: that post is the prediction — only if it is the summoner's own.
  if (POINTS_AT_PARENT.test(body.replace(/[.!?]+$/, ''))) {
    if (!repliedTo) return { action: 'help', reply: HELP_REPLY };
    if (mention.in_reply_to_user_id !== mention.author_id) return { action: 'third_party', reply: THIRD_PARTY_REPLY };
    const post = await deps.reader.readVersion(repliedTo);
    const result = await submitClaim(deps, {
      text: post.text, authorId: mention.author_id, sourceTweetId: repliedTo, summonTweetId: mention.id, sourceVersion: post.versionId, now,
    });
    return { action: `record_parent_${result.outcome}`, reply: result.reply, slug: result.slug };
  }

  // Otherwise the mention itself is the prediction (or "help", or not a prediction → help reply).
  const result = await submitClaim(deps, {
    text: body, authorId: mention.author_id, sourceTweetId: mention.id, summonTweetId: mention.id, sourceVersion: mention.id, now,
  });
  return { action: `record_inline_${result.outcome}`, reply: result.reply, slug: result.slug };
}

// The claim whose thread the mention replies into: its parent is the claim's post, the summon, a fix or a bot
// reply. Only the direct parent counts; the conversation root can be an older, unrelated post.
async function claimInThread(deps: BotDeps, mention: Mention, repliedTo: string | undefined) {
  if (!repliedTo) return null;
  const [claim] = await deps.db.select({ slug: claims.slug, sourceTweetId: claims.sourceTweetId, summonTweetId: claims.summonTweetId }).from(claims)
    .where(or(eq(claims.sourceTweetId, repliedTo), eq(claims.summonTweetId, repliedTo), arrayContains(claims.threadTweetIds, [repliedTo])))
    // An open claim wins over a closed one sharing the post (a fix mistaken for a new claim before T094).
    .orderBy(sql`${claims.status} in ('needs_info', 'draft') desc`, desc(claims.createdAt)).limit(1);
  // The summon itself (re-read after a crash) is not a fix of its own claim.
  if (!claim || claim.sourceTweetId === mention.id || claim.summonTweetId === mention.id) return null;
  return claim;
}

// One poll: new mentions oldest first, each routed and answered once. The cursor only moves past mentions
// that were handled, so a model or feed outage retries the rest on the next poll instead of losing them.
export async function pollMentions(deps: BotDeps, now: Date): Promise<{ mentions: number; replies: number }> {
  const state = await readIngestState(deps.statePath);
  const mentions = await fetchNewMentions(deps, state.mentions_since_id);
  let replies = 0;
  for (const mention of mentions) {
    const cap = capHit(deps, state, mention.author_id, now);
    if (!deps.allowAuthor(mention.author_id)) {
      log('info', 'mention from an author outside the allowlist; skipped', { event: 'mention.skipped', tweet_id: mention.id });
    } else if (state.replied_tweet_ids.includes(mention.id)) {
      // already answered (or a post was attempted): never again
    } else if (cap) {
      alert('reply.cap_reached', { tweet_id: mention.id, cap }); // before routing: nothing recorded without a reply
    } else {
      let routed: Routed;
      try {
        routed = await routeMention(deps, mention, now);
      } catch (error) {
        const attempts = state.failing?.tweet_id === mention.id ? state.failing.attempts + 1 : 1;
        captureError(error, { event: 'mention.failed', tweet_id: mention.id, attempts });
        if (attempts < MAX_ATTEMPTS) {
          state.failing = { tweet_id: mention.id, attempts };
          await writeIngestState(state, deps.statePath);
          break; // cursor stays before this mention: retried next poll
        }
        alert('mention.given_up', { tweet_id: mention.id, attempts }); // a mention that always fails must not block the rest
        routed = { action: 'given_up', reply: null };
      }
      log('info', 'mention handled', { event: 'mention.handled', tweet_id: mention.id, author_id: mention.author_id, action: routed.action, text_chars: mention.text.length });
      if (routed.deferQuote) state.pending_quotes.push({ tweet_id: mention.id, author_id: mention.author_id, attempts: 0, next_at: inMinutes(now, QUOTE_RETRY_MINUTES[0]!) });
      const replyId = routed.reply ? await sendReply(deps, state, mention, routed.reply, now) : null;
      if (replyId) replies++;
      if (routed.slug && replyId) await rememberThread(deps, routed.slug, [mention.id, replyId]); // only threads the bot answered in
    }
    state.failing = undefined;
    state.mentions_since_id = mention.id;
    state.last_successful_poll_at = now.toISOString();
    await writeIngestState(state, deps.statePath); // persisted per mention: a crash never replays a handled one
  }
  // After this poll's mentions, so a STOP fetched just now is already recorded before a waiting quote posts.
  replies += await retryPendingQuotes(deps, state, now);
  if (mentions.length === 0) {
    state.last_successful_poll_at = now.toISOString(); // a quiet poll still proves X answered
    await writeIngestState(state, deps.statePath);
  }
  log('info', 'mentions poll', { event: 'mentions.polled', mentions: mentions.length, replies });
  return { mentions: mentions.length, replies };
}

async function retryPendingQuotes(deps: BotDeps, state: IngestState, now: Date): Promise<number> {
  let replies = 0;
  const waiting: IngestState['pending_quotes'] = [];
  for (const pending of state.pending_quotes) {
    if (state.replied_tweet_ids.includes(pending.tweet_id)) continue;
    if (Date.parse(pending.next_at) > now.getTime()) {
      waiting.push(pending);
      continue;
    }
    let stopped: unknown[];
    try {
      stopped = await deps.db.select({ id: optOuts.xUserId }).from(optOuts).where(eq(optOuts.xUserId, pending.author_id)).limit(1);
    } catch (error) {
      captureError(error, { event: 'quote.retry_failed', tweet_id: pending.tweet_id });
      waiting.push(pending); // the database blipped: keep it as is, try next poll
      continue;
    }
    if (stopped.length > 0) continue; // STOP after asking: the waiting quote is dropped
    if (capHit(deps, state, pending.author_id, now)) {
      waiting.push({ ...pending, next_at: inMinutes(now, QUOTE_RETRY_MINUTES[pending.attempts]!) }); // a cap is not a failed try
      continue;
    }
    const quote = await quoteReply(deps);
    if (quote) {
      if (await sendReply(deps, state, { id: pending.tweet_id, author_id: pending.author_id, text: '' }, quote, now)) replies++;
      continue;
    }
    const attempts = pending.attempts + 1;
    if (attempts >= QUOTE_RETRY_MINUTES.length) {
      alert('quote.given_up', { tweet_id: pending.tweet_id, attempts });
      continue;
    }
    waiting.push({ ...pending, attempts, next_at: inMinutes(now, QUOTE_RETRY_MINUTES[attempts]!) });
  }
  state.pending_quotes = waiting;
  await writeIngestState(state, deps.statePath);
  return replies;
}

const inMinutes = (now: Date, minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

// The posted reply's id, or null when nothing was posted. The mention is saved as answered BEFORE the post:
// a crash mid-post never replays it, and a failed post is never retried (INIT_SPEC §6.7).
async function sendReply(deps: BotDeps, state: IngestState, mention: Mention, text: string, now: Date): Promise<string | null> {
  state.replied_tweet_ids = [...state.replied_tweet_ids, mention.id].slice(-REPLIED_IDS_KEPT);
  state.reply_log = [...state.reply_log, { author_id: mention.author_id, at: now.toISOString() }];
  await writeIngestState(state, deps.statePath);
  try {
    const posted = await deps.postReply(mention.id, text);
    log('info', 'reply posted', { event: 'reply.posted', tweet_id: mention.id, reply_tweet_id: posted.id, reply_chars: text.length });
    return posted.id;
  } catch (error) {
    const detail = error instanceof XApiError ? { status: error.status } : {};
    captureError(error, { event: 'reply.failed', tweet_id: mention.id, ...detail });
    return null;
  }
}

// The mention and the bot's reply join the claim's thread, so a reply under either is a fix, however deep the
// thread is (the conversation root can be an older, unrelated post).
async function rememberThread(deps: BotDeps, slug: string, known: string[]) {
  try {
    await deps.db.update(claims)
      .set({ threadTweetIds: sql`array(select distinct unnest(${claims.threadTweetIds} || array[${sql.join(known.map((id) => sql`${id}`), sql`, `)}]::text[]))` })
      .where(eq(claims.slug, slug));
  } catch (error) {
    // Never thrown: the reply is already posted, and a throw here would replay the mention (INIT_SPEC §6.7).
    captureError(error, { event: 'thread.save_failed', slug });
  }
}

// Self-imposed caps (constitution IV): per author per hour, and per day overall.
function capHit(deps: BotDeps, state: IngestState, authorId: string, now: Date): 'per_author_hour' | 'per_day' | null {
  state.reply_log = state.reply_log.filter((entry) => now.getTime() - Date.parse(entry.at) < DAY_MS);
  if (state.reply_log.length >= deps.caps.perDay) return 'per_day';
  const lastHour = state.reply_log.filter((e) => e.author_id === authorId && now.getTime() - Date.parse(e.at) < HOUR_MS);
  return lastHour.length >= deps.caps.perAuthorPerHour ? 'per_author_hour' : null;
}

async function fetchNewMentions(deps: BotDeps, sinceId: string | undefined): Promise<Mention[]> {
  const mentions: Mention[] = [];
  let paginationToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await deps.x.getMentionsPage({ userId: deps.botUserId, sinceId, paginationToken, maxResults: sinceId ? PAGE_SIZE : FIRST_RUN_PAGE_SIZE });
    mentions.push(...(result.data ?? []));
    paginationToken = result.meta.next_token;
    if (!sinceId || !paginationToken) return mentions.reverse(); // oldest first
  }
  alert('mentions.page_limit', { pages: MAX_PAGES }); // older mentions in the gap are skipped
  return mentions.reverse(); // oldest first
}
