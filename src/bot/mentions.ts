// X intake (Stage 1): each new mention of the bot becomes one engine call and at most one reply, in the same
// thread (constitution IV). Mention and post text live in memory only — logs and DB get ids and lengths.
import { and, arrayContains, desc, eq, or, sql } from 'drizzle-orm';
import { claims, optOuts } from '../db/schema.js';
import { readIngestState, writeIngestState, type IngestState } from '../ingest/state.js';
import { amendClaim, type ClaimDeps, submitClaim } from '../lifecycle/claims.js';
import type { SourceReader } from '../lifecycle/source-reader.js';
import { log } from '../log.js';
import { type Command, commandWordIn, resolveCommand } from './commands.js';
import { type Intent, type ThreadPost, classifyIntent } from '../llm/intent.js';
import { type CallCost, LlmSchemaError } from '../llm/client.js';
import { recordCosts } from '../db/costs.js';
import { type ExtrasDeps, quoteReply, selfpromoReply } from './extras.js';
import { logTopic, resolveQuoteTopic } from './quote-topic.js';
import { alert, captureError } from '../observe.js';
import { HELP_REPLY, hasTagsOrLinks, STOPPED_REPLY, THIRD_PARTY_REPLY, weightedLength, X_MAX_CHARS } from '../replies/templates.js';
import { type Mention, PostNotSent, XApiError, type XClient } from '../x/client.js';
import { X_POST_READ_USD } from '../x/prices.js';

export type BotDeps = ExtrasDeps & {
  x: XClient;
  reader: SourceReader;
  botUserId: string;
  postReply: (inReplyToTweetId: string, text: string) => Promise<{ id: string }>;
  allowAuthor: (authorId: string) => boolean; // pre-launch gate: REPLY_ALLOWLIST_USER_IDS ('*' = anyone)
  caps: { perAuthorPerHour: number; perDay: number };
  statePath?: string;
};

// slug: the claim this mention belongs to. quoteTopic: the page a deferred quote should try first, so a
// retry never pays the topic cascade again.
// `discloses` marks the one reply that shows the author a contract they have not seen: a new claim or an
// amended one. Only that reply's failure withholds the lock — a duplicate notice or a no-op fix must not
// un-show a claim the author already read (review 2026-10-07).
type Routed = { action: string; reply: string | null; slug?: string | null; discloses?: boolean; deferQuote?: boolean; quoteTopic?: string };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const FIRST_RUN_PAGE_SIZE = 10; // no cursor yet: only recent mentions, keep the first bill small
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const REPLIED_IDS_KEPT = 1000;
// Tries for one mention before it is dropped, and the pause before each retry: a transient model or
// network fault gets ~23 minutes to pass, not three (owner decision 2026-10-07).
const MENTION_RETRY_MINUTES = [1, 2, 5, 15];
// A quote is always answered: if Wikiquote is down, retry after 1, 5, 30 and 120 minutes, then give up with an alert.
const QUOTE_RETRY_MINUTES = [1, 5, 30, 120]; // polls a failing mention is retried before it is skipped with an alert
// A mention that only points at the post above ("this", "👆", nothing) means that post is the prediction.
const POINTS_AT_PARENT = /^(this|that|it|this one|that one|above|here|[^\p{L}\p{N}]*)$/iu;

