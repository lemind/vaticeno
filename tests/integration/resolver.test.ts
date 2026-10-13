import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { type Candle, type Coinbase, FeedUnavailable } from '../../src/feeds/coinbase.js';
import { type LlmClient, LlmSchemaError } from '../../src/llm/client.js';
import { SourceUnavailable } from '../../src/resolve/fetch.js';
import { decideByHuman, listNeedsHuman } from '../../src/resolve/manual.js';
import { type ResolverDeps, resolveDueClaims } from '../../src/resolve/resolver.js';
import { recheckClaim, recheckRecent, rejudgeClaim, writeCorrection } from '../../src/resolve/recheck.js';
import type { EventIdentity } from '../../src/resolve/relevance.js';
import { insertClaim, setupTestDb, type TestDb, VALID_CONTRACT } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.truncateAll(); });

const LOCK = '2026-10-01T12:00:00Z';
const DEADLINE = '2026-10-05T23:59:59Z';
const AFTER = new Date('2026-10-06T01:00:00Z');

const WEB_CONTRACT = {
  ...VALID_CONTRACT,
  resolution_method: 'model',
  price: undefined,
  criterion: 'The FDA approves drug X for condition Y',
  deadline_at: DEADLINE,
  source: { ...VALID_CONTRACT.source, name: 'FDA approvals', kind: 'regulatory', locator: 'https://www.fda.gov/approvals' },
};

function days(from: string, n: number, close: (i: number) => number): Candle[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({ day: new Date(start + i * 86400e3).toISOString().slice(0, 10), close: close(i) }));
}

type WebPage = { says: string; quote: string | null; event_date: string | null; text: string; trust?: 'primary' | 'established' | 'weak'; identity?: EventIdentity; basis?: 'record' | 'absence'; winner?: string | null };

function deps(options: { candles?: Candle[] | 'outage'; search?: string[]; pages?: Record<string, WebPage>; down?: string[]; blocked?: string[]; badJudge?: string[]; arbiter?: 'malformed' } = {}) {
  const calls = { web: 0 };
  const coinbase = {
    productStatus: async () => { if (options.candles === 'outage') throw new FeedUnavailable('down'); return 'online'; },
    dailyCandles: async () => { if (options.candles === 'outage') throw new FeedUnavailable('down'); return options.candles ?? []; },
  } as unknown as Coinbase;
  const llm = {
    mode: 'replay',
    groundedSearch: async () => { calls.web++; return { queries: ['q'], urls: options.search ?? [], costs: [] }; },
    generateJson: async ({ input, operation }: { input: string; operation: string }) => {
      calls.web++;
      if (operation === 'arbitrate') {
        if (options.arbiter === 'malformed') throw new LlmSchemaError('bad arbiter json', [{ provider: 'gemini', operation: 'arbitrate', units: 1, usdCost: 0.002 }]);
        return { data: { decision: 'cannot_decide', deciding_index: null, outcome: null, notes: 'n' }, costs: [] };
      }
      const url = (JSON.parse(input) as { page: { url: string } }).page.url;
      if (options.badJudge?.includes(url)) throw new LlmSchemaError('bad judge json', [{ provider: 'gemini', operation: 'judge', units: 1, usdCost: 0.001 }]);
      const page = options.pages![url]!;
      return {
        data: { says: page.says, basis: page.basis ?? 'record', quote: page.quote, event_date: page.event_date, event_identity: page.identity ?? null, observed_result: page.winner === undefined ? null : { winner: page.winner, score: null }, is_final_result: true, from_contract_source: false, source_trust: page.trust ?? 'primary', trust_reason: 'why', original_source: null, reasoning: 'r' },
        costs: [{ provider: 'gemini' as const, operation: 'judge' as const, units: 1, usdCost: 0.001 }],
      };
    },
  } as unknown as LlmClient;
  const fetchPage = async (url: string) => {
    if (options.down?.includes(url)) throw new SourceUnavailable(`${url} timed out`);
    if (options.blocked?.includes(url)) throw new SourceUnavailable(`${url}: HTTP 403`, { transient: false });
    const page = options.pages?.[url];
    if (!page) throw new SourceUnavailable(`${url}: HTTP 404`, { transient: false });
    return { url, text: page.text, sha256: `sha-${url}`, simhash: null, retrievedAt: AFTER };
  };
  const resolverDeps: ResolverDeps = {
    db: t.db, llm, coinbase, fetchPage: fetchPage as ResolverDeps['fetchPage'],
    judgeModelA: 'a', judgeModelB: 'b', arbiterModel: 'c',
  };
  return { deps: resolverDeps, calls };
}

