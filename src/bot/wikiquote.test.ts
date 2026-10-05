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
    // The name alone: the rest of a Wikiquote source line is a publisher's citation, and cutting it to
    // length left fragments in a real post (owner report 2026-10-05).
    by: 'Ambrose Bierce',
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
    { text: 'Fortune favours the bold, and so do the odds when you count the cards.', by: 'Ambrose Bierce' },
    { text: 'Luck is what happens when preparation meets opportunity, said the old coach.', by: 'Seneca' },
  ]);
});


test('Wikiquote: lyrics and dialogue are skipped, and a long citation never leaves a fragment', () => {
  const wikitext = [
    '== Quotes ==',
    '* To me? Flirting is just like a sport. Yes Sir. I am the best at it and I love it.',
    '** Lou Bega, "Mambo No. 5" (19 April 1999), from the album A Little Bit of Mambo, New York: RCA',
    '* The future is uncertain, and the only certainty is that we will be surprised by it.',
    '** Some Long Named Author Of A Very Long Scholarly Work Indeed With No Comma At All Anywhere',
  ].join('\n');
  const quotes = quotesOn(wikitext);
  assert.equal(quotes.length, 1, 'the song lyric is skipped');
  assert.equal(quotes[0]!.by.length <= 48, true);
  assert.equal(/[a-z]$/.test(quotes[0]!.by) || /\w$/.test(quotes[0]!.by), true, 'no fragment ending');
  assert.equal(quotes[0]!.by, 'Some Long Named Author Of A Very Long Scholarly');
});