// What one mention means and what the bot answers (null = say nothing).
export async function routeMention(deps: BotDeps, mention: Mention, now: Date): Promise<Routed> {
  if (mention.author_id === deps.botUserId) return { action: 'ignored_self', reply: null };
  if (mention.referenced_tweets?.some((ref) => ref.type === 'retweeted')) return { action: 'ignored_repost', reply: null };

  const body = mention.text.replace(/@\w+/g, ' ').replace(/\s+/g, ' ').trim();
  const command = resolveCommand(body); // a bare command, matched in code: no model call
  if (command) return runCommand(deps, mention, command, now);
  // Tagging the bot again after STOP resumes (owner decision 2026-09-30, constitution IV).
  await deps.db.delete(optOuts).where(eq(optOuts.xUserId, mention.author_id));
  const repliedTo = mention.referenced_tweets?.find((ref) => ref.type === 'replied_to')?.id;

  // A reply in a claim's thread is the author's fix (FR-010, no keyword); anyone else is ignored, and a closed
  // claim gets the refusal — no model call either way.
  const claim = body ? await claimInThread(deps, mention, repliedTo) : null;
  if (claim) {
    // What the claim already says is the context a fix needs, and it is free: it is ours, in the
    // database. The thread above is read only when that still leaves the fix unclear.
    const own = criterionOf(claim.contract);
    let fixed = await amendClaim({ ...deps, reader: deps.reader }, { slug: claim.slug, authorId: mention.author_id, text: body, now, context: own });
    if (fixed.outcome === 'still_needs_info' && repliedTo) {
      const context = [...(await threadAbove(deps, repliedTo)).map((post) => post.text), ...own];
      if (context.length > own.length) {
        fixed = await amendClaim({ ...deps, reader: deps.reader }, { slug: claim.slug, authorId: mention.author_id, text: body, now, context });
      }
    }
    // A claim that can no longer change (locked, closed, expired, out of fixes) does not end the
    // conversation: the author is predicting again, so the reply is recorded as a NEW claim further
    // down (owner decision 2026-10-05). Only a mid-flight conflict still gets the refusal.
    if (fixed.outcome !== 'refused' || fixed.reason === 'conflict') {
      return { action: `fix_${fixed.outcome}`, reply: fixed.reply, slug: claim.slug, discloses: fixed.outcome === 'amended' || fixed.outcome === 'recorded' };
    }
    log('info', 'closed claim: recording this reply as a new one', { event: 'claim.amend_to_new', slug: claim.slug, reason: fixed.reason });
  }

  // Empty mention (or "this") under a post: that post is the prediction — only if it is the summoner's own.
  if (POINTS_AT_PARENT.test(body.replace(/[.!?]+$/, ''))) {
    if (!repliedTo) return { action: 'help', reply: HELP_REPLY };
    if (mention.in_reply_to_user_id !== mention.author_id) return { action: 'third_party', reply: THIRD_PARTY_REPLY };
    const post = await deps.reader.readVersion(repliedTo);
    // The summon's own words are context for the parent post ("@vaticeno this, by next month").
    const result = await submitClaim(deps, {
      text: post.text, context: [body], authorId: mention.author_id, sourceTweetId: repliedTo, summonTweetId: mention.id, sourceVersion: post.versionId, now,
    });
    return { action: `record_parent_${result.outcome}`, reply: result.reply, slug: result.slug, discloses: result.outcome === 'recorded' };
  }

  // A command word with more text: the model decides, seeing the thread (a prediction goes on below).
  const firstAssessed = commandWordIn(body);
  if (firstAssessed) {
    const assessed = await assess(deps, mention, body, repliedTo, now);
    if (assessed) return assessed;
  }

  // Otherwise the mention itself is the prediction; if it isn't one, the model reads the thread and decides.
  // The version recorded is the post's current one: if it was edited before this poll, read that version,
  // or the lock job would take the earlier edit for a new one (a false fix or expiry).
  const latest = mention.edit_history_tweet_ids?.at(-1) ?? mention.id;
  const current = latest === mention.id ? { versionId: mention.id, text: body } : await currentVersion(deps, mention.id);
  // An edit of the mention gets a new id: the claim is keyed on the first version, so edits never record twice.
  const original = mention.edit_history_tweet_ids?.[0] ?? mention.id;
  // The posts above resolve "she", "it" and bare names; they are already paid for when this is a reply.
  const context = repliedTo ? (await threadAbove(deps, repliedTo)).map((post) => post.text) : [];
  const result = await submitClaim(deps, {
    text: current.text, context, authorId: mention.author_id, sourceTweetId: original, summonTweetId: mention.id, sourceVersion: current.versionId, now,
    moreContext: () => conversationBefore(deps, mention, context),
  });
  // Not a prediction: the model reads the thread — once per mention (a command word already had its turn).
  if (result.outcome === 'rejected' && result.rejectReason === 'not_prediction' && !firstAssessed) {
    const assessed = await assess(deps, mention, current.text, repliedTo, now, { predictionRuledOut: true });
    if (assessed) return assessed;
  }
  return { action: `record_inline_${result.outcome}`, reply: result.reply, slug: result.slug, discloses: result.outcome === 'recorded' };
}

