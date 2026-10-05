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

test('Wikiquote: w: links and {{w}} templates keep the name; translations, line-spanning refs and <br> handled', () => {
  const wikitext = [
    '* Fortune favours the bold, and so do the odds when you count the cards.<ref>long',
    'ref</ref>',
    "** [[w:Ambrose Bierce]], ''The Devil's Dictionary'' (1911)",
    '* Luck is what happens when<br />preparation meets opportunity, said the old coach.',
    '** {{w|Seneca the Younger|Seneca}}, Letters',
    '* Alea iacta est, and the river was crossed by the whole army.',
    '** The die is cast, and the river was crossed by the whole army.',
    '*** Julius Caesar',
    '* Fortune favours the brave, the old Romans liked to say often.',
    "** Original: ''Audentes fortuna iuvat''",
  ].join('\n');
  assert.deepEqual(quotesOn(wikitext), [
    { text: 'Fortune favours the bold, and so do the odds when you count the cards.', by: "Ambrose Bierce, The Devil's Dictionary (1911)" },
    { text: 'Luck is what happens when preparation meets opportunity, said the old coach.', by: 'Seneca, Letters' },
  ]);
});

