// Offline: see how a mention text is parsed. Usage: npm run poc:parse -- "@vaticeno record BTC > 150k by 2026-12-31"
import { parseCommand } from '../commands/parse.js';

const text = process.argv.slice(2).join(' ');
if (!text) {
  process.stderr.write('Usage: npm run poc:parse -- "<mention text>"\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify(parseCommand(text, process.env.X_BOT_HANDLE ?? 'vaticeno'), null, 2) + '\n');