async function lockedClaim(contract: object = { ...VALID_CONTRACT, deadline_at: DEADLINE }) {
  return insertClaim(t.sql, 'locked', { contract: JSON.stringify(contract), deadline_at: DEADLINE, lock_at: LOCK, next_check_at: DEADLINE, resolution_method: (contract as { resolution_method: string }).resolution_method });
}

const claimRow = async (id: string) => (await t.sql`select status, next_check_at from claims where id = ${id}`)[0]!;
const resolutionRow = async (id: string) => (await t.sql`select * from resolutions where claim_id = ${id}`)[0];
const evidenceCount = async (id: string) => (await t.sql`select count(*)::int as n from evidences where claim_id = ${id}`)[0]!.n as number;

describe('price claims', () => {
  test('a close above the threshold → final HIT from the price feed; the web path is never called', async () => {
    const claim = await lockedClaim();
    const { deps: d, calls } = deps({ candles: days('2026-10-01', 5, (i) => (i === 3 ? 150_001 : 100_000)) });
    assert.deepEqual(await resolveDueClaims(d, AFTER), { final: 1, needs_human: 0, waiting: 0, outage: 0, failed: 0 });
    assert.equal((await claimRow(claim.id)).status, 'resolved');
    const resolution = await resolutionRow(claim.id);
    assert.deepEqual([resolution!.outcome, resolution!.decided_by, resolution!.review_status], ['hit', 'evidence', 'final']);
    const [evidence] = await t.sql`select * from evidences where id = ${resolution!.deciding_evidence_id}`;
    assert.deepEqual([evidence!.says, evidence!.trust_level, evidence!.event_date, Number(evidence!.value)], ['hit', 'primary', '2026-10-04', 150001]);
    assert.equal(calls.web, 0);
  });

  test('a feed outage writes no evidence and no verdict; the claim waits and is retried later', async () => {
    const claim = await lockedClaim();
    assert.equal((await resolveDueClaims(deps({ candles: 'outage' }).deps, AFTER)).outage, 1);
    assert.equal(await evidenceCount(claim.id), 0);
    assert.equal(await resolutionRow(claim.id), undefined);
    const row = await claimRow(claim.id);
    assert.equal(row.status, 'resolving');
    assert.ok(new Date(row.next_check_at).getTime() > AFTER.getTime(), 'pushed back');
    assert.equal((await resolveDueClaims(deps({ candles: 'outage' }).deps, AFTER)).outage, 0, 'not due again yet');
  });

  test('a gap that could hide the answer is never MISS: the claim waits', async () => {
    const claim = await lockedClaim();
    const gappy = days('2026-10-01', 5, () => 100_000).filter((c) => c.day !== '2026-10-03');
    assert.equal((await resolveDueClaims(deps({ candles: gappy }).deps, AFTER)).waiting, 1);
    assert.equal(await resolutionRow(claim.id), undefined);
  });

  test('one resolution per claim across repeated runs', async () => {
    const claim = await lockedClaim();
    const d = deps({ candles: days('2026-10-01', 5, () => 100_000) }).deps;
    await resolveDueClaims(d, AFTER);
    await resolveDueClaims(d, new Date('2026-10-20T00:00:00Z'));
    assert.equal((await resolutionRow(claim.id))!.outcome, 'miss');
    assert.equal(await evidenceCount(claim.id), 1);
  });
});