async function currentVersion(deps: BotDeps, tweetId: string): Promise<{ versionId: string; text: string }> {
  const post = await deps.reader.readVersion(tweetId);
  return { versionId: post.versionId, text: post.text.replace(/@\w+/g, ' ').replace(/\s+/g, ' ').trim() };
}

async function runCommand(deps: BotDeps, mention: Mention, command: Command, now: Date): Promise<Routed> {
  if (command === 'stop') {
    await deps.db.insert(optOuts).values({ xUserId: mention.author_id }).onConflictDoNothing();
    return { action: 'stop', reply: STOPPED_REPLY };
  }
  await deps.db.delete(optOuts).where(eq(optOuts.xUserId, mention.author_id)); // tagging again resumes
  if (command === 'help') return { action: 'help', reply: HELP_REPLY };
  if (command === 'selfpromo') return { action: 'selfpromo', reply: await selfpromoReply(deps) };
  if (command === 'quote') {
    const repliedTo = mention.referenced_tweets?.find((ref) => ref.type === 'replied_to')?.id;
    // The posts above are read only if the request itself says nothing about a subject (spec 002 phase 7).
    const decided = await resolveQuoteTopic(deps, mention.text, readerAbove(deps, repliedTo));
    logTopic(mention.id, decided);
    const quote = await quoteReply(deps, decided.topic ?? undefined);
    return quote
      ? { action: `quote_${decided.step}`, reply: quote }
      : { action: 'quote_deferred', reply: null, deferQuote: true, quoteTopic: decided.topic ?? undefined };
  }
  // HACK(x): SPECULATIVE (carried from the POC) — X rejects a post identical to a recent one, so pong carries the time. See src/poc/poll.ts.
  // REVISIT: if a repeated pong without the time is ever accepted.
  return { action: 'ping', reply: `pong · ${now.toISOString().slice(11, 19)} UTC` };
}

const THREAD_DEPTH = 3; // posts above the mention shown to the model (paid X reads, in memory only)

// The model decides what an unclear mention wants, with the thread above it. null = go on with recording.
async function assess(deps: BotDeps, mention: Mention, body: string, repliedTo: string | undefined, now: Date, opts: { predictionRuledOut?: boolean } = {}): Promise<Routed | null> {
  const thread = await threadAbove(deps, repliedTo);
  let intent: Intent;
  let answer: string | null;
  try {
    const assessed = await classifyIntent(deps.llm, deps.normalizerModel, body, thread);
    ({ intent, answer } = assessed);
    await saveCosts(deps, assessed.costs);
  } catch (error) {
    if (!(error instanceof LlmSchemaError)) throw error; // an outage retries the mention
    await saveCosts(deps, error.costs);
    return opts.predictionRuledOut ? { action: 'help', reply: HELP_REPLY } : null;
  }
  log('info', 'mention assessed', { event: 'mention.assessed', tweet_id: mention.id, intent, thread_posts: thread.length });
  if (intent === 'prediction') return opts.predictionRuledOut ? { action: 'help', reply: HELP_REPLY } : null;
  if (intent === 'question') {
    const usable = answer && answer.length <= 200 && !hasTagsOrLinks(answer) && !echoes(answer, [body, ...thread.map((p) => p.text)]);
    return usable ? { action: 'answer', reply: answer } : { action: 'help', reply: HELP_REPLY };
  }
  // STOP only when typed as a command (resolveCommand): a model reading must never opt someone out.
  if (intent === 'stop') return { action: 'help', reply: HELP_REPLY };
  if (intent === 'other') return { action: 'help', reply: HELP_REPLY };
  return runCommand(deps, mention, intent, now);
}

