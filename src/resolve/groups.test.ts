// 004 FR-005/FR-006/FR-008a. The rule that produced a wrong public verdict: pages of one site were judged
// against whichever had been accepted first, so a meeting's landing page became the official record's only
// voice and the page naming the race was discarded (owner report 2026-10-12).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type GroupFacts, independenceOf, sameStory } from './groups.js';
import { simhash } from './similarity.js';

const STORY = 'Arsenal were crowned champions of England on Sunday after a goalless draw at the Emirates.';
const OTHER = 'The Federal Reserve left rates unchanged, citing stubborn services inflation and a soft labour market.';

const facts = (overrides: Partial<GroupFacts> = {}): GroupFacts =>
  ({ url: 'https://www.example.com/a', simhash: null, originalSource: null, trustLevel: 'established', eventMatch: 'yes', says: 'hit', detail: 1, ...overrides });

test('copies count once: same site, a near-identical page, or the same wire story', () => {
  const first = facts({ url: 'https://www.bbc.co.uk/sport/a', originalSource: 'AP', simhash: simhash(STORY) });
  assert.equal(sameStory(first, facts({ url: 'https://news.bbc.co.uk/b' })), true, 'same registrable domain');
  assert.equal(sameStory(first, facts({ url: 'https://espn.com/x', originalSource: 'ap ' })), true, 'same wire story');
  assert.equal(sameStory(first, facts({ url: 'https://espn.com/x', simhash: simhash(`${STORY} Updated.`) })), true, 'near-identical text');
  assert.equal(sameStory(first, facts({ url: 'https://espn.com/x', simhash: simhash(OTHER) })), false);
});

test('one witness per source, and the others are marked dependent', () => {
  const chosen = independenceOf([
    facts({ url: 'https://www.bbc.co.uk/a' }),
    facts({ url: 'https://www.bbc.co.uk/b' }),
    facts({ url: 'https://www.skysports.com/c' }),
  ]);
  assert.deepEqual(chosen.filter(Boolean).length, 2, 'two sources, two witnesses');
  assert.equal(chosen[2], true, 'the other site always counts');
});

test('the official record speaks through the page that names the event, not the page judged first', () => {
  // The real run: the landing page was read first and the exact page second, both on one domain.
  const landing = facts({ url: 'https://racing.hkjc.com/localresults', trustLevel: 'primary', eventMatch: 'no', says: 'miss', detail: 4 });
  const exact = facts({ url: 'https://racing.hkjc.com/resultsall?racedate=2026/10/11', trustLevel: 'primary', eventMatch: 'yes', says: 'hit', detail: 5 });
  assert.deepEqual(independenceOf([landing, exact]), [false, true]);
  assert.deepEqual(independenceOf([exact, landing]), [true, false], 'and the same the other way round');
});

test('the same pages in any order give the same answer (SC-002)', () => {
  const pages = [
    facts({ url: 'https://www.premierleague.com/matches', trustLevel: 'primary', eventMatch: 'unknown', detail: 1 }),
    facts({ url: 'https://www.premierleague.com/clubs/43', trustLevel: 'primary', eventMatch: 'yes', detail: 3 }),
    facts({ url: 'https://www.theguardian.com/football/live/x', detail: 4 }),
    facts({ url: 'https://www.theguardian.com/football/x', detail: 2 }),
    facts({ url: 'https://www.independent.co.uk/x', detail: 3 }),
  ];
  const picked = (list: GroupFacts[]) => independenceOf(list).flatMap((ok, i) => (ok ? [list[i]!.url] : [])).sort();
  const forwards = picked(pages);
  assert.deepEqual(forwards, picked([...pages].reverse()));
  assert.deepEqual(forwards, picked([pages[3]!, pages[0]!, pages[4]!, pages[1]!, pages[2]!]));
  assert.deepEqual(forwards, [
    'https://www.independent.co.uk/x',
    'https://www.premierleague.com/clubs/43',
    'https://www.theguardian.com/football/live/x',
  ], 'the placed official page, the fullest Guardian page, and the other outlet');
});

test('a representative is never chosen for what it says', () => {
  // Agreeing pages of one site: the fuller page speaks, whichever verdict it carries.
  const thin = facts({ url: 'https://www.bbc.co.uk/a', says: 'miss', detail: 1 });
  const full = facts({ url: 'https://www.bbc.co.uk/b', says: 'miss', detail: 4 });
  assert.deepEqual(independenceOf([thin, full]), [false, true]);
  assert.deepEqual(independenceOf([full, thin]), [true, false]);

  // Disagreeing pages of one site: no preference is available to take, so both go through.
  assert.deepEqual(independenceOf([thin, { ...full, says: 'hit' }]), [true, true]);
});

test('a disagreement inside one source escalates even where the contract named nothing to match', () => {
  // Most claims are like this, and picking a winner here is the same mistake in a quieter place.
  const a = facts({ url: 'https://www.bbc.co.uk/a', eventMatch: 'not_applicable', says: 'hit', detail: 3 });
  const b = facts({ url: 'https://www.bbc.co.uk/b', eventMatch: 'not_applicable', says: 'miss', detail: 1 });
  assert.deepEqual(independenceOf([a, b]), [true, true]);
});

test('two placed pages of one source that disagree both go through, so the arbiter decides (FR-008a)', () => {
  const a = facts({ url: 'https://racing.hkjc.com/a', trustLevel: 'primary', eventMatch: 'yes', says: 'hit', detail: 5 });
  const b = facts({ url: 'https://racing.hkjc.com/b', trustLevel: 'primary', eventMatch: 'yes', says: 'miss', detail: 2 });
  assert.deepEqual(independenceOf([a, b]), [true, true], 'a conflict inside a source is never hidden');

  // A page that could not be placed is not dragged in with them.
  const unplaced = facts({ url: 'https://racing.hkjc.com/c', trustLevel: 'primary', eventMatch: 'unknown', says: 'miss', detail: 1 });
  assert.deepEqual(independenceOf([a, b, unplaced]), [true, true, false]);
});

test('a chain of matches is one group, however the keys sort (review 2026-10-13)', () => {
  // A shares a domain with B, B shares a wire story with C, A and C share nothing. Keeping only the first
  // match left C on its own, and one story counted as two witnesses.
  const a = facts({ url: 'https://www.aaa.com/1', simhash: simhash(STORY) });
  const b = facts({ url: 'https://www.aaa.com/2', originalSource: 'Reuters' });
  const c = facts({ url: 'https://www.ccc.com/3', originalSource: 'reuters' });
  for (const order of [[a, b, c], [a, c, b], [c, b, a], [b, a, c]]) {
    assert.equal(independenceOf(order).filter(Boolean).length, 1, 'one story, one witness');
  }
});

