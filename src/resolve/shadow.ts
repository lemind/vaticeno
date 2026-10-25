// Shadow mode (003 FR-016, data-model verifier_shadow): after the paid path has decided, ask the local verifier
// what the fast path would have concluded and record it. Decides nothing; a failure here changes no verdict.
import { eq } from 'drizzle-orm';
import type { Contract } from '../contract/schema.js';
import type { Db } from '../db/client.js';
import { resolutions, verifierShadow } from '../db/schema.js';
import { EXTRACTOR_VERSION } from './fetch.js';
import { GATES_VERSION } from './gates.js';
import type { ScoreEvidence, VerifierResult } from './verifier.js';
import type { GatheredItem } from './web-evidence.js';

// PROVISIONAL: no threshold has been tuned (T342 found no eligible claim); min_confidence lets any later one
// be re-applied to these rows. FR-013 needs two agreeing items, each past it.
export const SHADOW_THRESHOLD = 0.9;
const MIN_AGREEING_ITEMS = 2;
// Bump on any change to wouldConclude or the two constants above.
export const SHADOW_GATE = 'gate.v1-t0.90';
// The frozen model, as the service names it (verifier/serve/model.toml). An answer from any other is refused.
export const VERIFIER_MODEL = 'Leminds/deberta-v3-xsmall-nli-oanc@5f0820a';
// The frozen candidate SC-005 counts for: the model, this gate, and the resolver logic it relies on (which
// pages pass, how their text is read). A change to any part is a new candidate and its count starts again.
export const SHADOW_CANDIDATE = [
  VERIFIER_MODEL,
  SHADOW_GATE,
  GATES_VERSION,
  EXTRACTOR_VERSION,
].join(' ');

export type ShadowRow = Omit<
  typeof verifierShadow.$inferInsert,
  'claimId' | 'resolutionId' | 'paidOutcome'
>;

// The fast path's answer for the whole claim, from one verifier answer per passed page.
export function wouldConclude(answers: readonly VerifierResult[]): ShadowRow {
  const latencyMs = Math.max(0, ...answers.map((a) => a.latencyMs));
  const model = SHADOW_CANDIDATE; // every row, failures included, so the latest attempt is always the one counted
  const failure = answers.find((a) => !a.ok);
  const stranger = answers.some((a) => a.ok && a.model !== VERIFIER_MODEL);
  if ((failure && !failure.ok) || stranger) {
    // One page unread is one page that might argue back; another model's answer is not this candidate's.
    return {
      model,
      wouldFinalise: false,
      minConfidence: null,
      errorTag: failure && !failure.ok ? failure.error : 'model_mismatch',
      latencyMs,
    };
  }
  const reads = answers.flatMap((a) =>
    a.ok && a.entail !== null && a.contradict !== null
      ? [{ entail: a.entail, contradict: a.contradict }]
      : [],
  );
  // A page speaks for one side only when the other is clearly absent: windows are scored apart, so one
  // page can both entail and contradict (it reports the forecast and the result), and that page escalates.
  const says = (outcome: 'hit' | 'miss') =>
    reads.map((r) => {
      const [side, other] =
        outcome === 'hit' ? [r.entail, r.contradict] : [r.contradict, r.entail];
      return other < 1 - SHADOW_THRESHOLD ? side : 0;
    });
  const minConfidence = reads.length
    ? Math.min(...reads.map((r) => Math.max(r.entail, r.contradict)))
    : null;
  for (const outcome of ['hit', 'miss'] as const) {
    const scores = says(outcome);
    // Every page must agree past the threshold: one page that disagrees escalates (FR-013).
    if (
      scores.length >= MIN_AGREEING_ITEMS &&
      scores.every((s) => s >= SHADOW_THRESHOLD)
    ) {
      return {
        model,
        wouldFinalise: true,
        wouldOutcome: outcome,
        minConfidence: Math.min(...scores),
        errorTag: null,
        latencyMs,
      };
    }
  }
  return { model, wouldFinalise: false, minConfidence, errorTag: null, latencyMs };
}

// One row per resolution attempt with a page to read, failures included. Only web evidence: a feed or a profile has no page to read.
export async function recordShadow(
  db: Db,
  scoreEvidence: ScoreEvidence,
  claimId: string,
  contract: Contract,
  items: readonly GatheredItem[],
): Promise<void> {
  const hypothesis = `${contract.subject} ${contract.criterion}`;
  const pages = items.filter((item) => item.passed && item.pageText.length > 0);
  // Nothing passed with text: the fast path had nothing to read, so there is no answer to compare.
  if (pages.length === 0) return;
  const answers = await Promise.all(
    pages.map((item) => scoreEvidence(item.pageText, hypothesis)),
  );
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
    ...wouldConclude(answers),
  });
}
