// Shadow mode (003 FR-016, data-model verifier_shadow): after the paid path has decided, ask the local verifier
// what the fast path would have concluded and record it. Decides nothing; a failure here changes no verdict.
import { eq } from 'drizzle-orm';
import type { Contract } from '../contract/schema.js';
import type { Db } from '../db/client.js';
import { resolutions, verifierShadow } from '../db/schema.js';
import { EXTRACTOR_VERSION } from './fetch.js';
import { GATES_VERSION } from './gates.js';
import { FAST_PATH_VERSION, fastPathDecision, VERIFIER_MODEL } from './fast-path.js';
import type { ScoreEvidence, VerifierResult } from './verifier.js';
import type { GatheredItem } from './web-evidence.js';

// The frozen candidate SC-005 counts for: the model, the gate, and the resolver logic it relies on (which
// pages pass, how their text is read). A change to any part is a new candidate and its count starts again.
export const SHADOW_CANDIDATE = [
  VERIFIER_MODEL,
  FAST_PATH_VERSION,
  GATES_VERSION,
  EXTRACTOR_VERSION,
].join(' ');

// One row per resolution attempt with a page to read, failures included. Only web evidence: a feed or a profile has no page to read.
export async function recordShadow(
  db: Db,
  scoreEvidence: ScoreEvidence,
  claimId: string,
  contract: Contract,
  items: readonly GatheredItem[],
): Promise<void> {
  const hypothesis = `${contract.subject} ${contract.criterion}`;
  const passed = items.filter((item) => item.passed);
  // Nothing passed with text: the fast path had nothing to read, so there is no answer to compare.
  if (!passed.some((item) => item.pageText.length > 0)) return;
  // Every page of the run goes to the gate; only the passed ones are read, one after another: the service
  // takes one request at a time (verifier/serve/deploy.sh), and a full page alone takes about 12 s.
  const reads: { item: GatheredItem; answer?: VerifierResult }[] = [];
  for (const item of items) {
    let answer: VerifierResult | undefined;
    if (item.passed)
      answer =
        item.pageText.length > 0
          ? await scoreEvidence(item.pageText, hypothesis)
          : { ok: false, error: 'no_text', latencyMs: 0 };
    reads.push({ item, answer });
  }
  // The same gate a live fast path would run, so the count measures exactly what would go live.
  const decision = fastPathDecision(contract, reads);
  const failure = reads.find((r) => r.answer && !r.answer.ok)?.answer;
  const [resolution] = await db
    .select({
      id: resolutions.id,
      outcome: resolutions.outcome,
      review: resolutions.reviewStatus,
    })
    .from(resolutions)
    .where(eq(resolutions.claimId, claimId));
  await db.insert(verifierShadow).values({
    claimId,
    resolutionId: resolution?.id ?? null,
    // What the paid path concluded; null while it waits or a human has still to decide.
    paidOutcome: resolution?.review === 'final' ? resolution.outcome : null,
    model: SHADOW_CANDIDATE, // every row, failures included, so the latest attempt is always the one counted
    wouldFinalise: decision.kind === 'finalise',
    wouldOutcome: decision.kind === 'finalise' ? decision.outcome : null,
    minConfidence: decision.confidence,
    errorTag:
      failure && !failure.ok
        ? failure.error
        : decision.kind === 'escalate' && decision.reason === 'model_mismatch'
          ? 'model_mismatch'
          : null,
    latencyMs: Math.max(0, ...reads.map((r) => r.answer?.latencyMs ?? 0)),
  });
}
