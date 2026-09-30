import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { type Candle, type Coinbase, FeedUnavailable } from '../../src/feeds/coinbase.js';
import type { LlmClient } from '../../src/llm/client.js';
import { decideByHuman, listNeedsHuman } from '../../src/resolve/manual.js';
import { type ResolverDeps, resolveDueClaims } from '../../src/resolve/resolver.js';
import { loadSourcePolicy } from '../../src/resolve/trust.js';
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

type WebPage = { says: string; quote: string | null; event_date: string | null; text: string };

function deps(options: { candles?: Candle[] | 'outage'; search?: string[]; pages?: Record<string, WebPage> } = {}) {
  const calls = { web: 0 };
  const coinbase = {
    productStatus: async () => { if (options.candles === 'outage') throw new FeedUnavailable('down'); return 'online'; },
    dailyCandles: async () => { if (options.candles === 'outage') throw new FeedUnavailable('down'); return options.candles ?? []; },
  } as unknown as Coinbase;
  const llm = {
    mode: 'replay',
    groundedSearch: async () => { calls.web++; return { queries: ['q'], urls: options.search ?? [], costs: [] }; },
    generateJson: async ({ input }: { input: string }) => {
      calls.web++;
      const url = (JSON.parse(input) as { page: { url: string } }).page.url;
      const page = options.pages![url]!;
      return {
        data: { says: page.says, basis: 'record', quote: page.quote, event_date: page.event_date, is_final_result: true, from_contract_source: false, original_source: null, reasoning: 'r' },
        costs: [{ provider: 'gemini' as const, operation: 'judge' as const, units: 1, usdCost: 0.001 }],
      };
    },
  } as unknown as LlmClient;
  const fetchPage = async (url: string) => {
    const page = options.pages?.[url];
    if (!page) throw new Error('not found');
    return { url, text: page.text, sha256: `sha-${url}`, simhash: null, retrievedAt: AFTER };
  };
  const resolverDeps: ResolverDeps = {
    db: t.db, llm, coinbase, fetchPage: fetchPage as ResolverDeps['fetchPage'], policy: loadSourcePolicy(),
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
    assert.deepEqual([evidence!.says, evidence!.trust_level, evidence!.event_date, Number(evidence!.value)], ['hit', 'official', '2026-10-04', 150001]);
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
  const official = 'https://www.fda.gov/approvals';
  const trusted = 'https://www.reuters.com/fda-approves-x';
  const quote = 'FDA approved drug X for condition Y';

  test('the contract record (official) confirming → final HIT', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const pages = { [official]: { says: 'hit', quote, event_date: '2026-10-03', text: `Today the ${quote} in adults.` } };
    assert.equal((await resolveDueClaims(deps({ pages }).deps, AFTER)).final, 1);
    assert.equal((await resolutionRow(claim.id))!.outcome, 'hit');
  });

  test('a quote not on the page fails the gate and does not count', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const pages = { [official]: { says: 'hit', quote, event_date: '2026-10-03', text: 'Nothing about that here.' } };
    await resolveDueClaims(deps({ pages }).deps, AFTER);
    assert.equal(await resolutionRow(claim.id), undefined);
    const [evidence] = await t.sql`select passed, gates from evidences where claim_id = ${claim.id}`;
    assert.equal(evidence!.passed, false);
    assert.equal(evidence!.gates.quote_found, false);
  });

  test('a lone trusted source → needs human; the claim stays open, is not re-run, and a human decides it', async () => {
    const claim = await lockedClaim(WEB_CONTRACT);
    const pages = { [trusted]: { says: 'hit', quote, event_date: '2026-10-03', text: `Reuters: ${quote} on Saturday.` } };
    const d = deps({ search: [trusted], pages });
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