describe('web claims', () => {
  const fda = 'https://www.fda.gov/approvals';
  const reuters = 'https://www.reuters.com/fda-approves-x';
  const wire = 'https://apnews.com/fda-approves-x';
  const quote = 'FDA approved drug X for condition Y';

  test('the contract record (primary) confirming → final HIT', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const pages = { [fda]: { says: 'hit', quote, event_date: '2026-10-03', text: `Today the ${quote} in adults.` } };
    assert.equal((await resolveDueClaims(deps({ pages }).deps, AFTER)).final, 1);
    assert.equal((await resolutionRow(claim.id))!.outcome, 'hit');
  });

  test('a quote not on the page fails the gate and does not count', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const pages = { [fda]: { says: 'hit', quote, event_date: '2026-10-03', text: 'Nothing about that here.' } };
    await resolveDueClaims(deps({ pages }).deps, AFTER);
    assert.equal(await resolutionRow(claim.id), undefined);
    const [evidence] = await t.sql`select passed, gates from evidences where claim_id = ${claim.id}`;
    assert.equal(evidence!.passed, false);
    assert.equal(evidence!.gates.quote_found, false);
  });

  test('a lone established source → needs human; the claim stays open, is not re-run, and a human decides it', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const pages = { [reuters]: { says: 'hit', quote, event_date: '2026-10-03', text: `Reuters: ${quote} on Saturday.`, trust: 'established' as const } };
    const d = deps({ search: [reuters], pages });
    assert.equal((await resolveDueClaims(d.deps, AFTER)).needs_human, 1);
    assert.equal((await claimRow(claim.id)).status, 'resolving');
    assert.equal((await resolutionRow(claim.id))!.review_status, 'needs_human');
    assert.equal((await resolveDueClaims(d.deps, new Date('2026-10-30T00:00:00Z'))).needs_human, 0, 'never re-run');

    const [flagged] = await listNeedsHuman(t.db);
    const evidenceId = flagged!.evidence.find((e) => e.says === 'hit')!.id;
    await decideByHuman(t.db, { slug: claim.slug, outcome: 'hit', decidingEvidenceId: evidenceId, note: 'Checked the FDA letter.', now: AFTER });
    const resolution = await resolutionRow(claim.id);
    assert.deepEqual([resolution!.outcome, resolution!.decided_by, resolution!.review_status], ['hit', 'human', 'final']);
    assert.equal((await claimRow(claim.id)).status, 'resolved');
    await assert.rejects(decideByHuman(t.db, { slug: claim.slug, outcome: 'miss', decidingEvidenceId: evidenceId, note: 'x', now: AFTER }), /no resolution waiting/);
  });

  test('a page rated primary off the contract source counts only as established', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const pages = { [reuters]: { says: 'hit', quote, event_date: '2026-10-03', text: `Reuters: ${quote} on Saturday.`, trust: 'primary' as const } };
    assert.equal((await resolveDueClaims(deps({ search: [reuters], pages }).deps, AFTER)).needs_human, 1);
    const [evidence] = await t.sql`select trust_level, trust_reason from evidences where claim_id = ${claim.id} and url = ${reuters}`;
    assert.deepEqual([evidence!.trust_level, evidence!.trust_reason], ['established', 'why']);
  });

  test('a final verdict adds one confirmation per agreeing site; wrong sites and re-runs add nothing', async () => {
    const pages = {
      [fda]: { says: 'hit', quote, event_date: '2026-10-03', text: `Today the ${quote} in adults.` },
      [reuters]: { says: 'hit', quote, event_date: '2026-10-03', text: `Reuters: ${quote} on Saturday.`, trust: 'established' as const },
      // Off-topic, not contradicting: a passed item that disagrees is a contradiction now and goes to the
      // arbiter, which is its own test below (001 FR-034).
      [wire]: { says: 'irrelevant', quote: 'another drug entirely', event_date: '2026-10-03', text: 'AP: a different drug today.', trust: 'established' as const },
    };
    const d = deps({ search: [reuters, wire], pages }).deps;
    await lockedClaim(WEB_CONTRACT);
    await lockedClaim(WEB_CONTRACT);
    assert.equal((await resolveDueClaims(d, AFTER)).final, 2);
    await resolveDueClaims(d, new Date('2026-10-20T00:00:00Z'));
    const rows = await t.sql`select domain, agreed_count from sources order by domain`;
    assert.deepEqual(rows.map((r) => [r.domain, r.agreed_count]), [['fda.gov', 2], ['reuters.com', 2]]);
  });

  test('a trusted page that contradicts the others no longer loses to the top tier (001 FR-034)', async () => {
    // The live defect of 2026-10-11: a primary page that did not list the match beat three outlets
    // reporting the score, and a 3-0 win went out as a MISS.
    const pages = {
      [fda]: { says: 'miss', quote, event_date: '2026-10-03', text: `Today the ${quote} in adults.` },
      [reuters]: { says: 'hit', quote, event_date: '2026-10-03', text: `Reuters: ${quote} on Saturday.`, trust: 'established' as const },
    };
    const claim = await lockedClaim(WEB_CONTRACT);
    const d = deps({ search: [reuters], pages }).deps;
    await resolveDueClaims(d, AFTER);
    const row = await resolutionRow(claim.id);
    assert.notEqual(row?.review_status, 'final', 'a contradiction is never settled by whichever tier is highest');
  });

  test('a page that times out while nothing else settles it is an outage, never a step toward VOID', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const d = deps({ search: [], down: [fda] }).deps;
    assert.equal((await resolveDueClaims(d, AFTER)).outage, 1);
    assert.equal(await evidenceCount(claim.id), 0);
    assert.equal((await resolveDueClaims(d, new Date('2026-10-20T00:00:00Z'))).outage, 1);
    assert.equal(await resolutionRow(claim.id), undefined);
  });

  test('every page blocked (403) although search found pages → outage, never "nothing found"', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    assert.equal((await resolveDueClaims(deps({ search: [reuters], blocked: [fda, reuters] }).deps, AFTER)).outage, 1);
    assert.equal(await evidenceCount(claim.id), 0);
  });

  test('one page with an unusable judge answer is skipped; the run still counts', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const pages = { [fda]: { says: 'irrelevant', quote: null, event_date: null, text: 'Unrelated page.' }, [reuters]: { says: 'hit', quote, event_date: '2026-10-03', text: 'x' } };
    assert.equal((await resolveDueClaims(deps({ search: [reuters], pages, badJudge: [reuters] }).deps, AFTER)).waiting, 1);
    assert.equal(await evidenceCount(claim.id), 1);
  });

  test('a timeout does not throw away a primary "entity gone" in the same run', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const pages = { [fda]: { says: 'entity_gone', quote: 'product withdrawn', event_date: null, text: 'The product withdrawn from the list.' } };
    assert.equal((await resolveDueClaims(deps({ search: [reuters], pages, down: [reuters] }).deps, AFTER)).waiting, 1);
    assert.equal(await evidenceCount(claim.id), 1);
  });

  test('still unreadable 30 days after the deadline → flagged for a human, no more paid retries', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const d = deps({ search: [], down: [fda] }).deps;
    assert.equal((await resolveDueClaims(d, new Date('2026-11-06T00:00:00Z'))).needs_human, 1);
    assert.equal((await resolutionRow(claim.id))!.review_status, 'needs_human');
    assert.equal((await claimRow(claim.id)).status, 'resolving');
  });

  test('an unusable arbiter answer flags the claim for a human and records the arbiter cost', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const pages = {
      [reuters]: { says: 'hit', quote, event_date: '2026-10-03', text: `Reuters: ${quote} on Saturday.`, trust: 'established' as const },
      [wire]: { says: 'miss', quote: 'rejected drug X', event_date: '2026-10-03', text: 'AP: FDA rejected drug X today.', trust: 'established' as const },
    };
    assert.equal((await resolveDueClaims(deps({ search: [reuters, wire], pages, arbiter: 'malformed' }).deps, AFTER)).needs_human, 1);
    assert.equal((await resolutionRow(claim.id))!.review_status, 'needs_human');
    const [cost] = await t.sql`select count(*)::int as n from cost_events where claim_id = ${claim.id} and operation = 'arbitrate'`;
    assert.equal(cost!.n, 1);
  });

  test('nothing found twice, 24 h apart → VOID insufficient evidence, never MISS', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const d = deps({ search: [] }).deps; // the locator also fails to load
    assert.equal((await resolveDueClaims(d, AFTER)).waiting, 1);
    const next = new Date((await claimRow(claim.id)).next_check_at);
    assert.equal((await resolveDueClaims(d, next)).final, 1);
    const resolution = await resolutionRow(claim.id);
    assert.deepEqual([resolution!.outcome, resolution!.void_reason], ['void', 'insufficient_evidence']);
    assert.equal((await claimRow(claim.id)).status, 'void');
  });
});

