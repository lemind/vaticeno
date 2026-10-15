// 004 FR-009, from a stored row of 2026-10-12: `says: miss` beside its own result line "Sunny Q won the
// Class 5 Kam Tin Handicap". The judge read the page correctly and classified it wrong.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Contract } from '../contract/schema.js';
import { selfConsistent } from './consistency.js';

const contract = (subject: string, criterion: string) => ({ subject, criterion }) as unknown as Contract;
const RACE = contract('Sunny Q', 'Sunny Q wins Race 2 at Sha Tin on October 11, 2026');

test('a MISS whose own result says the subject won is a contradiction', () => {
  assert.equal(selfConsistent(RACE, 'miss', { winner: 'Sunny Q', score: null }, 'yes'), false);
  assert.equal(selfConsistent(RACE, 'hit', { winner: 'Sunny Q', score: null }, 'yes'), true);
});

test('a MISS whose own result says someone else won is consistent', () => {
  assert.equal(selfConsistent(RACE, 'miss', { winner: 'SHINYU KOKOROE', score: null }, 'yes'), true);
  assert.equal(selfConsistent(RACE, 'hit', { winner: 'SHINYU KOKOROE', score: null }, 'yes'), false);
});

test('the name is matched loosely, since a page writes it its own way', () => {
  assert.equal(selfConsistent(RACE, 'hit', { winner: 'SUNNY Q (4.3)', score: null }, 'yes'), true);
});

test('a page about another event is not checked; one code cannot place still is', () => {
  // An unplaced page has already failed the relevance gate; its facts prove nothing about our event.
  assert.equal(selfConsistent(RACE, 'miss', { winner: 'Sunny Q', score: null }, 'unknown'), null);
  assert.equal(selfConsistent(RACE, 'miss', { winner: 'Sunny Q', score: null }, 'no'), null);
  // e9vtp: a football contract names no round and no date, so code cannot place the page — and two
  // reports calling a 2–0 win for the subject a "miss" went through the gates (004 T423).
  assert.equal(selfConsistent(RACE, 'miss', { winner: 'Sunny Q', score: null }, 'not_applicable'), false);
  assert.equal(selfConsistent(RACE, 'hit', { winner: 'Sunny Q', score: null }, 'not_applicable'), true);
});

test('a criterion asking how much is never answered here', () => {
  // The winner alone cannot settle these, and guessing would throw away a correct verdict.
  const margin = contract('Manchester City', 'Manchester City beat Liverpool by at least 2 goals');
  assert.equal(selfConsistent(margin, 'miss', { winner: 'Manchester City', score: '1-0' }, 'yes'), null);
  const by = contract('Arsenal', 'Arsenal win by 3 or more goals');
  assert.equal(selfConsistent(by, 'miss', { winner: 'Arsenal', score: '2-0' }, 'yes'), null);
});

test('a criterion that is not about winning is left alone', () => {
  const draw = contract('Manchester United', 'Manchester United and Tottenham Hotspur draw at Old Trafford');
  assert.equal(selfConsistent(draw, 'hit', { winner: null, score: '1-1' }, 'yes'), null);
  const approval = contract('drug X', 'The FDA approves drug X for condition Y');
  assert.equal(selfConsistent(approval, 'hit', { winner: null, score: null }, 'yes'), null);
});

test('the subject must be the one doing the winning', () => {
  // "X beat Y" and "Y beat X" differ by word order alone; the check refuses the ones it cannot read.
  const other = contract('Liverpool', 'Manchester City beat Liverpool');
  assert.equal(selfConsistent(other, 'miss', { winner: 'Manchester City', score: '3-0' }, 'yes'), null);
});

test('pending, irrelevant and a missing winner are not contradictions', () => {
  assert.equal(selfConsistent(RACE, 'pending', { winner: 'Sunny Q', score: null }, 'yes'), null);
  assert.equal(selfConsistent(RACE, 'irrelevant', { winner: 'Sunny Q', score: null }, 'yes'), null);
  assert.equal(selfConsistent(RACE, 'miss', { winner: null, score: null }, 'yes'), null);
  assert.equal(selfConsistent(RACE, 'miss', null, 'yes'), null);
});
