import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type EvidenceDraft, runGates } from './gates.js';
import { quoteInText, simhash } from './similarity.js';

const window = { lockAt: new Date('2026-10-01T12:00:00Z'), deadlineAt: new Date('2027-05-31T23:59:59Z'), absenceIsMeaningful: false };

const draft = (overrides: Partial<EvidenceDraft> = {}): EvidenceDraft => ({
  sourceKind: 'web', basis: 'record', trustLevel: 'official', says: 'hit', eventDate: '2027-05-20',
  url: 'https://www.premierleague.com/tables', retrievedAt: new Date('2027-06-01T02:00:00Z'),
  quoteFound: true, isFinalResult: true, originalSource: null, simhash: null, ...overrides,
});

const gate = (d: EvidenceDraft, accepted: EvidenceDraft[] = [], w = window) => runGates(d, w, accepted);

test('a clean record passes every gate', () => {
  assert.deepEqual(gate(draft()), { gates: { trusted: true, quote_found: true, in_window: true, final: true, independent: true }, passed: true });
});

test('each gate fails on its own', () => {
  assert.equal(gate(draft({ trustLevel: 'other' })).gates.trusted, false);
  assert.equal(gate(draft({ quoteFound: false })).gates.quote_found, false);
  assert.equal(gate(draft({ quoteFound: null })).gates.quote_found, false);
  assert.equal(gate(draft({ eventDate: null })).gates.in_window, false);
  assert.equal(gate(draft({ isFinalResult: false })).gates.final, false);
  assert.equal(gate(draft({ says: 'pending' })).gates.final, false, 'pending is never final');
  for (const failing of [{ trustLevel: 'other' as const }, { quoteFound: false }, { eventDate: '2020-01-01' }, { isFinalResult: false }]) {
    assert.equal(gate(draft(failing)).passed, false);
  }
});

test('window boundaries: the lock day never counts; the deadline day does; the day after does not', () => {
  assert.equal(gate(draft({ eventDate: '2026-10-01' })).gates.in_window, false, 'lock day: may be before lock');
  assert.equal(gate(draft({ eventDate: '2026-10-02' })).gates.in_window, true);
  assert.equal(gate(draft({ eventDate: '2027-05-31' })).gates.in_window, true, 'deadline day');
  assert.equal(gate(draft({ eventDate: '2027-06-01' })).gates.in_window, false);
  assert.equal(gate(draft({ eventDate: '2027-5-31' })).gates.in_window, false, 'malformed date');
});

test('absence evidence: only from an exhaustive source, read at or after the deadline, and only as a miss', () => {
  const absence = draft({ basis: 'absence', says: 'miss', eventDate: null, quoteFound: null });
  const exhaustive = { ...window, absenceIsMeaningful: true };
  assert.deepEqual(gate(absence, [], exhaustive).gates, { trusted: true, quote_found: null, in_window: true, final: true, independent: true });
  assert.equal(gate(absence, [], window).gates.in_window, false, 'source not exhaustive');
  assert.equal(gate(draft({ ...absence, retrievedAt: new Date('2027-05-31T23:59:58Z') }), [], exhaustive).gates.in_window, false, 'read before the deadline');
  assert.equal(gate(draft({ ...absence, retrievedAt: new Date('2027-05-31T23:59:59Z') }), [], exhaustive).gates.in_window, true, 'read exactly at the deadline');
  assert.equal(gate(draft({ ...absence, says: 'hit' }), [], exhaustive).gates.in_window, false);
});

test('price feed evidence skips the quote and independence gates', () => {
  const price = draft({ sourceKind: 'price_feed', url: 'coinbase-candles', quoteFound: null });
  assert.deepEqual(gate(price).gates, { trusted: true, quote_found: null, in_window: true, final: true, independent: null });
  assert.equal(gate(draft({ ...price, eventDate: '2026-10-01' })).gates.in_window, true, "the lock day's close is after lock");
  assert.equal(gate(draft({ ...price, eventDate: '2026-09-30' })).gates.in_window, false);
});

test('entity_gone and irrelevant answers can pass the gates; the decision rules ignore them', () => {
  assert.equal(gate(draft({ says: 'entity_gone' })).passed, true);
});

test('independence: same site, near-identical page, or same original report count once', () => {
  const first = draft({ url: 'https://www.bbc.co.uk/sport/a', originalSource: 'AP', simhash: simhash(STORY) });
  assert.equal(gate(draft({ url: 'https://news.bbc.co.uk/b' }), [first]).gates.independent, false, 'same registrable domain');
  assert.equal(gate(draft({ url: 'https://espn.com/x', originalSource: 'ap ' }), [first]).gates.independent, false, 'same wire story');
  assert.equal(gate(draft({ url: 'https://espn.com/x', simhash: simhash(STORY + ' Updated.') }), [first]).gates.independent, false, 'near-identical text');
  assert.equal(gate(draft({ url: 'https://espn.com/x', simhash: simhash(OTHER) }), [first]).gates.independent, true);
});

test('quote check is whitespace, case and quote-mark insensitive, and refuses tiny quotes', () => {
  assert.equal(quoteInText('Arsenal  are Champions', 'Final whistle: arsenal are champions of England.'), true);
  assert.equal(quoteInText('“the title”', 'they won "the title" today'), true);
  assert.equal(quoteInText('Arsenal lose', 'Arsenal win the league'), false);
  assert.equal(quoteInText('win', 'Arsenal win the league'), false, 'too short to prove anything');
  assert.equal(quoteInText(null, 'anything'), false);
});

const STORY = 'Arsenal clinched the Premier League title on Sunday with a two nil win at the Emirates, ending a long wait for the north London club as supporters celebrated late into the night across the city and beyond';
const OTHER = 'The Federal Reserve left interest rates unchanged on Wednesday, citing persistent inflation in services and a labour market that remains tighter than policymakers had expected at the start of the year';
