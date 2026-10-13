import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideResolution, type EvidenceRow } from './decide.js';

const DEADLINE = new Date('2027-05-31T23:59:59Z');
const RUN1 = new Date('2027-06-01T01:00:00Z');
const RUN2 = new Date('2027-06-02T01:00:00Z'); // 24 h after RUN1
const RUN3 = new Date('2027-06-04T01:00:00Z');

let n = 0;
const row = (trustLevel: EvidenceRow['trustLevel'], says: EvidenceRow['says'], runAt = RUN1, passed = true, quoteFound: boolean | null = true, basis: EvidenceRow['basis'] = 'record'): EvidenceRow =>
  ({ id: `e${++n}`, runAt, trustLevel, says, basis, passed, quoteFound });
// A page that is the official record and does not list the event (001 FR-034).
const absence = (trustLevel: EvidenceRow['trustLevel'], says: EvidenceRow['says'], runAt = RUN1): EvidenceRow =>
  row(trustLevel, says, runAt, true, null, 'absence');

const decide = (rows: EvidenceRow[], now = RUN1) => decideResolution(rows, now, DEADLINE);

test('no evidence at all (outage) → wait', () => {
  assert.deepEqual(decide([]), { kind: 'wait', reason: 'no_evidence' });
});

test('one primary, nothing contradicting → final, decided by that item', () => {
  const primary = row('primary', 'hit');
  assert.deepEqual(decide([primary, row('weak', 'miss')]), { kind: 'final', outcome: 'hit', decidingEvidenceId: primary.id });
});

test('a primary disagreeing with established ones goes to the arbiter (001 FR-034)', () => {
  // Until 2026-10-12 the top tier decided alone and the rest were discarded unseen.
  const primary = row('primary', 'hit');
  const [m1, m2] = [row('established', 'miss'), row('established', 'miss')];
  assert.deepEqual(decide([m1, primary, m2]), { kind: 'needs_arbiter', candidateIds: [m1.id, primary.id, m2.id] });
});

test('items disagreeing → arbiter, with every passed item as a candidate', () => {
  const a = row('primary', 'hit');
  const b = row('primary', 'miss');
  const c = row('established', 'hit');
  assert.deepEqual(decide([a, b, c]), { kind: 'needs_arbiter', candidateIds: [a.id, b.id, c.id] });
});

test('no primary: 2+ established agreeing → final; disagreeing → arbiter; one → human', () => {
  const t1 = row('established', 'miss');
  assert.deepEqual(decide([t1, row('established', 'miss')]), { kind: 'final', outcome: 'miss', decidingEvidenceId: t1.id });
  const [a, b] = [row('established', 'hit'), row('established', 'miss')];
  assert.deepEqual(decide([a, b]), { kind: 'needs_arbiter', candidateIds: [a.id, b.id] });
  assert.deepEqual(decide([row('established', 'hit')]), { kind: 'needs_human', reason: 'lone_established' });
});

test('one established alone → human; plus a second established agreeing → final', () => {
  const first = row('established', 'hit');
  assert.deepEqual(decide([first]), { kind: 'needs_human', reason: 'lone_established' });
  assert.equal(decide([first, row('established', 'hit')]).kind, 'final');
});

test('failed gates, pending, irrelevant and weak-only never count', () => {
  const rows = [row('primary', 'hit', RUN1, false), row('established', 'irrelevant'), row('weak', 'hit'), row('weak', 'miss')];
  assert.deepEqual(decide(rows), { kind: 'wait', reason: 'insufficient_once' });
});

test('nothing counted: VOID only after two such runs at least 24 h apart', () => {
  assert.deepEqual(decide([row('established', 'irrelevant', RUN1)], RUN1), { kind: 'wait', reason: 'insufficient_once' });
  const almost = new Date(RUN1.getTime() + 23 * 3600e3);
  assert.deepEqual(decide([row('established', 'irrelevant', RUN1), row('established', 'irrelevant', almost)], almost), { kind: 'wait', reason: 'insufficient_once' });
  assert.deepEqual(decide([row('established', 'irrelevant', RUN1), row('established', 'irrelevant', RUN2)], RUN2), { kind: 'final', outcome: 'void', voidReason: 'insufficient_evidence' });
});

test('HIT and MISS use the latest run only: an earlier HIT does not decide a later empty run', () => {
  const rows = [row('primary', 'hit', RUN1), row('established', 'irrelevant', RUN2)];
  assert.deepEqual(decide(rows, RUN2), { kind: 'wait', reason: 'insufficient_once' }, 'RUN1 counted, so it is not an empty earlier run');
});

