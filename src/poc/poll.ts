// Stage 1 POC (INIT_SPEC §14): poll mentions, decide, log.
// Only `ping` gets a real reply, to REPLY_ALLOWLIST_USER_IDS ('*' = anyone); all else is log-only.
import { loadConfig } from '../config.js';
import { classifyMention, describeWouldReply, redactDecision } from '../ingest/classify.js';
import { readIngestState, writeIngestState, type IngestState } from '../ingest/state.js';
import { log } from '../log.js';
import { createXClient, postReply, XApiError, type Mention, type XClient, type XUser } from '../x/client.js';
import { getValidAccessToken, type OAuthClientCredentials } from '../x/oauth.js';

const FIRST_RUN_PAGE_SIZE = 10; // no cursor yet: look at recent mentions only, keep the first bill small
const PAGE_SIZE = 100;
const MAX_PAGES_PER_POLL = 5;
const GAP_ALERT_MS = 6 * 60 * 60 * 1000; // INIT_SPEC §6.1 gap detection
const REPLIED_IDS_KEPT = 500;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// systemd's RestartPreventExitStatus=78: a fatal config/auth error stops the service instead of crash-looping.
const EXIT_FATAL_CONFIG = 78;

const config = loadConfig();
if (!config.X_BOT_USER_ID) {
  throw new Error('X_BOT_USER_ID is missing. Run `npm run poc:whoami` first.');
}
const botUserId = config.X_BOT_USER_ID;
const xClient = createXClient(config.X_BEARER_TOKEN);
const replyAllowlist = new Set(config.REPLY_ALLOWLIST_USER_IDS);
const replyToAnyone = replyAllowlist.has('*'); // '*' = no allowlist, anyone who pings gets a pong
const oauthCreds: OAuthClientCredentials | null =
  config.X_OAUTH2_CLIENT_ID && config.X_OAUTH2_CLIENT_SECRET
    ? { clientId: config.X_OAUTH2_CLIENT_ID, clientSecret: config.X_OAUTH2_CLIENT_SECRET, redirectUri: config.X_OAUTH2_REDIRECT_URI }
    : null;

let stopping = false;
let wakeFromSleep: (() => void) | null = null;

// Ctrl-C locally, SIGINT/SIGTERM from systemd: finish the current poll, skip the sleep.
function requestStop(signal: string): void {
  if (stopping) process.exit(130);
  stopping = true;
  log('info', 'stopping after current poll', { signal });
  wakeFromSleep?.();
}
process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

function sleepUnlessStopped(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wakeFromSleep = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function fetchNewMentions(client: XClient, sinceId: string | undefined) {
  const mentions: Mention[] = [];
  const users = new Map<string, XUser>();
  let newestId: string | undefined;
  let paginationToken: string | undefined;

  for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
    const result = await client.getMentionsPage({
      userId: botUserId,
      sinceId,
      paginationToken,
      maxResults: sinceId ? PAGE_SIZE : FIRST_RUN_PAGE_SIZE,
    });
    newestId ??= result.meta.newest_id; // first page holds the newest mention
    mentions.push(...(result.data ?? []));
    for (const user of result.includes?.users ?? []) users.set(user.id, user);

    paginationToken = result.meta.next_token;
    if (!sinceId || !paginationToken) break;
  }
  if (paginationToken) log('warn', 'page cap hit; older mentions in this batch were skipped', { MAX_PAGES_PER_POLL });

  return { mentions: mentions.reverse(), users, newestId }; // process oldest first
}

async function pollOnce(): Promise<void> {
  const state = await readIngestState();

  if (state.last_successful_poll_at) {
    const gapMs = Date.now() - Date.parse(state.last_successful_poll_at);
    if (gapMs > GAP_ALERT_MS) {
      log('warn', 'gap_detected: mention history may have been lost', { gap_hours: Math.round(gapMs / 36e5) });
    }
  }

  const { mentions, users, newestId } = await fetchNewMentions(xClient, state.mentions_since_id);

  for (const mention of mentions) {
    const decision = classifyMention(mention, botUserId, config.X_BOT_HANDLE);
    log('info', 'mention', {
      tweet_id: mention.id,
      author_id: mention.author_id,
      author_handle: users.get(mention.author_id)?.username,
      text_chars: mention.text.length, // never the text itself: logs are persisted (INIT_SPEC §6.9)
      decision: redactDecision(decision),
      would_reply: describeWouldReply(decision),
    });
    if (decision.outcome === 'ping') await replyPong(mention, state);
  }

  await writeIngestState({
    ...state,
    mentions_since_id: newestId ?? state.mentions_since_id,
    last_successful_poll_at: new Date().toISOString(),
  });
  log('info', 'poll ok', { new_mentions: mentions.length, since_id: newestId ?? state.mentions_since_id });
}

