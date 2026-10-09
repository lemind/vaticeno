// Command grammar from INIT_SPEC §6.2. Only an explicit verb records; a bare mention does not.
export type ParsedCommand =
  | { kind: 'opt_out' }
  | { kind: 'amend'; body: string }
  | { kind: 'record'; body: string }
  | { kind: 'ping' } // POC-only liveness check, not part of the spec grammar
  | { kind: 'none' };

const RECORD_VERBS = ['on the record', 'record', 'otr']; // longest first
const LEADING_SEPARATORS = /^[\s—–\-:,.]+/;

// `STOP` must be uppercase: lowercase "stop" is common in predictions ("BTC won't stop").
const STOP_PATTERN = /(^|\s)STOP(?=\s|[.!]|$)/;
const OPT_OUT_PATTERN = /\bopt[\s-]?out\b/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseCommand(text: string, botHandle: string): ParsedCommand {
  const mention = new RegExp(`@${escapeRegExp(botHandle)}\\b`, 'i');
  const mentionMatch = mention.exec(text);
  if (!mentionMatch) return { kind: 'none' };

  if (STOP_PATTERN.test(text) || OPT_OUT_PATTERN.test(text)) return { kind: 'opt_out' };

  const before = stripLeadingHandles(text.slice(0, mentionMatch.index));
  // Skip further handles X prepends to replies ("@vaticeno @alice ping") before reading the verb.
  const after = stripLeadingHandles(text.slice(mentionMatch.index + mentionMatch[0].length));
  const afterLower = after.toLowerCase();

  if (/^amend\b/.test(afterLower)) {
    return { kind: 'amend', body: cleanBody(after.slice('amend'.length)) };
  }

  for (const verb of RECORD_VERBS) {
    if (new RegExp(`^${escapeRegExp(verb)}\\b`).test(afterLower)) {
      const rest = cleanBody(after.slice(verb.length));
      return { kind: 'record', body: [before, rest].filter(Boolean).join(' ').trim() };
    }
  }

  // "ping" anywhere in the post: X rejects identical repeat posts, so tests need varied text.
  if (/\bping\b/i.test(text)) return { kind: 'ping' };

  return { kind: 'none' };
}

// Replies arrive as "@alice @vaticeno record": leading handles are addressing, not content.
function stripLeadingHandles(text: string): string {
  return text.replace(/^(\s*@\w{1,15})+/, '').trim();
}

export type AddressableMention = {
  text: string;
  author_id: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: Array<{ type: string; id: string }>;
};

// Is this post addressed to us, or did we merely end up in it? (constitution VI, owner decision 2026-10-09.)
// HACK(x): OBSERVED 2026-10-08 — X prepends every participant's handle to a reply, so a thread we answered
// keeps arriving in our mentions timeline, and v2 exposes no field separating a carried handle from a typed one.
// REVISIT: if X exposes the reply prefix (v1.1's display_text_range or similar) on v2 mentions, read it and
// delete the position test below.
export function addressesBot(mention: AddressableMention, botHandle: string, botUserId: string, weRepliedInThread: boolean): boolean {
  if (!mention.referenced_tweets?.some((ref) => ref.type === 'replied_to')) return true; // its own post, naming us
  if (mention.in_reply_to_user_id === botUserId) return true; // answering us: a fix, or a question
  if (mention.in_reply_to_user_id === mention.author_id) return true; // "@vaticeno" under their own post
  if (!weRepliedInThread) return true; // tagged into someone else's thread: deliberate, nothing to carry
  // We are in this thread, and they are talking to someone else: only their own words can summon us.
  return new RegExp(`@${escapeRegExp(botHandle)}\\b`, 'i').test(stripLeadingHandles(mention.text));
}

function cleanBody(text: string): string {
  return text.replace(LEADING_SEPARATORS, '').trim();
}
