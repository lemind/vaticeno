import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCommand } from './commands.js';

test('commands: exact, aliases, small typos and a few extra words; longer text is a prediction', () => {
  const cases: Array<[string, string | null]> = [
    ['selfpromo', 'selfpromo'], ['selfpromote', 'selfpromo'], ['self promote', 'selfpromo'], ['Self-Promo!', 'selfpromo'],
    ['selfpromtoe', 'selfpromo'], ['selfpromo pls', 'selfpromo'], ['quote', 'quote'], ['quote 1', 'quote'], ['qoute', 'quote'],
    ['quotes', 'quote'], ['qutoe 2', 'quote'], ['help', 'help'], ['helo', 'help'], ['help me', 'help'], ['ping', 'ping'],
    ['ping test 2', 'ping'], ['STOP', 'stop'], ['stop.', 'stop'], ['stop it please', 'stop'],
    ['quote please', 'quote'], ['quote 🙏', 'quote'],
    ['stoop', null], ['pin', null], ['pong', null], ['hope', null],
    ['quote pp', 'quote'], ['help what is this', 'help'], ['stop at 90k', 'stop'], ['promo ends Friday', 'selfpromo'],
    ['Quote me: BTC hits 200k by 2027', 'quote'], ['qoute pp', null], ['about 95k by Friday', null], ['About to hit 100k', null],
    ['quite sure BTC 100k', null], ['held 100k by Friday', null],
    ['BTC closes above $100k by Oct 3', null], ['bitcoin will explode next month', null], ['', null],
  ];
  for (const [input, expected] of cases) assert.equal(resolveCommand(input), expected, input);
});
