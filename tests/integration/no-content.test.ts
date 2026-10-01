// SC-008 / FR-029: after a full claim life (post → needs info → fix → lock → web resolution), no post text,
// quote or page text is anywhere in the database or the logs. Uses stub models (no paid runs).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Proposal } from '../../src/contract/proposal.js';
import type { Coinbase } from '../../src/feeds/coinbase.js';
import { amendClaim, type ClaimDeps, submitClaim } from '../../src/lifecycle/claims.js';
import { lockDueDrafts } from '../../src/lifecycle/lock.js';
import { createMemorySourceReader } from '../../src/lifecycle/source-reader.js';
import type { LlmClient } from '../../src/llm/client.js';
import { resolveDueClaims } from '../../src/resolve/resolver.js';
import { setupTestDb, type TestDb, VALID_CONTRACT } from './helpers.js';

let t: TestDb;
before(async () => { t = await setupTestDb(); });
after(async () => { await t.close(); });

const POST = 'zebracorn says the FDA will approve drug X, trust me';
const FIX = 'quokkafix: FDA approves drug X for condition Y by 2026-10-05';
const PAGE = 'Wombatpage news. Today the FDA approved drug X for condition Y in adults after review.';
const QUOTE = 'FDA approved drug X for condition Y';
const MARKERS = ['zebracorn', 'quokkafix', 'Wombatpage', QUOTE];

const CONTRACT = {
  ...VALID_CONTRACT, resolution_method: 'model', price: undefined, criterion: 'The FDA approves drug X for condition Y',
  deadline_at: '2026-10-05T23:59:59Z',
  source: { ...VALID_CONTRACT.source, name: 'FDA approvals', kind: 'regulatory', locator: 'https://www.fda.gov/approvals' },
};

const llm = {
  mode: 'replay',
  generateJson: async ({ input, operation }: { input: string; operation?: string }) => {
    const parsed = JSON.parse(input) as { text?: string; page?: { url: string } };
    if (operation === 'judge') {
      return {
        data: { says: 'hit', basis: 'record', quote: QUOTE, event_date: '2026-10-03', is_final_result: true, from_contract_source: true, source_trust: 'primary', trust_reason: 'the regulator itself', original_source: null, reasoning: 'approved' },
        costs: [],
      };
    }
    const unclear = parsed.text?.startsWith('zebracorn');
    const data: Proposal = unclear
      ? { is_prediction: true, x_rules_ok: true, contract: null, unclear: ['deadline'], unclear_explanation: 'No date given.', examples: [], self_confidence: 0.3 }
      : { is_prediction: true, x_rules_ok: true, contract: CONTRACT as Proposal['contract'], unclear: [], unclear_explanation: '', examples: [], self_confidence: 0.8 };
    return { data, costs: [] };
  },
  groundedSearch: async () => ({ queries: ['fda drug x approval'], urls: [], costs: [] }),
} as unknown as LlmClient;

test('no post text, quote or page text in any column or log line', async () => {
  const logged: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    logged.push(String(chunk));
    return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    const deps: ClaimDeps = { db: t.db, llm, coinbase: { productStatus: async () => 'online' } as unknown as Coinbase, normalizerModel: 'm' };
    const reader = createMemorySourceReader({ '42': { versionId: 'v1', text: POST } });
    const at = (iso: string) => new Date(iso);

    const { slug } = await submitClaim(deps, { text: POST, authorId: '200', sourceTweetId: '42', summonTweetId: '43', sourceVersion: 'v1', now: at('2026-10-01T10:00:00Z') });
    assert.equal((await amendClaim({ ...deps, reader }, { slug: slug!, authorId: '200', text: FIX, now: at('2026-10-01T10:05:00Z') })).outcome, 'recorded');
    assert.equal((await lockDueDrafts({ ...deps, reader }, at('2026-10-01T10:20:00Z')))[0]!.outcome, 'locked');
    const fetchPage = async (url: string) => ({ url, text: PAGE, sha256: 'sha', simhash: null, retrievedAt: at('2026-10-06T01:00:00Z') });
    const summary = await resolveDueClaims({ ...deps, fetchPage: fetchPage as never, judgeModelA: 'a', judgeModelB: 'b', arbiterModel: 'c' }, at('2026-10-06T01:00:00Z'));
    assert.equal(summary.final, 1, 'the claim went all the way to a verdict');
  } finally {
    process.stdout.write = write;
  }

  const columns = await t.sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and table_name not like '__drizzle%' and data_type in ('text', 'jsonb', 'character varying')`;
  assert.ok(columns.length > 10, 'scanned the real schema');
  for (const { table_name, column_name } of columns) {
    const rows = await t.sql`select ${t.sql(column_name)}::text as v from ${t.sql(table_name)} where ${t.sql(column_name)} is not null`;
    for (const { v } of rows) {
      for (const marker of MARKERS) assert.ok(!String(v).includes(marker), `${table_name}.${column_name} holds "${marker}"`);
    }
  }
  const allLogs = logged.join('');
  assert.ok(allLogs.includes('claim.locked'), 'logs were captured');
  for (const marker of MARKERS) assert.ok(!allLogs.includes(marker), `a log line holds "${marker}"`);
});