describe('rechecking a verdict already given (001 FR-035)', () => {
  // The live defect of 2026-10-11: a primary page that had not listed the match beat three reports of
  // the score, and a 3-0 win went out as a MISS. The evidence was right; only the rule was wrong, so
  // re-deciding from what is already stored catches it and costs nothing.
  async function wrongMiss() {
    const claim = await lockedClaim(WEB_CONTRACT);
    const run = '2026-10-06T00:00:00Z';
    const base = { claim_id: claim.id, run_at: run, source_kind: 'web', trust_level: 'established', says: 'hit', basis: 'record',
      passed: true, gates: JSON.stringify({ final: true, trusted: true, in_window: true, independent: true, quote_found: true }), retrieved_at: run };
    const [guardian] = await t.sql`insert into evidences ${t.sql({ ...base, source_name: 'theguardian.com', url: 'https://g/1', result_summary: 'City beat Liverpool 3-0' })} returning id`;
    await t.sql`insert into evidences ${t.sql({ ...base, source_name: 'independent.co.uk', url: 'https://i/1', result_summary: 'City 3-0 Liverpool' })}`;
    const [absent] = await t.sql`insert into evidences ${t.sql({ ...base, source_name: 'premierleague.com', url: 'https://p/1', trust_level: 'primary', says: 'miss', basis: 'absence',
      gates: JSON.stringify({ final: true, trusted: true, in_window: true, independent: true, quote_found: null }) })} returning id`;
    await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, outcome: 'miss', decided_by: 'evidence', review_status: 'final', deciding_evidence_id: absent!.id, decided_at: run })}`;
    return { claim, guardian: guardian!.id as string };
  }

  test('a verdict the old rules got wrong is found, and correcting it is a separate step', async () => {
    const { claim, guardian } = await wrongMiss();
    const check = (await recheckClaim(t.db, claim.slug, AFTER))!;
    assert.equal(check.was, 'miss');
    // The stored absence row disagrees with the records that now decide it, which is reported (004 FR-008).
    assert.deepEqual(check.now, { kind: 'final', outcome: 'hit', decidingEvidenceId: guardian, absenceDisagreed: true });
    assert.equal(check.differs, true);
    // Finding it changes nothing on its own: the published verdict stands until someone says so.
    assert.equal((await resolutionRow(claim.id))!.outcome, 'miss');
    assert.equal((await t.sql`select count(*)::int as n from corrections`)[0]!.n, 0);

    assert.equal(await writeCorrection(t.db, claim.slug, check, 'an absence outranked three reports'), true);
    const [correction] = await t.sql`select from_outcome, to_outcome, posted_tweet_id from corrections where claim_id = ${claim.id}`;
    assert.deepEqual([correction!.from_outcome, correction!.to_outcome, correction!.posted_tweet_id], ['miss', 'hit', null]);
    // The original verdict is frozen and stays: the record shows both (001 FR-035).
    assert.equal((await resolutionRow(claim.id))!.outcome, 'miss');
  });

  test('the weekly sweep reports and never writes, and skips what it already corrected', async () => {
    const { claim } = await wrongMiss();
    const found = await recheckRecent(t.db, AFTER, 7);
    assert.deepEqual(found.filter((r) => r.differs).map((r) => r.slug), [claim.slug]);
    assert.equal((await t.sql`select count(*)::int as n from corrections`)[0]!.n, 0, 'a sweep never corrects on its own');

    // The finding outlives the sweep's window, so a verdict known to be wrong keeps saying so (003 FR-007a).
    const [finding] = await t.sql`select published_outcome, recheck_outcome, kind, cleared_at from recheck_findings where claim_id = ${claim.id}`;
    assert.deepEqual([finding!.published_outcome, finding!.recheck_outcome, finding!.kind, finding!.cleared_at], ['miss', 'hit', 'differs', null]);

    await writeCorrection(t.db, claim.slug, found[0]!, 'tested');
    assert.deepEqual((await recheckRecent(t.db, AFTER, 7)).map((r) => r.slug), [], 'a corrected claim is not raised again');
    // Cleared, never deleted: the row is the record that the loop closed.
    const [answered] = await t.sql`select cleared_at from recheck_findings where claim_id = ${claim.id}`;
    assert.ok(answered?.cleared_at, 'a correction answers the finding');
  });

  // 004 T415a. A free recheck re-reads stored answers, so it can only catch a rule that was wrong. The
  // racing verdict was wrong because the page was judged against another race — only fetching and judging
  // again can find that, and it costs money, so nothing schedules it.
  test('a re-judge fetches and judges again, and leaves the published verdict frozen', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const stale = '2026-10-06T00:00:00Z';
    const [old] = await t.sql`insert into evidences ${t.sql({ claim_id: claim.id, run_at: stale, source_kind: 'web', source_name: 'old.example', trust_level: 'primary', says: 'miss', basis: 'record', passed: true, gates: JSON.stringify({ final: true, trusted: true, in_window: true, independent: true, quote_found: true }), retrieved_at: stale, event_date: '2026-10-03' })} returning id`;
    await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, outcome: 'miss', decided_by: 'evidence', review_status: 'final', deciding_evidence_id: old!.id, decided_at: stale })}`;

    const url = 'https://www.fda.gov/approvals/x';
    const { deps: d } = deps({ search: [url], pages: { [url]: { says: 'hit', quote: 'approved drug X', event_date: '2026-10-03', text: 'The FDA approved drug X.' } } });
    const check = (await rejudgeClaim(d, claim.slug, new Date('2026-10-07T01:00:00Z')))!;

    assert.equal(check.was, 'miss');
    assert.equal(check.now.kind, 'final');
    assert.equal(check.differs, true, 'fresh pages reach a different answer');
    assert.equal((await resolutionRow(claim.id))!.outcome, 'miss', 'the published verdict is untouched');
    assert.equal(await evidenceCount(claim.id), 2, 'the new run is written beside the old one, never over it');
    const [spend] = await t.sql`select count(*)::int as n from cost_events where claim_id = ${claim.id}`;
    assert.ok(spend!.n > 0, 'and what it cost is recorded against the claim');

    assert.equal(await writeCorrection(t.db, claim.slug, check, 'judged against the wrong race'), true);
  });

  test('a re-judge of a price claim reads the feed, not the web (review 2026-10-13)', async () => {
    const claim = await lockedClaim();
    const stale = '2026-10-06T00:00:00Z';
    const [old] = await t.sql`insert into evidences ${t.sql({ claim_id: claim.id, run_at: stale, source_kind: 'price_feed', source_name: 'coinbase', trust_level: 'primary', says: 'miss', basis: 'record', passed: true, gates: JSON.stringify({ final: true, trusted: true, in_window: true, independent: null, quote_found: null }), retrieved_at: stale, event_date: '2026-10-03' })} returning id`;
    await t.sql`insert into resolutions ${t.sql({ claim_id: claim.id, outcome: 'miss', decided_by: 'evidence', review_status: 'final', deciding_evidence_id: old!.id, decided_at: stale })}`;

    const { deps: d, calls } = deps({ candles: days('2026-10-02', 3, () => 151000) });
    const check = (await rejudgeClaim(d, claim.slug, new Date('2026-10-07T01:00:00Z')))!;
    assert.equal(calls.web, 0, 'no search, no page fetch, no judge call for a price claim');
    assert.equal(check.now.kind, 'final');
    const [row] = await t.sql`select source_kind from evidences where claim_id = ${claim.id} order by run_at desc limit 1`;
    assert.equal(row!.source_kind, 'price_feed');
  });

  test('a correction cannot be written twice, and a verdict that still stands cannot be corrected', async () => {
    const { claim } = await wrongMiss();
    const check = (await recheckClaim(t.db, claim.slug, AFTER))!;
    assert.equal(await writeCorrection(t.db, claim.slug, check, 'first'), true);
    assert.equal(await writeCorrection(t.db, claim.slug, check, 'second'), false);
    assert.equal(await writeCorrection(t.db, claim.slug, { ...check, differs: false }, 'no'), false);
  });
});

