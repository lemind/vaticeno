import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type Contract } from '../contract/schema.js';
import {
  type EscalateReason,
  FAST_PATH_THRESHOLD,
  fastPathDecision,
  VERIFIER_MODEL,
} from './fast-path.js';
import type { Gates } from './gates.js';
import type { VerifierResult } from './verifier.js';
import type { GatheredItem } from './web-evidence.js';

const WEB = {
  subject: 'drug X',
  criterion: 'The FDA approves drug X for condition Y',
  resolution_method: 'model',
} as Contract;

const GATES: Gates = {
  trusted: true,
  quote_found: true,
  in_window: true,
  final: true,
  independent: true,
  relevant: true,
  consistent: true,
};

type Page = {
  says?: 'hit' | 'miss' | 'pending' | 'irrelevant' | 'entity_gone';
  trust?: 'primary' | 'established' | 'weak';
  basis?: 'record' | 'absence';
  passed?: boolean;
  gates?: Partial<Gates>;
  answer?: VerifierResult;
};

const scored = (
  entail: number | null,
  contradict: number | null,
): VerifierResult => ({
  ok: true,
  model: VERIFIER_MODEL,
  entail,
  contradict,
  windows: 1,
  truncated: false,
  latencyMs: 5,
});
const HIT = scored(0.97, 0.01);
const MISS = scored(0.01, 0.97);

function read(page: Page = {}) {
  const says = page.says ?? 'hit';
  return {
    item: {
      draft: {
        says,
        basis: page.basis ?? 'record',
        trustLevel: page.trust ?? 'established',
      },
      gates: { ...GATES, ...page.gates },
      passed: page.passed ?? true,
    } as unknown as GatheredItem,
    answer: page.answer ?? (says === 'miss' ? MISS : HIT),
  };
}

const reasonOf = (reads: ReturnType<typeof read>[], contract: Contract = WEB) => {
  const decision = fastPathDecision(contract, reads);
  return decision.kind === 'escalate' ? decision.reason : decision.outcome;
};

test('two passed pages that agree, and that the model reads the same way, finalise', () => {
  assert.deepEqual(
    fastPathDecision(WEB, [read(), read({ answer: scored(0.93, 0.02) })]),
    {
      kind: 'finalise',
      outcome: 'hit',
      confidence: 0.93,
    },
  );
  assert.equal(reasonOf([read({ says: 'miss' }), read({ says: 'miss' })]), 'miss');
});

test('the order of the pages never changes the answer', () => {
  const pages = [
    read(),
    read({ answer: scored(0.91, 0.0) }),
    read({ answer: scored(0.99, 0.0) }),
  ];
  assert.deepEqual(
    fastPathDecision(WEB, pages),
    fastPathDecision(WEB, [...pages].reverse()),
  );
});

test('a page that did not pass the gates is not counted, for or against', () => {
  assert.equal(
    reasonOf([read(), read({ passed: false, says: 'miss' })]),
    'too_few_items',
  );
  assert.equal(
    reasonOf([read(), read(), read({ passed: false, says: 'miss' })]),
    'hit',
  );
});