async function saveCosts(deps: BotDeps, costs: CallCost[]) {
  try {
    await recordCosts(deps.db, costs.map((cost) => ({ ...cost, claimId: null })));
  } catch (error) {
    captureError(error, { event: 'assess.costs_failed' }); // never fails the reply
  }
}

// An answer that repeats 20+ characters of what users wrote is likely an injected "reply exactly …".
function echoes(answer: string, texts: string[]): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ');
  const a = norm(answer);
  return texts.some((text) => {
    const t = norm(text);
    for (let i = 0; i + 20 <= t.length; i += 5) if (a.includes(t.slice(i, i + 20))) return true;
    return false;
  });
}

// X bills per post returned, so the same post must never be fetched twice while one mention is handled
// (owner decision 2026-10-07). Three paths used to re-read the posts above: the intent check, the record
// that follows it, and the second look when the text turns out not to be a prediction. The cache lives
// for one mention only — the lock job reads the post again later, on purpose, to catch edits.
function cachedReads(deps: BotDeps): BotDeps {
  const posts = new Map<string, Promise<Awaited<ReturnType<XClient['getTweet']>>>>();
  const versions = new Map<string, Promise<Awaited<ReturnType<SourceReader['readVersion']>>>>();
  const once = <T>(cache: Map<string, Promise<T>>, key: string, read: () => Promise<T>): Promise<T> => {
    const held = cache.get(key);
    if (held) return held;
    const fresh = read();
    cache.set(key, fresh); // a rejection is cached too: a post we cannot read is not read again either
    // Counted where it is paid. UNRECONCILED: an edited post costs a second read inside the reader and is
    // counted here as one.
    void recordReads(deps, 1, 'thread.post_read');
    return fresh;
  };
  return {
    ...deps,
    x: { ...deps.x, getTweet: (id: string) => once(posts, id, () => deps.x.getTweet(id)) },
    reader: { ...deps.reader, readVersion: (id: string) => once(versions, id, () => deps.reader.readVersion(id)) },
  };
}

// What a person sees above the mention, which is not what walking the parents gives: on X an answer from
// another account sits beside the post, not above it (owner decision 2026-10-07 — a bot named the fight in
// a reply to the same parent, so the chain we walked never mentioned it). One conversation read, ~10 posts
// at X's smallest page, and only when the parents left the prediction unrecordable. Posts are kept in
// memory, never stored (INIT_SPEC §6.9).
async function conversationBefore(deps: BotDeps, mention: Mention, already: readonly string[]): Promise<readonly string[]> {
  // A post that starts its own conversation has nothing before it: the search would return the post
  // itself and bill us for it. Only a reply can have anything above or beside it.
  const isReply = mention.referenced_tweets?.some((ref) => ref.type === 'replied_to') ?? false;
  if (!mention.conversation_id || !isReply || mention.conversation_id === mention.id) return already;
  try {
    const posts = await deps.x.getConversation(mention.conversation_id);
    await recordReads(deps, posts.length, 'thread.conversation_read');
    // Every post of the conversation that came before, oldest first. Not a window of the last few: the
    // post that names the subject is often older than the chatter around it (the answer naming a fight
    // sat four posts back, behind our own refusal and an argument between strangers). They are all paid
    // for by the one read above, so keeping fewer buys nothing. Our own posts are not context.
    const before = posts
      .filter((post) => post.id !== mention.id && post.author_id !== deps.botUserId
        && (!post.created_at || !mention.created_at || post.created_at < mention.created_at))
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    log('info', 'conversation read for context', { event: 'thread.conversation_read', tweet_id: mention.id, posts: posts.length, used: before.length });
    return before.length > 0 ? before.map((post) => post.text) : already;
  } catch (error) {
    captureError(error, { event: 'thread.conversation_failed', tweet_id: mention.id });
    return already;
  }
}