describe('a page must be about the contract\'s own event (004 FR-002, FR-003)', () => {
  // The live failure of 2026-10-12. Four pages, three of them the official record. The meeting landing page
  // showed Race 1 and was judged "did not participate"; the page naming Race 2 was dropped for sharing its
  // domain. The claim was published MISS for a horse that won.
  const RACE_CONTRACT = {
    ...WEB_CONTRACT,
    criterion: 'Sunny Q wins Race 2 at Sha Tin on October 4, 2026',
    source: { ...WEB_CONTRACT.source, name: 'HKJC', kind: 'sports_results', locator: 'https://racing.hkjc.com/results', entity_id: 'Sha Tin Race 2 2026-10-04' },
  };
  const LANDING = 'https://racing.hkjc.com/localresults';
  const EXACT = 'https://racing.hkjc.com/resultsall?racedate=2026/10/04';
  const OUTLET = 'https://www.sportinglife.com/racing/results/2026-10-04/sha-tin/kam-tin-handicap';

  const pages = {
    [LANDING]: { says: 'miss', quote: 'SHINYU KOKOROE', event_date: '2026-10-04', text: 'SHINYU KOKOROE won Race 1', identity: { date: '2026-10-04', competition: 'Sha Tin', round: 'Race 1', venue: 'Sha Tin', participants: ['SHINYU KOKOROE'] } },
    [EXACT]: { says: 'hit', quote: 'Sunny Q won Race 2', event_date: '2026-10-04', text: 'Sunny Q won Race 2', identity: { date: '2026-10-04', competition: 'Sha Tin', round: 'Race 2', venue: 'Sha Tin', participants: ['Sunny Q'] } },
    [OUTLET]: { says: 'hit', quote: 'Sunny Q won the Kam Tin Handicap', event_date: '2026-10-04', text: 'Sunny Q won the Kam Tin Handicap', trust: 'established' as const, identity: { date: '2026-10-04', competition: 'Sha Tin', round: null, venue: 'Sha Tin', participants: ['Sunny Q'] } },
  };

  test('the page showing another race decides nothing, and the right one settles it', async () => {
    const claim = await lockedClaim(RACE_CONTRACT);
    const { deps: d } = deps({ search: [LANDING, EXACT, OUTLET], pages });
    assert.equal((await resolveDueClaims(d, AFTER)).final, 1);

    const rows = await t.sql`select id, url, says, event_match, passed, gates from evidences where claim_id = ${claim.id} order by url`;
    const by = (url: string) => rows.find((r) => r.url === url)!;
    assert.equal(by(LANDING).event_match, 'no');
    assert.equal(by(LANDING).passed, false, 'a Race 1 page cannot answer a Race 2 claim');
    assert.equal(by(LANDING).says, 'miss', 'what it said is still stored, with the reason it did not count');
    assert.equal(by(LANDING).gates.relevant, false);

    assert.equal(by(EXACT).event_match, 'yes');
    assert.equal(by(EXACT).passed, true, 'and it is no longer dropped as a copy of the page that beat it');

    // The outlet named the race only by its title, so it cannot be placed: conservative, and not needed.
    assert.equal(by(OUTLET).event_match, 'unknown');
    assert.equal(by(OUTLET).passed, false);

    const resolution = await resolutionRow(claim.id);
    assert.equal(resolution!.outcome, 'hit', 'the verdict that was published as a MISS');
    assert.equal(resolution!.deciding_evidence_id, by(EXACT).id);
  });

  test('the same pages in reverse order reach the same verdict (SC-002)', async () => {
    const claim = await lockedClaim(RACE_CONTRACT);
    const { deps: d } = deps({ search: [OUTLET, EXACT, LANDING], pages });
    assert.equal((await resolveDueClaims(d, AFTER)).final, 1);
    const resolution = await resolutionRow(claim.id);
    assert.equal(resolution!.outcome, 'hit', 'the verdict no longer depends on which page was read first');
    const [deciding] = await t.sql`select url from evidences where id = ${resolution!.deciding_evidence_id}`;
    assert.equal(deciding!.url, EXACT);
  });

  test('two pages of the official record that disagree go to the arbiter, not to whichever won (FR-008a)', async () => {
    const claim = await lockedClaim(RACE_CONTRACT);
    const other = 'https://racing.hkjc.com/resultsall?racedate=2026/10/04&alt';
    const conflicting = {
      ...pages,
      [other]: { says: 'miss', quote: 'Sunny Q was unplaced in Race 2', event_date: '2026-10-04', text: 'Sunny Q was unplaced in Race 2', identity: { date: '2026-10-04', competition: 'Sha Tin', round: 'Race 2', venue: 'Sha Tin', participants: ['Sunny Q'] } },
    };
    const { deps: d } = deps({ search: [EXACT, other], pages: conflicting });
    const run = await resolveDueClaims(d, AFTER);
    assert.deepEqual([run.final, run.needs_human], [0, 1], 'the arbiter could not decide, so a human is asked');
    const rows = await t.sql`select url, passed from evidences where claim_id = ${claim.id} and passed = true order by url`;
    assert.equal(rows.length, 2, 'neither page was dropped to make the conflict go away');
  });

  // 004 FR-007: the live rows that produced two wrong MISS verdicts. The official page had not listed the
  // match; that silence outranked three outlets reporting the score.
  test('silence from an official page no longer decides anything (FR-007)', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const fixtures = 'https://www.premierleague.com/matches';
    const guardian = 'https://www.theguardian.com/football/x';
    const sky = 'https://www.skysports.com/football/y';
    const { deps: d } = deps({
      search: [fixtures, guardian, sky],
      pages: {
        [fixtures]: { says: 'miss', quote: null, event_date: null, text: 'Fixtures', basis: 'absence', trust: 'primary' },
        [guardian]: { says: 'hit', quote: 'City beat Liverpool 3-0', event_date: '2026-10-03', text: 'City beat Liverpool 3-0' },
        [sky]: { says: 'hit', quote: 'Man City 3-0 Liverpool', event_date: '2026-10-03', text: 'Man City 3-0 Liverpool' },
      },
    });
    assert.equal((await resolveDueClaims(d, AFTER)).final, 1);

    const rows = await t.sql`select url, basis, passed, gates from evidences where claim_id = ${claim.id}`;
    const absence = rows.find((r) => r.basis === 'absence')!;
    assert.equal(absence.passed, false, 'no endpoint is recorded as a complete record, so silence proves nothing');
    assert.deepEqual([absence.gates.in_window, absence.gates.quote_found], [false, false], 'and it is held to the quote like any page');
    assert.equal((await resolutionRow(claim.id))!.outcome, 'hit', 'the verdict that was published as a MISS');
  });

  // 004 FR-009: the third stored row of the racing run said `miss` beside "Sunny Q won the Kam Tin Handicap".
  test('a reading that contradicts its own result counts for nothing (FR-009)', async () => {
    const claim = await lockedClaim({ ...RACE_CONTRACT, subject: 'Sunny Q' });
    const article = 'https://racingnews.hkjc.com/english/2026/10/04/david-hall-700-wins';
    const { deps: d } = deps({
      search: [article],
      pages: {
        [article]: {
          says: 'miss', quote: 'Sunny Q won the Class 5 Kam Tin Handicap', event_date: '2026-10-04',
          text: 'Sunny Q won the Class 5 Kam Tin Handicap (1000m).', trust: 'primary', winner: 'Sunny Q',
          identity: { date: '2026-10-04', competition: 'Sha Tin', round: 'Race 2', venue: 'Sha Tin', participants: ['Sunny Q'] },
        },
      },
    });
    assert.equal((await resolveDueClaims(d, AFTER)).final, 0, 'it cannot settle the claim on a reading that argues with itself');
    const [row] = await t.sql`select passed, gates from evidences where claim_id = ${claim.id}`;
    assert.equal(row!.gates.consistent, false);
    assert.equal(row!.passed, false);
  });

  // 004 FR-013. Measured in production on 2026-10-12: 47 judge calls over 47 judged pages, mean $0.0662 a
  // claim, worst $0.0843. The new fields ride on the call that was already paid for; nothing judges twice.
  test('each page is judged exactly once, whatever the new fields ask for (FR-013)', async () => {
    await lockedClaim(RACE_CONTRACT);
    let judged = 0;
    const { deps: d } = deps({ search: [LANDING, EXACT, OUTLET], pages });
    const counted = { ...d, llm: { ...d.llm, generateJson: async (args: { operation: string; input: string }) => {
      if (args.operation === 'judge') judged++;
      return d.llm.generateJson(args as never);
    } } } as typeof d;
    await resolveDueClaims(counted, AFTER);
    assert.equal(judged, 3, 'three pages, three readings — no second pass');
  });

  test('a claim whose contract names no round or day is judged as before', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const url = 'https://www.fda.gov/approvals/x';
    const { deps: d } = deps({ search: [url], pages: { [url]: { says: 'hit', quote: 'approved', event_date: '2026-10-03', text: 'approved' } } });
    assert.equal((await resolveDueClaims(d, AFTER)).final, 1);
    const [row] = await t.sql`select event_match, passed from evidences where claim_id = ${claim.id}`;
    assert.equal(row!.event_match, 'not_applicable', 'nothing to compare: the judge\'s own answer stands');
    assert.equal(row!.passed, true);
  });
});

