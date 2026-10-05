import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandWordIn, resolveCommand } from './commands.js';

test('commands: exact, aliases, small typos and a few extra words; longer text is a prediction', () => {
  const cases: Array<[string, string | null]> = [
    ['selfpromo', 'selfpromo'], ['selfpromote', 'selfpromo'], ['self promote', 'selfpromo'], ['Self-Promo!', 'selfpromo'],
    ['selfpromtoe', 'selfpromo'], ['selfpromo pls', 'selfpromo'], ['quote', 'quote'], ['quote 1', 'quote'], ['qoute', 'quote'],
    ['quotes', 'quote'], ['qutoe 2', 'quote'], ['help', 'help'], ['helo', 'help'], ['help me', 'help'], ['ping', 'ping'],
    ['ping test 2', 'ping'], ['STOP', 'stop'], ['stop.', 'stop'], ['stop it please', 'stop'],
    ['quote please', 'quote'], ['quote 🙏', 'quote'],
    ['stoop', null], ['pin', null], ['pong', null], ['hope', null],
    ['quote pp', null], ['help what is this', null], ['stop at 90k', null], ['promo ends Friday', null],
    ['Quote me: BTC hits 200k by 2027', null], ['qoute pp', null], ['about 95k by Friday', null], ['About to hit 100k', null],
    ['quite sure BTC 100k', null], ['held 100k by Friday', null],
    ['BTC closes above $100k by Oct 3', null], ['bitcoin will explode next month', null], ['', null],
  ];
  for (const [input, expected] of cases) assert.equal(resolveCommand(input), expected, input);
});

test('a command word followed by real text is a candidate for the model, not a command', () => {
  assert.equal(commandWordIn('quote me something nice'), 'quote');
  assert.equal(commandWordIn('Quote me: BTC hits 200k by 2027'), 'quote');
  assert.equal(commandWordIn('stop at 90k'), 'stop');
  assert.equal(commandWordIn('BTC above 100k'), null);
});

test('selfpromo has many names, phrases included; short ones never catch ordinary words by typo', () => {
  for (const input of ['promote', 'promote yourself', 'show off', 'show-off', 'showoff', 'flex', 'brag', 'pitch', 'elevator pitch',
    'shameless plug', 'introduce yourself', 'who are you', 'who are you?', 'hype yourself', 'self promotion', 'motto']) {
    assert.equal(resolveCommand(input), 'selfpromo', input);
  }
  for (const input of ['plus', 'drag', 'flux', 'promote BTC to 100k by Friday']) assert.equal(resolveCommand(input), null, input);
  assert.equal(resolveCommand('promte'), 'selfpromo', 'typo of promote');
});
