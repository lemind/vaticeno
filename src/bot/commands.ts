// The closed set of bot commands, matched in code (no model call): exact words, a few aliases, and small
// typos ("qoute", "selfpromtoe"), plus a few extra words. Anything else goes to the prediction pipeline.
export type Command = 'help' | 'stop' | 'ping' | 'selfpromo' | 'quote';

const ALIASES: Record<string, Command> = {
  help: 'help', commands: 'help',
  stop: 'stop',
  ping: 'ping',
  selfpromo: 'selfpromo', selfpromote: 'selfpromo', promo: 'selfpromo',
  quote: 'quote', quotes: 'quote', citation: 'quote',
};
// STOP and ping only exactly: a typo must never opt someone out, and "pin"/"pong" are not ping.
const FUZZY: Command[] = ['help', 'selfpromo', 'quote'];
// The command word may carry a few filler words ("quote 1", "help pls", "stop please"). Anything with
// content ("stop at 90k", "help, I meant 95k") is a prediction or a fix, never a command.
const MAX_EXTRA_WORDS = 3;
const FILLER = new Set(['please', 'pls', 'plz', 'me', 'test', 'now', 'again', 'it', 'one', 'another', 'more', 'us', 'bot', 'thanks', 'thx', 'a', 'the']);
const isFiller = (word: string) => FILLER.has(word) || /^\d{1,2}$/.test(word);

export function resolveCommand(body: string): Command | null {
  const words = body.toLowerCase().replace(/[!.?,:;]+/g, ' ').trim().split(/[\s_-]+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return null;
  // "self promo" / "self-promote" is one word
  const [first, rest] = words[0] === 'self' && words.length > 1 ? [`self${words[1]}`, words.slice(2)] : [words[0]!, words.slice(1)];
  if (rest.length > MAX_EXTRA_WORDS || !rest.every(isFiller)) return null;
  const exact = ALIASES[first];
  if (exact) return exact;
  for (const [alias, command] of Object.entries(ALIASES)) {
    if (!FUZZY.includes(command) || alias.length < 4) continue;
    if (editDistance(first, alias) <= (alias.length >= 8 ? 2 : 1)) return command;
  }
  return null;
}

// Damerau-Levenshtein (optimal string alignment): a swap of two neighbours ("qoute") counts as one edit.
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}
