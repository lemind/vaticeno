// The closed set of bot commands, matched in code (no model call): exact words, a few aliases, and small
// typos ("qoute", "selfpromtoe"). Anything else is not a command and goes to the prediction pipeline.
export type Command = 'help' | 'stop' | 'ping' | 'selfpromote' | 'quote';

const ALIASES: Record<string, Command> = {
  help: 'help', commands: 'help',
  stop: 'stop',
  ping: 'ping',
  selfpromote: 'selfpromote', selfpromo: 'selfpromote', promo: 'selfpromote', about: 'selfpromote',
  quote: 'quote', quotes: 'quote', citation: 'quote',
};
// STOP and ping only exactly: a typo must never opt someone out, and "pin"/"pong" are not ping.
const FUZZY: Command[] = ['help', 'selfpromote', 'quote'];

export function resolveCommand(body: string): Command | null {
  const words = body.toLowerCase().replace(/[!.?]+$/, '').trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return null;
  const word = words.join(''); // "self promote" → selfpromote
  const exact = ALIASES[word];
  if (exact) return exact;
  if (words.length > 1 && !word.startsWith('self')) return null; // two words are a command only as "self promo(te)"
  for (const [alias, command] of Object.entries(ALIASES)) {
    if (!FUZZY.includes(command) || alias.length < 4) continue;
    if (editDistance(word, alias) <= (alias.length >= 8 ? 2 : 1)) return command;
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