async function threadAbove(deps: BotDeps, repliedTo: string | undefined, maxPosts = THREAD_DEPTH): Promise<ThreadPost[]> {
  return (await threadWalk(deps, repliedTo, maxPosts)).posts;
}

// The walk itself, which also hands back where it stopped: a later step can then read the next posts
// up without paying for the ones already read (each post read is billed).
async function threadWalk(deps: BotDeps, from: string | undefined, maxPosts: number): Promise<{ posts: ThreadPost[]; nextId: string | undefined }> {
  const posts: ThreadPost[] = [];
  let id = from;
  for (let depth = 0; id && depth < maxPosts; depth++) {
    try {
      const post = await deps.x.getTweet(id);
      posts.push({ from: post.author_id === deps.botUserId ? 'bot' : 'user', text: post.text });
      id = post.referenced_tweets?.find((ref) => ref.type === 'replied_to')?.id;
    } catch (error) {
      log('info', 'thread post unreadable', { event: 'thread.unreadable', error: String(error) });
      return { posts, nextId: undefined };
    }
  }
  return { posts, nextId: id };
}

// A reader for the topic cascade: asking for more posts reads only the ones not read yet.
function readerAbove(deps: BotDeps, repliedTo: string | undefined): (depth: number) => Promise<readonly string[]> {
  const posts: ThreadPost[] = [];
  let nextId = repliedTo;
  return async (depth) => {
    while (posts.length < depth && nextId) {
      const walked = await threadWalk(deps, nextId, depth - posts.length);
      posts.push(...walked.posts);
      nextId = walked.nextId;
      if (walked.posts.length === 0) break;
    }
    return posts.slice(0, depth).map((post) => post.text);
  };
}

// The claim whose thread the mention replies into: its parent is the claim's post, the summon, a fix or a bot
// reply. Only the direct parent counts; the conversation root can be an older, unrelated post.
// The claim's own criterion, when it has one: a needs-info claim has no contract yet.
function criterionOf(contract: unknown): string[] {
  const criterion = (contract as { criterion?: unknown } | null)?.criterion;
  return typeof criterion === 'string' && criterion.length > 0 ? [criterion] : [];
}