const escalations: [string, EscalateReason, ReturnType<typeof read>[], Contract?][] =
  [
    [
      'a price claim',
      'not_web',
      [read(), read()],
      { ...WEB, resolution_method: 'price_feed' },
    ],
    [
      'a follower-count claim',
      'not_web',
      [read(), read()],
      { ...WEB, followers: {} } as unknown as Contract,
    ],
    ['no passed page', 'too_few_items', []],
    ['one passed page', 'too_few_items', [read()]],
    // Absence stays VOID or a human's, never a fast MISS (FR-014).
    [
      'a page that rests on absence',
      'absence',
      [read({ says: 'miss', basis: 'absence' }), read({ says: 'miss' })],
    ],
    [
      'pages that say hit and miss',
      'evidence_disagrees',
      [read(), read({ says: 'miss' })],
    ],
    [
      'a pending page',
      'evidence_disagrees',
      [read({ says: 'pending' }), read({ says: 'pending' })],
    ],
    [
      'an irrelevant page among hits',
      'evidence_disagrees',
      [read(), read(), read({ says: 'irrelevant' })],
    ],
    [
      'a quote not checked',
      'unconfirmed_check',
      [read(), read({ gates: { quote_found: null } })],
    ],
    [
      'a date not checked',
      'unconfirmed_check',
      [read(), read({ gates: { in_window: null } })],
    ],
    [
      'an event not confirmed',
      'unconfirmed_check',
      [read(), read({ gates: { relevant: null } })],
    ],
    [
      'facts that contradict the verdict',
      'unconfirmed_check',
      [read(), read({ gates: { consistent: false } })],
    ],
    [
      'a page unread',
      'verifier_failed',
      [read(), read({ answer: { ok: false, error: 'timeout', latencyMs: 20_000 } })],
    ],
    [
      'an answer from another model',
      'model_mismatch',
      [
        read(),
        read({ answer: { ...(HIT as object), model: 'other@1' } as VerifierResult }),
      ],
    ],
    [
      'a page the service had no opinion on',
      'verifier_unsure',
      [read(), read({ answer: scored(null, null) })],
    ],
    [
      'a page just under the threshold',
      'verifier_unsure',
      [read(), read({ answer: scored(FAST_PATH_THRESHOLD - 0.01, 0.0) })],
    ],
    [
      'a page whose other side is not clearly absent',
      'verifier_unsure',
      [read(), read({ answer: scored(0.95, 1 - FAST_PATH_THRESHOLD) })],
    ],
    [
      'the model reads a hit page as a contradiction',
      'verifier_disagrees',
      [read(), read({ answer: scored(0.02, 0.96) })],
    ],
    [
      'a page that entails and contradicts at once',
      'verifier_disagrees',
      [read(), read({ answer: scored(0.95, 0.93) })],
    ],
  ];
for (const [name, reason, reads, contract] of escalations) {
  test(`escalates: ${name}`, () => assert.equal(reasonOf(reads, contract), reason));
}

test('exactly at the threshold finalises', () => {
  const at = scored(FAST_PATH_THRESHOLD, 0.05);
  assert.equal(reasonOf([read({ answer: at }), read({ answer: at })]), 'hit');
});

// The shared fixtures (verifier/eval/gate-fixtures.json): T342's offline rule answers them in pytest.
type Fixture = {
  name: string;
  pages: { url: string; says: 'hit' | 'miss'; entail: number; contradict: number }[];
  gate: 'hit' | 'miss' | null;
  harness: 'hit' | 'miss' | null;
};
const fixtures = (
  JSON.parse(readFileSync('verifier/eval/gate-fixtures.json', 'utf8')) as {
    cases: Fixture[];
  }
).cases;
for (const fixture of fixtures) {
  test(`agrees with the offline rule: ${fixture.name}`, () => {
    const decision = fastPathDecision(
      WEB,
      fixture.pages.map((p) =>
        read({ says: p.says, answer: scored(p.entail, p.contradict) }),
      ),
    );
    const outcome = decision.kind === 'finalise' ? decision.outcome : null;
    assert.equal(outcome, fixture.gate);
    // Stricter, never different: whatever the live gate finalises, the offline rule finalises the same way.
    if (outcome) assert.equal(fixture.harness, outcome);
  });
}

test('the contract source saying pending or gone holds the gate, as it holds the rule table', () => {
  for (const says of ['pending', 'entity_gone'] as const) {
    const source = read({
      says,
      trust: 'primary',
      passed: false,
      gates: { final: false },
    });
    assert.equal(reasonOf([read(), read(), source]), 'primary_holds');
  }
  // Without its quote on the page it backs nothing (decide.ts primarySays), and a lesser source never holds.
  const unquoted = read({
    says: 'pending',
    trust: 'primary',
    passed: false,
    gates: { quote_found: false },
  });
  assert.equal(reasonOf([read(), read(), unquoted]), 'hit');
  const lesser = read({ says: 'pending', trust: 'established', passed: false });
  assert.equal(reasonOf([read(), read(), lesser]), 'hit');
});

test('a page with no score records no confidence, so no later threshold can pass it', () => {
  assert.deepEqual(
    fastPathDecision(WEB, [read(), read({ answer: scored(null, null) })]),
    {
      kind: 'escalate',
      reason: 'verifier_unsure',
      confidence: null,
    },
  );
});
