import assert from 'node:assert/strict';
import { test } from 'node:test';
import { racePosterPrompt } from './event-image.js';
import { oddsRatio, oddsText, priced, racePostText, restLine } from './race-post.js';
import { weekendDays } from './race-run.js';

const RACE = {
  name: 'Hong Kong Gold Cup',
  date: '2026-11-15',
  course: 'Sha Tin',
  runners: [
    { horse: 'Romantic Warrior', odds: '13/8' },
    { horse: 'Voyage Bubble', odds: '5.0' },
    { horse: 'Ka Ying Rising', odds: '9-2' },
    { horse: 'Golden Sixty', odds: '7/1' },
    { horse: 'California Spangle', odds: '8:1' },
    { horse: 'Lucky Sweynesse', odds: '12/1' },
    { horse: 'Beauty Eternal', odds: '33/1' },
    { horse: 'Nobody Knows', odds: 'SP' },
  ],
};

test('prices are read in any common form and written as N:M', () => {
  assert.equal(oddsRatio('5/1'), 5);
  assert.equal(oddsRatio('evens'), 1);
  assert.equal(oddsRatio('6.0'), 5); // the pool's decimal price includes the stake
  assert.equal(oddsRatio('SP'), null);
  assert.equal(oddsRatio('1.0'), null);
  assert.equal(oddsText(5), '5:1');
  assert.equal(oddsText(3.5), '7:2');
  assert.equal(oddsText(1.5), '3:2');
  assert.equal(oddsText(2.75), '11:4');
  assert.equal(oddsText(2.7), '27:10');
  assert.equal(oddsText(6.33), '6:1');
});

test('the five shortest prices are named and the rest is one range', () => {
  const field = priced(RACE.runners);
  assert.deepEqual(
    field.map((r) => `${r.horse} ${r.odds}`),
    [
      'Romantic Warrior 13:8',
      'Voyage Bubble 4:1',
      'Ka Ying Rising 9:2',
      'Golden Sixty 7:1',
      'California Spangle 8:1',
      'Lucky Sweynesse 12:1',
      'Beauty Eternal 33:1',
    ],
  );
  assert.equal(restLine(field), 'Rest 12:1–33:1');
  assert.equal(restLine(field.slice(0, 5)), null);
  const text = racePostText(RACE, field)!;
  assert.match(
    text,
    /^Hong Kong Gold Cup · Sha Tin\nSun 15 Nov, early odds:\nRomantic Warrior 13:8\n/,
  );
  assert.match(text, /Rest 12:1–33:1\n\nYour pick\? Tag Vaticeno before the off\.$/);
  assert.doesNotMatch(text, /[@#]|https?:/);
  // Fewer than five priced runners: no post.
  assert.equal(racePostText(RACE, field.slice(0, 4)), null);
});

test('the poster spells the race, the day, the course and the board', () => {
  const prompt = racePosterPrompt(
    RACE,
    ['Romantic Warrior 13:8', 'Rest 12:1–33:1'],
    () => 0,
  );
  assert.match(prompt, /"Hong Kong Gold Cup"/);
  assert.match(prompt, /"SUN 15 NOV"/);
  assert.match(prompt, /"SHA TIN"/);
  assert.match(prompt, /"Romantic Warrior 13:8", "Rest 12:1–33:1"/);
});

test('the weekend is the coming Saturday and Sunday', () => {
  assert.deepEqual(weekendDays(new Date('2026-11-13T14:13:00Z')), [
    '2026-11-14',
    '2026-11-15',
  ]); // Friday
  assert.deepEqual(weekendDays(new Date('2026-11-14T11:13:00Z')), ['2026-11-15']); // Saturday
  assert.deepEqual(weekendDays(new Date('2026-11-10T11:13:00Z')), []); // Tuesday
});