async function replyPong(mention: Mention, state: IngestState): Promise<void> {
  if (!replyToAnyone && !replyAllowlist.has(mention.author_id)) {
    log('info', 'reply skipped: author not in allowlist', { tweet_id: mention.id });
    return;
  }
  if (state.replied_tweet_ids.includes(mention.id)) return; // one reply per interaction (§6.1)
  if (!oauthCreds) {
    log('warn', 'reply skipped: X_OAUTH2_CLIENT_ID/SECRET not set', { tweet_id: mention.id });
    return;
  }
  const capHit = findReplyCapHit(state, mention.author_id);
  if (capHit) {
    log('warn', 'reply skipped: rate cap reached', { tweet_id: mention.id, cap: capHit });
    return;
  }

  // Timestamp keeps each pong unique: X rejects identical repeated post text as a duplicate.
  const text = `pong · ${new Date().toISOString().slice(11, 19)} UTC`;
  try {
    const posted = await postReplyWithTokenRetry(oauthCreds, mention.id, text);
    state.replied_tweet_ids = [...state.replied_tweet_ids, mention.id].slice(-REPLIED_IDS_KEPT);
    state.reply_log = [...state.reply_log, { author_id: mention.author_id, at: new Date().toISOString() }];
    await writeIngestState(state); // persist before anything else can fail
    log('info', 'reply posted', { tweet_id: mention.id, reply_tweet_id: posted.id, text });
  } catch (error) {
    const detail = error instanceof XApiError ? { status: error.status, body: error.body.slice(0, 1000) } : { error: String(error) };
    log('error', 'reply failed (not retried)', { tweet_id: mention.id, ...detail });
  }
}

// Caps from INIT_SPEC §6.1; returns which cap blocks the reply, or null.
function findReplyCapHit(state: IngestState, authorId: string): 'per_author_hour' | 'per_day' | null {
  const now = Date.now();
  state.reply_log = state.reply_log.filter((entry) => now - Date.parse(entry.at) < DAY_MS);
  if (state.reply_log.length >= config.REPLY_MAX_PER_DAY) {
    log('error', 'daily reply cap reached: posting halted until the window rolls over', { cap: config.REPLY_MAX_PER_DAY });
    return 'per_day';
  }
  const authorLastHour = state.reply_log.filter((e) => e.author_id === authorId && now - Date.parse(e.at) < HOUR_MS);
  return authorLastHour.length >= config.REPLY_MAX_PER_AUTHOR_PER_HOUR ? 'per_author_hour' : null;
}

async function postReplyWithTokenRetry(creds: OAuthClientCredentials, inReplyToTweetId: string, text: string) {
  try {
    return await postReply(await getValidAccessToken(creds), inReplyToTweetId, text);
  } catch (error) {
    if (!(error instanceof XApiError) || error.status !== 401) throw error;
    log('warn', 'reply got 401; forcing token refresh and retrying once', { tweet_id: inReplyToTweetId });
    return await postReply(await getValidAccessToken(creds, { forceRefresh: true }), inReplyToTweetId, text);
  }
}

log('info', 'poller started', {
  bot_handle: config.X_BOT_HANDLE,
  bot_user_id: botUserId,
  interval_sec: config.POLL_INTERVAL_SEC,
  reply_allowlist: [...replyAllowlist],
  replies_possible: Boolean(oauthCreds) && replyAllowlist.size > 0,
  reply_caps: { per_author_hour: config.REPLY_MAX_PER_AUTHOR_PER_HOUR, per_day: config.REPLY_MAX_PER_DAY },
});

while (!stopping) {
  let waitMs = config.POLL_INTERVAL_SEC * 1000;
  try {
    await pollOnce();
  } catch (error) {
    if (error instanceof XApiError) {
      log('error', 'x api error', { status: error.status, body: error.body.slice(0, 1000) });
      if (error.status === 401 || error.status === 403) {
        log('error', 'fatal: bearer token or plan rejected; fix .env and restart the service');
        process.exit(EXIT_FATAL_CONFIG);
      }
      if (error.status === 429 && error.rateLimitResetAt) {
        waitMs = Math.max(waitMs, Date.parse(error.rateLimitResetAt) - Date.now() + 1000);
      }
    } else {
      log('error', 'poll failed', { error: String(error) });
    }
  }
  if (!stopping) await sleepUnlessStopped(waitMs);
}
log('info', 'poller stopped');
