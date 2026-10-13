// 004 FR-002/FR-003, built from the live failure of 2026-10-12: a results landing page showing Race 1
// decided a claim about Race 2 and reported that the winner "did not participate". Every case here is a
// real contract or a real page from that run, or one of the nine other live claims it must not break.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Contract } from '../contract/schema.js';
import { contractEventKey, type EventIdentity, matchEvent } from './relevance.js';

const contract = (entity: string, criterion: string) =>
  ({ source: { entity_id: entity }, criterion }) as unknown as Contract;

const identity = (overrides: Partial<EventIdentity> = {}): EventIdentity =>
  ({ date: null, competition: null, round: null, venue: null, participants: [], ...overrides });

// The claim that was published wrong.
const RACE_2 = contract('Sha Tin Race 2 2026-10-11', 'Sunny Q wins Race 2 at Sha Tin on October 11, 2026');

test('the contract key comes from the source entity: a race number and its day', () => {
  assert.deepEqual(contractEventKey(RACE_2), { round: 2, date: '2026-10-11', roundHint: 2 });
});

test('the page that decided the wrong verdict is about another race', () => {
  // racing.hkjc.com/.../localresults — the meeting landing page, which showed Race 1 that day.
  const landing = identity({ date: '2026-10-11', competition: 'Sha Tin', round: 'Race 1', participants: ['SHINYU KOKOROE'] });
  assert.equal(matchEvent(contractEventKey(RACE_2), landing), 'no');
});

test('the page that answered the question is accepted', () => {
  // racing.hkjc.com/.../resultsall?racedate=2026/10/11&Racecourse=ST — dropped by the old independence gate.
  const exact = identity({ date: '2026-10-11', competition: 'Sha Tin', round: 'Race 2', participants: ['Sunny Q'] });
  assert.equal(matchEvent(contractEventKey(RACE_2), exact), 'yes');
});

test('a page naming the race only by its title cannot be placed, so it decides nothing', () => {
  // The two pages that said "Kam Tin Handicap" without its number. It WAS race 2 — the page does not say so.
  const byTitle = identity({ date: '2026-10-11', competition: 'Sha Tin', participants: ['Sunny Q'] });
  assert.equal(matchEvent(contractEventKey(RACE_2), byTitle), 'unknown');
});

test('a judgement from before judge.v5 carries no identity and cannot be placed', () => {
  assert.equal(matchEvent(contractEventKey(RACE_2), null), 'unknown');
});

test('a contract naming no round and no day leaves the judgement to the model', () => {
  // Eight of the nine other live claims look like this, and must not start failing closed.
  const match = contract('Manchester United vs Atlético Madrid', 'Manchester United beat Atlético Madrid in a UEFA Champions League match');
  assert.deepEqual(contractEventKey(match), { round: null, date: null, roundHint: null });
  assert.equal(matchEvent(contractEventKey(match), identity({ date: '2026-10-21' })), 'not_applicable');
  assert.equal(matchEvent(contractEventKey(match), null), 'not_applicable');
});

test('a date in the criterion is the deadline, not the event, and is never required of a page', () => {
  // Requiring it would have failed every correct page: the figure is published on the day it is due.
  const cpi = contract('CPI for All Urban Consumers (CPI-U)', 'US September CPI YoY inflation prints at 3.6% or lower on Oct 14 2026');
  assert.deepEqual(contractEventKey(cpi), { round: null, date: null, roundHint: null });
  assert.equal(matchEvent(contractEventKey(cpi), identity({ date: '2026-10-13' })), 'not_applicable');
});

test('a round named only in the criterion may be contradicted, never demanded', () => {
  // "Week 6" is in the criterion, not in the entity: a page that says Week 5 is the wrong game, and a page
  // that mentions no week at all is still usable.
  const nfl = contract('Green Bay Packers vs Dallas Cowboys', 'The Green Bay Packers beat the Dallas Cowboys in the Week 6 Sunday Night Football game.');
  assert.deepEqual(contractEventKey(nfl), { round: null, date: null, roundHint: 6 });
  assert.equal(matchEvent(contractEventKey(nfl), identity({ round: 'Week 5' })), 'no');
  assert.equal(matchEvent(contractEventKey(nfl), identity({ participants: ['Packers', 'Cowboys'] })), 'not_applicable');
});

test('a round in the entity must be confirmed, and a different one is refused', () => {
  const alcs = contract('Tampa Bay Rays vs Cleveland Guardians Game 1', 'The Tampa Bay Rays beat the Cleveland Guardians in ALCS Game 1');
  assert.deepEqual(contractEventKey(alcs), { round: 1, date: null, roundHint: 1 });
  assert.equal(matchEvent(contractEventKey(alcs), identity({ round: 'Game 1' })), 'yes');
  assert.equal(matchEvent(contractEventKey(alcs), identity({ round: 'Game 2' })), 'no');
  assert.equal(matchEvent(contractEventKey(alcs), identity({ participants: ['Rays', 'Guardians'] })), 'unknown');
});

test('a day named by the entity must be the page day', () => {
  const race = contract('Sha Tin Race 5 2026-10-11', 'Nothing Special wins Race 5 at Sha Tin');
  assert.equal(matchEvent(contractEventKey(race), identity({ round: 'Race 5', date: '2026-10-12' })), 'no');
  assert.equal(matchEvent(contractEventKey(race), identity({ round: 'Race 5', date: '2026-10-11' })), 'yes');
});
