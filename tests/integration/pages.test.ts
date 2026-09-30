// Public pages (US5, SC-009): required elements, raw counts only, no content, everything escaped.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { buildServer } from '../../src/web/server.js';
import { insertClaim, insertEvidence, insertPosition, setupTestDb, type TestDb, VALID_CONTRACT } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.truncateAll(); });

const NOW = new Date('2027-01-02T00:00:00Z');
const app = () => buildServer({ db: t.db, now: () => NOW });
const visible = (page: string) => page.replace(/<style>[\s\S]*?<\/style>/, ''); // CSS widths aren't percentages shown to people

async function resolvedClaim(overrides: Record<string, unknown> = {}) {
  const claim = await insertClaim(t.sql, 'resolved', overrides);
  await insertPosition(t.sql, claim.id);
  const evidence = await insertEvidence(t.sql, claim.id, { value: '150001', event_date: '2026-11-03' });
  await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, outcome: 'hit', decided_by: 'evidence', review_status: 'final', decided_at: NOW.toISOString(), deciding_evidence_id: evidence.id })}`;
  return claim;
}

describe('claim page', () => {
  test('shows the contract, timeline, evidence, verdict, positions and the X link — and no percentages', async () => {
    const claim = await resolvedClaim();
    const res = await app().inject(`/c/${claim.slug}`);
    assert.equal(res.statusCode, 200);
    const page = res.body;
    for (const needed of [
      VALID_CONTRACT.criterion, VALID_CONTRACT.negative_condition, VALID_CONTRACT.source.name, '2026-12-31 23:59 UTC',
      'Recorded', 'Locks', 'Resolved', '/i/status/', 'coinbase', 'primary', 'passed', '150001', 'HIT', 'the evidence', '/u/200', 'author',
    ]) assert.ok(page.includes(needed), `missing: ${needed}`);
    assert.ok(!visible(page).includes('%'), 'no percentages');
    assert.ok(!page.includes('<script'), 'no client JS');
  });

  test('a contract field with markup is escaped, never executed', async () => {
    const contract = { ...VALID_CONTRACT, criterion: '<script>alert(1)</script> & "quotes"' };
    const claim = await insertClaim(t.sql, 'locked', { contract: JSON.stringify(contract) });
    const page = (await app().inject(`/c/${claim.slug}`)).body;
    assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;'));
    assert.ok(!page.includes('<script>alert'));
  });

  test('an expired claim says it was never locked or judged', async () => {
    const claim = await insertClaim(t.sql, 'expired');
    assert.match((await app().inject(`/c/${claim.slug}`)).body, /never locked, not judged/);
  });

  test('no contract (needs info, rejected) or unknown slug → 404', async () => {
    const needsInfo = await insertClaim(t.sql, 'needs_info');
    assert.equal((await app().inject(`/c/${needsInfo.slug}`)).statusCode, 404);
    assert.equal((await app().inject('/c/zzzzz')).statusCode, 404);
  });
});

describe('author page', () => {
  test('raw counts and derived results only', async () => {
    await resolvedClaim();
    const locked = await insertClaim(t.sql, 'locked');
    await insertPosition(t.sql, locked.id);
    const res = await app().inject('/u/200');
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /2 recorded · 1 resolved · <span class="hit">1 right<\/span> · <span class="miss">0 wrong<\/span> · <span class="void">0 void<\/span>/);
    assert.ok(!visible(res.body).includes('%'), 'no percentages');
  });

  test('unknown or malformed user → 404', async () => {
    assert.equal((await app().inject('/u/999')).statusCode, 404);
    assert.equal((await app().inject('/u/not-a-number')).statusCode, 404);
  });
});

describe('health and routes', () => {
  test('/healthz reports the database, due claims and the review queue', async () => {
    await insertClaim(t.sql, 'locked', { next_check_at: '2027-01-01T00:00:00Z' });
    const res = await app().inject('/healthz');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual([body.ok, body.db, body.claims_due, body.oldest_due_age_min, body.needs_human], [true, 'up', 1, 1440, 0]);
  });

  test('no admin or write routes', async () => {
    assert.equal((await app().inject({ method: 'POST', url: '/c/abcde' })).statusCode, 404);
    assert.equal((await app().inject('/admin')).statusCode, 404);
  });
});
