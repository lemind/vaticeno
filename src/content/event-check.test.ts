import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmedBy, keyWords } from './event-check.js';
import { eventPostText } from './event-post.js';
import { posterPrompt } from './event-image.js';

const EVENT = {
  name: 'Crystal Palace vs Liverpool',
  date: '2026-11-08',
  place: 'Selhurst Park, London',
};

test('an event counts only when two different sites give its name and its date', () => {
  assert.deepEqual(keyWords(EVENT.name), ['crystal', 'palace', 'liverpool']);
  const bbc = {
    url: 'https://www.bbc.co.uk/sport/x',
    text: 'Crystal Palace v Liverpool, Sunday 8 November, 14:00',
  };
  const sky = {
    url: 'https://www.skysports.com/y',
    text: 'Palace host Liverpool at Crystal Palace on Nov 8th',
  };
  const bbcAgain = { url: 'https://bbc.co.uk/other', text: bbc.text };
  const wrongDay = {
    url: 'https://example.com/z',
    text: 'Crystal Palace vs Liverpool on 9 November',
  };
  assert.deepEqual(confirmedBy(EVENT, [bbc, sky]), ['bbc.co.uk', 'skysports.com']);
  assert.deepEqual(
    confirmedBy(EVENT, [bbc, bbcAgain]),
    ['bbc.co.uk'],
    'one site twice is one source',
  );
  assert.deepEqual(
    confirmedBy(EVENT, [bbc, wrongDay]),
    ['bbc.co.uk'],
    'a different date does not confirm',
  );
});

test('the event post is the template, and refuses a slot carrying a link or a handle', () => {
  assert.equal(
    eventPostText(EVENT, () => 0),
    'Crystal Palace vs Liverpool is scheduled for Sun 8 Nov at Selhurst Park, London.\n\nHave a call? Tag Vaticeno before it starts.',
  );
  assert.equal(eventPostText({ ...EVENT, name: 'Final @UEFA' }), null);
  assert.equal(eventPostText({ ...EVENT, place: 'see bbc.com' }), null);
});

test('the poster sells the event: its name, date and place, flags or colours, no crest or real face', () => {
  const prompt = posterPrompt('football', {
    name: 'England vs "Serbia"',
    date: '2026-11-14',
    place: 'Wembley, London',
  });
  assert.match(prompt, /football/);
  assert.match(
    prompt,
    /"England vs Serbia" as the title, then "SAT 14 NOV", then "Wembley, London"/,
  );
  assert.match(prompt, /national flag or its team colours/);
  assert.match(prompt, /no club crests, logos/);
  assert.match(prompt, /recognisable real person/);
  assert.doesNotMatch(prompt, /Vaticeno/);
  const event = { name: 'England vs Serbia', date: '2026-11-14', place: 'Wembley' };
  assert.notEqual(
    posterPrompt('football', event, () => 0),
    posterPrompt('football', event, () => 0.99),
    'a different style and colour scheme each time',
  );
});
