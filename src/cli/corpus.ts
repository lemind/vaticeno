// npm run corpus -- [--group <name>] [--model <id>]
// Runs every fixture through proposal + checks (no DB) and reports expected vs actual (FR-006, SC-001).
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runChecks } from '../contract/checks.js';
import { renderStatement } from '../contract/render.js';
import { createCoinbase } from '../feeds/coinbase.js';
import { createLlmClient } from '../llm/client.js';
import { proposeContract } from '../llm/normalize.js';
import { createReplayStore } from '../llm/replay.js';
import { buildNeedsInfoReply } from '../replies/needs-info.js';
import { fallbackExample, needsInfoReply, recordedReply, weightedLength, X_MAX_CHARS } from '../replies/templates.js';
import { cliArgs, printJson, runCli } from './run.js';

const CORPUS_DIR = fileURLToPath(new URL('../../fixtures/corpus', import.meta.url));
const PASS_RATE = 0.9;
const CONCURRENCY = 4;

const FixtureSchema = z.object({
  id: z.string(),
  group: z.string(),
  today: z.iso.date(),
  text: z.string().min(1),
  expected: z.enum(['recorded', 'needs_info', 'rejected']),
  expect_contract: z.record(z.string(), z.unknown()).optional(), // dotted paths into the contract
});
type Fixture = z.infer<typeof FixtureSchema>;

await runCli('corpus', async (config) => {
  const { values } = cliArgs({ group: { type: 'string' }, model: { type: 'string' } });
  const model = values.model ?? config.NORMALIZER_MODEL;
  const store = createReplayStore();
  const llm = createLlmClient({ mode: config.LLM_MODE, apiKey: config.GEMINI_API_KEY, store });
  const coinbase = createCoinbase({ mode: config.LLM_MODE, store });

  const fixtures = (await loadFixtures()).filter((f) => !values.group || f.group === values.group);
  if (fixtures.length === 0) throw new Error('no fixtures matched');

  const results = await mapLimit(fixtures, CONCURRENCY, async (fixture) => {
    const now = new Date(`${fixture.today}T12:00:00Z`);
    const proposed = await proposeContract(llm, model, fixture.text, fixture.today);
    const usd = proposed.costs.reduce((sum, c) => sum + c.usdCost, 0);
    if (proposed.kind === 'malformed') {
      return report(fixture, 'needs_info', [], weightedLength(needsInfoReply('', fallbackExample(now))), [], usd);
    }
    const checked = runChecks(proposed.proposal, now, { sourcePostClaimed: false });
    if (checked.outcome === 'recorded') {
      const mismatches = contractMismatches(checked.contract, fixture.expect_contract ?? {});
      return report(fixture, 'recorded', [], weightedLength(recordedReply('abcde', renderStatement(checked.contract))), mismatches, usd);
    }
    if (checked.outcome === 'needs_info') {
      const built = await buildNeedsInfoReply({ llm, coinbase, normalizerModel: model }, { text: fixture.text, proposal: proposed.proposal, explanation: proposed.proposal.unclear_explanation, now });
      const sc005 = needsInfoQuality(built.reply, proposed.proposal.unclear_explanation, built.example, now);
      const total = usd + built.costs.reduce((sum, c) => sum + c.usdCost, 0);
      return { ...report(fixture, 'needs_info', checked.unclear, weightedLength(built.reply), [], total), sc005 };
    }
    return report(fixture, 'rejected', [], 0, [], usd, checked.reason);
  });

  for (const line of results) printJson(line);

  const byGroup: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    byGroup[r.group] ??= { total: 0, passed: 0 };
    byGroup[r.group]!.total++;
    if (r.pass) byGroup[r.group]!.passed++;
  }
  // SC-005: every needs-info reply names what is unclear, has a checked example, the amend format, ≤ 280.
  const needsInfo = results.flatMap((r) => ('sc005' in r && r.sc005 ? [r.sc005] : []));
  const sc005 = {
    replies: needsInfo.length,
    all_ok: needsInfo.filter((q) => q.names_unclear && q.checked_example && q.amend_format && q.fits).length,
    generated_example: needsInfo.filter((q) => q.generated_example).length,
  };
  const passed = results.filter((r) => r.pass).length;
  const passRate = passed / results.length;
  printJson({
    total: results.length, passed, pass_rate: Number(passRate.toFixed(3)), model, mode: config.LLM_MODE,
    usd_cost: Number(results.reduce((sum, r) => sum + r.usd_cost, 0).toFixed(4)), sc005, by_group: byGroup,
  });
  if (passRate < PASS_RATE || sc005.all_ok < sc005.replies) process.exitCode = 1;
});

function report(fixture: Fixture, actual: string, unclear: string[], replyChars: number, mismatches: string[], usd: number, reason?: string) {
  const pass = actual === fixture.expected && mismatches.length === 0;
  return {
    fixture_id: fixture.id, group: fixture.group, expected: fixture.expected, actual, pass,
    ...(reason ? { reason } : {}), ...(unclear.length ? { unclear } : {}), ...(mismatches.length ? { mismatches } : {}),
    reply_chars: replyChars, usd_cost: usd,
  };
}

function needsInfoQuality(reply: string, explanation: string, example: string | null, now: Date) {
  return {
    names_unclear: explanation.trim().length > 0,
    checked_example: reply.includes(`e.g. amend ${example ?? fallbackExample(now)}`), // generated ones passed the checks
    generated_example: example !== null,
    amend_format: reply.includes('amend <what happens> by <YYYY-MM-DD>'),
    fits: weightedLength(reply) <= X_MAX_CHARS,
  };
}

function contractMismatches(contract: unknown, expected: Record<string, unknown>): string[] {
  const mismatches: string[] = [];
  for (const [path, want] of Object.entries(expected)) {
    const got = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], contract);
    if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push(`${path}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  return mismatches;
}

async function loadFixtures(): Promise<Fixture[]> {
  const files = (await readdir(CORPUS_DIR)).filter((f) => f.endsWith('.jsonl')).sort();
  const fixtures: Fixture[] = [];
  for (const file of files) {
    const lines = (await readFile(`${CORPUS_DIR}/${file}`, 'utf8')).split('\n').filter((l) => l.trim());
    lines.forEach((line, i) => {
      const parsed = FixtureSchema.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`${file}:${i + 1} ${z.prettifyError(parsed.error)}`);
      fixtures.push(parsed.data);
    });
  }
  const ids = new Set<string>();
  for (const f of fixtures) {
    if (ids.has(f.id)) throw new Error(`duplicate fixture id ${f.id}`);
    ids.add(f.id);
  }
  return fixtures;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }));
  return results;
}