async function claimInThread(deps: BotDeps, mention: Mention, repliedTo: string | undefined) {
  if (!repliedTo) return null;
  const [claim] = await deps.db.select({ slug: claims.slug, sourceTweetId: claims.sourceTweetId, summonTweetId: claims.summonTweetId, contract: claims.contract }).from(claims)
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
    // Still inside the pause after a failed try: leave the cursor where it is and come back later.
    if (state.failing?.tweet_id === mention.id && state.failing.next_at && now < new Date(state.failing.next_at)) break;
    const cap = capHit(deps, state, mention.author_id, now);
    if (!deps.allowAuthor(mention.author_id)) {
      log('info', 'mention from an author outside the allowlist; skipped', { event: 'mention.skipped', tweet_id: mention.id });
    } else if (state.replied_tweet_ids.includes(mention.id) || state.replied_tweet_ids.includes(mention.edit_history_tweet_ids?.[0] ?? mention.id)) {
      // already answered (or a post was attempted), or an edit of an answered mention: never again
    } else if (cap) {
      alert('reply.cap_reached', { tweet_id: mention.id, cap }); // before routing: nothing recorded without a reply
    } else {
      let routed: Routed;
      try {
        routed = await routeMention(cachedReads(deps), mention, now);
      } catch (error) {
        const attempts = state.failing?.tweet_id === mention.id ? state.failing.attempts + 1 : 1;
        captureError(error, { event: 'mention.failed', tweet_id: mention.id, attempts });
        if (attempts < MENTION_RETRY_MINUTES.length + 1) {
          // The pause grows between tries: a model answering 503 "try again later" means later, not in
          // sixty seconds (owner decision 2026-10-07). Five tries over ~23 min, then the mention is dropped.
          state.failing = { tweet_id: mention.id, attempts, next_at: inMinutes(now, MENTION_RETRY_MINUTES[attempts - 1]!) };
          await writeIngestState(state, deps.statePath);
          break; // cursor stays before this mention: retried once the pause is over
        }
        alert('mention.given_up', { tweet_id: mention.id, attempts }); // a mention that always fails must not block the rest
        routed = { action: 'given_up', reply: null };
      }
      log('info', 'mention handled', { event: 'mention.handled', tweet_id: mention.id, author_id: mention.author_id, action: routed.action, text_chars: mention.text.length });
      if (routed.deferQuote) {
        state.pending_quotes.push({ tweet_id: mention.id, author_id: mention.author_id, attempts: 0, next_at: inMinutes(now, QUOTE_RETRY_MINUTES[0]!), topic: routed.quoteTopic });
      }
      const replyId = routed.reply ? await sendReply(deps, state, mention, routed.reply, now) : null;
      if (replyId) replies++;
      if (routed.slug && replyId) await rememberThread(deps, routed.slug, [mention.id, replyId]); // only threads the bot answered in
      else if (routed.slug && routed.discloses) await withholdLock(deps, routed.slug);
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
    // The topic was decided when the request came in: a retry re-reads Wikiquote, never X or the model.
    const quote = await quoteReply(deps, pending.topic);
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
    // The reply never left the machine (no usable token): the account is failing to post at all, so this
    // is an alert, not a log line. The claim's lock is withheld below, so nothing locks unseen.
    if (error instanceof PostNotSent) alert('reply.not_sent', { tweet_id: mention.id });
    const detail = error instanceof XApiError ? { status: error.status } : {};
    captureError(error, { event: 'reply.failed', tweet_id: mention.id, ...detail });
    return null;
  }
}

// The 15 minutes cannot start before the author can read the contract (INIT_SPEC §4, §6.6): a draft with
// no lock_at never locks, and `expireWithheldDrafts` closes it a day later.
async function withholdLock(deps: BotDeps, slug: string) {
  try {
    const held = await deps.db.update(claims).set({ lockAt: null })
      .where(and(eq(claims.slug, slug), eq(claims.status, 'draft')))
      .returning({ id: claims.id });
    if (held.length > 0) alert('claim.lock_withheld', { slug }); // the author is owed this reply: it needs a human
  } catch (error) {
    // Never thrown: the mention is already marked answered, and a throw here would replay it (INIT_SPEC §6.7).
    captureError(error, { event: 'claim.lock_withheld_failed', slug });
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
// Every X post this path reads is money (src/x/prices.ts). Before 2026-10-07 none of it was recorded:
// the mention poll and the posts read for context were spend nobody could see.
async function recordReads(deps: BotDeps, posts: number, event: string): Promise<void> {
  if (posts === 0) return;
  try {
    await recordCosts(deps.db, [{ provider: 'x', operation: 'thread_read', units: posts, usdCost: posts * X_POST_READ_USD, claimId: null }]);
  } catch (error) {
    captureError(error, { event: `${event}_costs_failed` }); // never fails the poll: the reads are already paid
  }
}

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
    await recordReads(deps, result.data?.length ?? 0, 'mentions.poll'); // a quiet poll returns nothing and costs nothing
    paginationToken = result.meta.next_token;
    if (!sinceId || !paginationToken) return mentions.reverse(); // oldest first
  }
  alert('mentions.page_limit', { pages: MAX_PAGES }); // older mentions in the gap are skipped
  return mentions.reverse(); // oldest first
}
