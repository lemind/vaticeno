import { parseCommand, type ParsedCommand } from '../commands/parse.js';
import type { Mention } from '../x/client.js';

// What the bot decides for one mention. POC: decisions only, no claim storage, no normalizer.
export type MentionDecision =
  | { outcome: 'ignored'; reason: 'self' | 'repost' | 'no_command' }
  | { outcome: 'opt_out' }
  | { outcome: 'ping' }
  | { outcome: 'amend'; body: string }
  | { outcome: 'rejected'; reason: 'third_party' }
  | { outcome: 'needs_info'; reason: 'empty_prediction' }
  | { outcome: 'record'; context: 'inline' | 'parent'; body: string; sourceTweetId: string };

export function classifyMention(mention: Mention, botUserId: string, botHandle: string): MentionDecision {
  // Ignore rules, INIT_SPEC §6.1. Opted-out authors need the DB, so they are not checked here.
  if (mention.author_id === botUserId) return { outcome: 'ignored', reason: 'self' };
  if (mention.referenced_tweets?.some((ref) => ref.type === 'retweeted')) {
    return { outcome: 'ignored', reason: 'repost' };
  }

  const command: ParsedCommand = parseCommand(mention.text, botHandle);
  switch (command.kind) {
    case 'none':
      return { outcome: 'ignored', reason: 'no_command' };
    case 'opt_out':
      return { outcome: 'opt_out' };
    case 'ping':
      return { outcome: 'ping' };
    case 'amend':
      return { outcome: 'amend', body: command.body };
    case 'record':
      return classifyRecord(mention, command.body);
  }
}

// A reply whose "prediction" only points at the post above ("this", "that one", "👆") means the parent.
const POINTS_AT_PARENT = /^(this|that|it|this one|that one|above|here|[^\p{L}\p{N}]*)$/iu;

// User-intent check, INIT_SPEC §5 step 3: the summoner must be the author of the predicting post.
function classifyRecord(mention: Mention, body: string): MentionDecision {
  const repliedTo = mention.referenced_tweets?.find((ref) => ref.type === 'replied_to');
  const pointsAtParent = POINTS_AT_PARENT.test(body.replace(/[.!?]+$/, '').trim());

  if (!pointsAtParent) {
    return { outcome: 'record', context: 'inline', body, sourceTweetId: mention.id };
  }
  if (!repliedTo) return { outcome: 'needs_info', reason: 'empty_prediction' };
  if (mention.in_reply_to_user_id !== mention.author_id) return { outcome: 'rejected', reason: 'third_party' };

  // Prediction lives in the author's own parent post: 1 post read, fetched in a later stage.
  return { outcome: 'record', context: 'parent', body: '', sourceTweetId: repliedTo.id };
}

// Logs carry no post text (INIT_SPEC §6.9): user-written bodies are reduced to their length.
export function redactDecision(decision: MentionDecision): Record<string, unknown> {
  if (!('body' in decision)) return decision;
  const { body, ...rest } = decision;
  return { ...rest, body_chars: body.length };
}

// Log-only preview of the reply. Real templates (INIT_SPEC §6.5) need the normalizer.
export function describeWouldReply(decision: MentionDecision): string | null {
  switch (decision.outcome) {
    case 'ignored':
      return null;
    case 'opt_out':
      return 'Opted out. I will not reply to you again.';
    case 'ping':
      return 'pong';
    case 'amend':
      return '(amend received — claim lookup not built yet)';
    case 'rejected':
      return 'NOT RECORDED — I only record your own predictions.';
    case 'needs_info':
      return 'NOT RECORDED — I can\'t judge this as written.\n\nReply: amend <what happens> by <YYYY-MM-DD>';
    case 'record':
      return decision.context === 'inline'
        ? '(would normalize the inline prediction)'
        : `(would read parent post ${decision.sourceTweetId} and normalize it)`;
  }
}
