import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quotesOn } from './wikiquote.js';

test('Wikiquote: only sourced quotes before Misattributed, markup stripped', () => {
  const wikitext = [
    '== Quotes ==',
    "* The gambling known as [[business]] looks with austere disfavor upon the business known as gambling.<ref>x</ref>",
    "** [[Ambrose Bierce]], in ''Cosmopolitan'' (1905), Vol. 38, p. 444.",
    '* A quote without any source line underneath it at all.',
    '* Too short.',
    '** Someone',
    '== Misattributed ==',
    '* Never put money down unless you are sure in advance you will win.',
    '** Bugsy Siegel',
  ].join('\n');
  assert.deepEqual(quotesOn(wikitext), [{
    text: 'The gambling known as business looks with austere disfavor upon the business known as gambling.',
    by: 'Ambrose Bierce, in Cosmopolitan (1905)',
  }]);
});