test('primary entity_gone: wait on runs 1 and 2, VOID unresolvable on the 3rd separate run', () => {
  assert.deepEqual(decide([row('primary', 'entity_gone', RUN1)]), { kind: 'wait', reason: 'entity_gone' });
  const two = [row('primary', 'entity_gone', RUN1), row('primary', 'entity_gone', RUN2)];
  assert.deepEqual(decide(two, RUN2), { kind: 'wait', reason: 'entity_gone' });
  const three = [...two, row('primary', 'entity_gone', RUN3)];
  assert.deepEqual(decide(three, RUN3), { kind: 'final', outcome: 'void', voidReason: 'unresolvable' });
  assert.deepEqual(decide([row('established', 'entity_gone', RUN1)]), { kind: 'wait', reason: 'insufficient_once' }, 'only primary counts');
});

test('a run with a primary pending or entity_gone is never an empty run on the way to VOID', () => {
  const rows = [row('primary', 'pending', RUN1, false), row('established', 'irrelevant', RUN2)];
  assert.deepEqual(decide(rows, RUN2), { kind: 'wait', reason: 'insufficient_once' });
  const gone = [row('primary', 'entity_gone', RUN1, false), row('established', 'irrelevant', RUN2)];
  assert.deepEqual(decide(gone, RUN2), { kind: 'wait', reason: 'insufficient_once' });
});

test('primary pending / entity_gone without the quote on the page are ignored', () => {
  assert.deepEqual(decide([row('primary', 'pending', RUN1, false, false)]), { kind: 'wait', reason: 'insufficient_once' });
  assert.deepEqual(decide([row('primary', 'entity_gone', RUN1, false, false)]), { kind: 'wait', reason: 'insufficient_once' });
  assert.deepEqual(decide([row('primary', 'entity_gone', RUN1, false, null)]), { kind: 'wait', reason: 'entity_gone' }, 'price feed: no quote gate');
});

test('primary pending: wait; more than 30 days after the deadline → human', () => {
  const pending = row('primary', 'pending', RUN1, false);
  assert.deepEqual(decide([pending, row('established', 'hit'), row('established', 'hit')]), { kind: 'wait', reason: 'pending' });
  const day30 = new Date(DEADLINE.getTime() + 30 * 86400e3);
  assert.deepEqual(decide([pending], day30), { kind: 'wait', reason: 'pending' });
  assert.deepEqual(decide([pending], new Date(day30.getTime() + 1000)), { kind: 'needs_human', reason: 'pending_too_long' });
});

test('an absence never outranks reports of the event (001 FR-034)', () => {
  // The live defect of 2026-10-11: one primary fixtures page that did not list the match beat three
  // outlets reporting the score, and a 3-0 win was published as a MISS.
  const guardian = row('established', 'hit');
  const independent = row('established', 'hit');
  const notListed = absence('primary', 'miss');
  // The records decide, and the disagreement is reported rather than escalated (004 FR-008): escalating a
  // case the admission list cannot produce yet would be machinery for nobody.
  assert.deepEqual(decide([notListed, guardian, independent]), { kind: 'final', outcome: 'hit', decidingEvidenceId: guardian.id, absenceDisagreed: true });
});

test('an absence agreeing with the records is not reported as a disagreement (004 FR-008)', () => {
  const guardian = row('established', 'miss');
  const independent = row('established', 'miss');
  const notListed = absence('primary', 'miss');
  assert.deepEqual(decide([notListed, guardian, independent]), { kind: 'final', outcome: 'miss', decidingEvidenceId: guardian.id });
});

test('an absence still decides when nothing else passed', () => {
  const notListed = absence('primary', 'miss');
  assert.deepEqual(decide([notListed]), { kind: 'final', outcome: 'miss', decidingEvidenceId: notListed.id });
});

test('a primary record disagreeing with an established one goes to the arbiter, not to the top tier', () => {
  const hkjc = row('primary', 'miss');
  const sportinglife = row('established', 'hit');
  assert.deepEqual(decide([hkjc, sportinglife]), { kind: 'needs_arbiter', candidateIds: [hkjc.id, sportinglife.id] });
});

test('agreeing records across tiers are final, cited to the most trusted of them', () => {
  const paper = row('established', 'hit');
  const league = row('primary', 'hit');
  assert.deepEqual(decide([paper, league]), { kind: 'final', outcome: 'hit', decidingEvidenceId: league.id });
});
