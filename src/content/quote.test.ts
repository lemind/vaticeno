// What Vaticeno adds to someone else's post is checked in code, never trusted to the model
// (constitution VI 2.4.0): short, no @handles, no hashtags, no links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_OUR_CHARS, ourLineFits } from './quote.js';

test('a clean short line passes', () => {
  assert.equal(ourLineFits('That one is on the record now.'), true);
  assert.equal(ourLineFits('“Prediction is very difficult.” — Niels Bohr'), true);
});

test('tags, hashtags and links are refused', () => {
  assert.equal(ourLineFits('Bold call, @someone.'), false);
  assert.equal(ourLineFits('Noted #predictions'), false);
  assert.equal(ourLineFits('We will check: https://vaticeno.app/c/abc'), false);
  assert.equal(ourLineFits('See vaticeno.app for the receipt'), false);
});

test('an empty or over-long line is refused', () => {
  assert.equal(ourLineFits('   '), false);
  assert.equal(ourLineFits('a'.repeat(MAX_OUR_CHARS)), true);
  assert.equal(ourLineFits('a'.repeat(MAX_OUR_CHARS + 1)), false);
  // X counts an emoji as two characters, so the weighted length is what matters.
  assert.equal(ourLineFits('🎯'.repeat(MAX_OUR_CHARS / 2 + 1)), false);
});
