import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCommand } from './commands.js';

test('commands: exact, aliases and small typos; everything else is not a command', () => {
  const cases: Array<[string, string | null]> = [
    ['selfpromote', 'selfpromote'], ['selfpromo', 'selfpromote'], ['self promote', 'selfpromote'], ['Self-Promo!', 'selfpromote'],
    ['selfpromtoe', 'selfpromote'], ['quote', 'quote'], ['qoute', 'quote'], ['quotes', 'quote'], ['qutoe', 'quote'],
    ['help', 'help'], ['helo', 'help'], ['ping', 'ping'], ['STOP', 'stop'], ['stop.', 'stop'],
    ['stoop', null], ['pin', null], ['pong', null], ['help me', null], ['quote me on this', null],
    ['BTC closes above $100k by Oct 3', null], ['bitcoin will explode next month', null], ['', null], ['hope', null],
  ];
  for (const [input, expected] of cases) assert.equal(resolveCommand(input), expected, input);
});
