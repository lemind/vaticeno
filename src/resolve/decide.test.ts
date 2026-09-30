import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideResolution, type EvidenceRow } from './decide.js';

const DEADLINE = new Date('2027-05-31T23:59:59Z');
const RUN1 = new Date('2027-06-01T01:00:00Z');
const RUN2 = new Date('2027-06-02T01:00:00Z'); // 24 h after RUN1
const RUN3 = new Date('2027-06-04T01:00:00Z');

let n = 0;
const row = (trustLevel: EvidenceRow['trustLevel'], says: EvidenceRow['says'], runAt = RUN1, passed = true): EvidenceRow =>
  ({ id: `e${++n}`, runAt, trustLevel, says, passed });

const decide = (rows: EvidenceRow[], now = RUN1) => decideResolution(rows, now, DEADLINE);

test('no evidence at all (outage) → wait', () => {
  assert.deepEqual(decide([]), { kind: 'wait', reason: 'no_evidence' });
});

test('one official, nothing contradicting → final, decided by that item', () => {
  const official = row('official', 'hit');
  assert.deepEqual(decide([official, row('other', 'miss')]), { kind: 'final', outcome: 'hit', decidingEvidenceId: official.id });
});

test('official outranks trusted: official HIT + trusted MISS → final HIT', () => {
  const official = row('official', 'hit');
  assert.deepEqual(decide([row('trusted', 'miss'), official, row('trusted', 'miss')]), { kind: 'final', outcome: 'hit', decidingEvidenceId: official.id });
});

test('officials disagreeing → arbiter', () => {
  const a = row('official', 'hit');
  const b = row('official', 'miss');
  assert.deepEqual(decide([a, b, row('trusted', 'hit')]), { kind: 'needs_arbiter', candidateIds: [a.id, b.id] });
});

test('no official: 2+ trusted agreeing → final; disagreeing → arbiter; one → human', () => {
  const t1 = row('trusted', 'miss');
  assert.deepEqual(decide([t1, row('trusted', 'miss')]), { kind: 'final', outcome: 'miss', decidingEvidenceId: t1.id });
  const [a, b] = [row('trusted', 'hit'), row('trusted', 'miss')];
  assert.deepEqual(decide([a, b]), { kind: 'needs_arbiter', candidateIds: [a.id, b.id] });
  assert.deepEqual(decide([row('trusted', 'hit')]), { kind: 'needs_human', reason: 'lone_trusted' });
});

test('contract locator alone (trusted) → human; locator + one trusted agreeing → final', () => {
  const locator = row('trusted', 'hit');
  assert.deepEqual(decide([locator]), { kind: 'needs_human', reason: 'lone_trusted' });
  assert.equal(decide([locator, row('trusted', 'hit')]).kind, 'final');
});

test('failed gates, pending, irrelevant and other-only never count', () => {
  const rows = [row('official', 'hit', RUN1, false), row('trusted', 'irrelevant'), row('other', 'hit'), row('other', 'miss')];
  assert.deepEqual(decide(rows), { kind: 'wait', reason: 'insufficient_once' });
});

test('nothing counted: VOID only after two such runs at least 24 h apart', () => {
  assert.deepEqual(decide([row('trusted', 'irrelevant', RUN1)], RUN1), { kind: 'wait', reason: 'insufficient_once' });
  const almost = new Date(RUN1.getTime() + 23 * 3600e3);
  assert.deepEqual(decide([row('trusted', 'irrelevant', RUN1), row('trusted', 'irrelevant', almost)], almost), { kind: 'wait', reason: 'insufficient_once' });
  assert.deepEqual(decide([row('trusted', 'irrelevant', RUN1), row('trusted', 'irrelevant', RUN2)], RUN2), { kind: 'final', outcome: 'void', voidReason: 'insufficient_evidence' });
});

test('HIT and MISS use the latest run only: an earlier HIT does not decide a later empty run', () => {
  const rows = [row('official', 'hit', RUN1), row('trusted', 'irrelevant', RUN2)];
  assert.deepEqual(decide(rows, RUN2), { kind: 'wait', reason: 'insufficient_once' }, 'RUN1 counted, so it is not an empty earlier run');
});

test('official entity_gone: wait on runs 1 and 2, VOID unresolvable on the 3rd separate run', () => {
  assert.deepEqual(decide([row('official', 'entity_gone', RUN1)]), { kind: 'wait', reason: 'entity_gone' });
  const two = [row('official', 'entity_gone', RUN1), row('official', 'entity_gone', RUN2)];
  assert.deepEqual(decide(two, RUN2), { kind: 'wait', reason: 'entity_gone' });
  const three = [...two, row('official', 'entity_gone', RUN3)];
  assert.deepEqual(decide(three, RUN3), { kind: 'final', outcome: 'void', voidReason: 'unresolvable' });
  assert.deepEqual(decide([row('trusted', 'entity_gone', RUN1)]), { kind: 'wait', reason: 'insufficient_once' }, 'only official counts');
});

test('official pending: wait; more than 30 days after the deadline → human', () => {
  const pending = row('official', 'pending', RUN1, false);
  assert.deepEqual(decide([pending, row('trusted', 'hit'), row('trusted', 'hit')]), { kind: 'wait', reason: 'pending' });
  const day30 = new Date(DEADLINE.getTime() + 30 * 86400e3);
  assert.deepEqual(decide([pending], day30), { kind: 'wait', reason: 'pending' });
  assert.deepEqual(decide([pending], new Date(day30.getTime() + 1000)), { kind: 'needs_human', reason: 'pending_too_long' });
});
