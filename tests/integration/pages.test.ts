// Public pages (US5, SC-009): required elements, raw counts only, no content, everything escaped.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { buildServer } from '../../src/web/server.js';
import {
  insertClaim,
  insertEvidence,
  insertPosition,
  setupTestDb,
  type TestDb,
  VALID_CONTRACT,
} from './helpers.js';

let t: TestDb;
before(async () => {
  t = await setupTestDb();
});
after(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.truncateAll();
});

const NOW = new Date('2027-01-02T00:00:00Z');
const app = () => buildServer({ db: t.db, now: () => NOW });
const visible = (page: string) => page.replace(/<style>[\s\S]*?<\/style>/, ''); // CSS widths aren't percentages shown to people

async function resolvedClaim(overrides: Record<string, unknown> = {}) {
  const claim = await insertClaim(t.sql, 'resolved', overrides);
  await insertPosition(t.sql, claim.id);
  const evidence = await insertEvidence(t.sql, claim.id, {
    value: '150001',
    event_date: '2026-11-03',
  });
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
      VALID_CONTRACT.criterion,
      VALID_CONTRACT.negative_condition,
      VALID_CONTRACT.source.name,
      '2026-12-31 23:59 UTC',
      'Recorded',
      'Locks',
      '/i/status/',
      'coinbase',
      'primary',
      'passed',
      '150001',
      'HIT',
      'the evidence',
      '/u/200',
      'author',
      '2026-11-03',
      '2027-01-01 01:00 UTC', // event date, read at
    ])
      assert.ok(page.includes(needed), `missing: ${needed}`);
    assert.match(page, /<dt>Resolved<\/dt><dd>2027-01-02 00:00 UTC<\/dd>/);
    assert.match(
      page,
      /href="#e-[0-9a-f-]+">see below/,
      'links to the deciding answer',
    );
    assert.ok(!visible(page).includes('%'), 'no percentages');
    assert.ok(!page.includes('<script'), 'no client JS');
  });

  test('a contract field with markup is escaped, never executed', async () => {
    const contract = {
      ...VALID_CONTRACT,
      criterion: '<script>alert(1)</script> & "quotes"',
    };
    const claim = await insertClaim(t.sql, 'locked', {
      contract: JSON.stringify(contract),
    });
    const page = (await app().inject(`/c/${claim.slug}`)).body;
    assert.ok(
      page.includes(
        '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;',
      ),
    );
    assert.ok(!page.includes('<script>alert'));
  });

  test('a non-web evidence link is shown as text, never as a link (contract links are https-only by schema)', async () => {
    const claim = await insertClaim(t.sql, 'locked');
    await insertEvidence(t.sql, claim.id, {
      url: 'javascript:alert(2)',
      source_kind: 'web',
      source_name: 'evil.example',
    });
    const page = (await app().inject(`/c/${claim.slug}`)).body;
    assert.ok(!/href="javascript:/i.test(page));
    assert.ok(page.includes('evil.example'), 'shown as plain text');
  });

  test('an expired claim says it was never locked or judged', async () => {
    const claim = await insertClaim(t.sql, 'expired');
    assert.match(
      (await app().inject(`/c/${claim.slug}`)).body,
      /never locked, not judged/,
    );
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
    assert.match(
      res.body,
      /2 recorded · 1 resolved · <span class="hit">1 right<\/span> · <span class="miss">0 wrong<\/span> · <span class="void">0 void<\/span>/,
    );
    assert.ok(!visible(res.body).includes('%'), 'no percentages');
  });

  // Both pages read the correction, not only the frozen resolution: a verdict corrected on X and still
  // wrong on the site would be worse than not correcting it (001 FR-035).
  test('a corrected verdict shows what it is now, says what it was, and counts as the new outcome', async () => {
    const claim = await insertClaim(t.sql, 'resolved');
    await insertPosition(t.sql, claim.id);
    const evidence = await insertEvidence(t.sql, claim.id, { says: 'hit' });
    await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, outcome: 'miss', decided_by: 'evidence', review_status: 'final', decided_at: NOW.toISOString(), deciding_evidence_id: evidence.id })}`;
    await t.sql`insert into corrections ${t.sql({ claim_id: claim.id, from_outcome: 'miss', to_outcome: 'hit', reason: 'an absence outranked three reports', decided_by: 'evidence' })}`;

    const page = (await app().inject(`/c/${claim.slug}`)).body;
    assert.match(page, /<dt>Outcome<\/dt><dd>HIT/);
    assert.match(
      page,
      /<dt>Corrected<\/dt><dd>[^<]*was MISS: an absence outranked three reports/,
    );
    assert.match(
      (await app().inject('/u/200')).body,
      /<span class="hit">1 right<\/span> · <span class="miss">0 wrong<\/span>/,
    );
  });

  test('unknown or malformed user → 404', async () => {
    assert.equal((await app().inject('/u/999')).statusCode, 404);
    assert.equal((await app().inject('/u/not-a-number')).statusCode, 404);
  });
});

describe('health and routes', () => {
  test('/healthz reports the database, due claims and the review queue', async () => {
    await insertClaim(t.sql, 'locked', { next_check_at: '2027-01-01T00:00:00Z' });
    const flagged = await insertClaim(t.sql, 'resolving', {
      next_check_at: '2027-01-01T00:00:00Z',
    });
    await t.sql`insert into resolutions ${t.sql({ claim_id: flagged.id, review_status: 'needs_human' })}`;
    const res = await app().inject('/healthz');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(
      [body.ok, body.db, body.claims_due, body.oldest_due_age_min, body.needs_human],
      [true, 'up', 1, 1440, 1],
    );
  });

  test('no admin or write routes', async () => {
    assert.equal(
      (await app().inject({ method: 'POST', url: '/c/abcde' })).statusCode,
      404,
    );
    assert.equal((await app().inject('/admin')).statusCode, 404);
  });
});

describe('front page', () => {
  // 003: health, version and the counts, and nothing operational — spend, job names and the verdicts we
  // know are wrong stay on the private status page (FR-004).
  // `truncateAll` leaves job_state alone — the scheduler seeds it, not a test fixture.
  beforeEach(async () => {
    await t.sql`delete from job_state`;
  });

  const seedJob = (job: string, overrides: Record<string, unknown> = {}) =>
    t.sql`insert into job_state ${t.sql({ job, stale_after_seconds: 180, ...overrides })}`;

  test('shows the version, the counts and an operational light', async () => {
    await resolvedClaim();
    await seedJob('lock', {
      last_ok_at: new Date(NOW.getTime() - 30_000).toISOString(),
      last_outcome: 'ok',
    });
    const page = visible((await app().inject({ method: 'GET', url: '/' })).body);

    assert.match(page, /operational/);
    // The account to tag, linked to its own profile.
    assert.match(
      page,
      /<a href="https:\/\/x\.com\/vaticeno" rel="noopener">@vaticeno<\/a>/,
    );
    assert.match(page, /1\.2\.0/, 'the running version is on the page');
    assert.match(page, /Predictions<\/dt>\s*<dd>1<\/dd>/);
    assert.match(page, /Verdicts<\/dt>\s*<dd>1<\/dd>/);
    for (const leak of [/spend/i, /ceiling/i, /journal/i, /stale/i]) {
      assert.doesNotMatch(page, leak, 'nothing operational on the public page');
    }
  });

  test('a job past its own window turns the light red; one that never ran does not', async () => {
    await seedJob('lock', {
      last_ok_at: new Date(NOW.getTime() - 600_000).toISOString(),
      last_outcome: 'ok',
    });
    assert.match(
      visible((await app().inject({ method: 'GET', url: '/' })).body),
      /degraded/,
    );

    await t.sql`delete from job_state`;
    // Every job reads like this right after a deploy, and a weekly one for days: not a fault.
    await seedJob('recheck', { stale_after_seconds: 1_209_660 });
    assert.match(
      visible((await app().inject({ method: 'GET', url: '/' })).body),
      /operational/,
    );
  });

  test('a failed last run turns the light red even inside the window', async () => {
    await seedJob('resolve', {
      last_ok_at: new Date(NOW.getTime() - 10_000).toISOString(),
      last_outcome: 'failed',
    });
    assert.match(
      visible((await app().inject({ method: 'GET', url: '/' })).body),
      /degraded/,
    );
  });
});
