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

function cleanBody(text: string): string {
  return text.replace(LEADING_SEPARATORS, '').trim();
}
