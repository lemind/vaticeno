// The fast-path gate (003 FR-013, FR-014): when the local verifier may finalise a verdict without the paid
// model. Pure. It only ever confirms what passed evidence already says; anything else escalates.
import type { Contract } from '../contract/schema.js';
import type { VerifierResult } from './verifier.js';
import type { GatheredItem } from './web-evidence.js';

// PROVISIONAL: no threshold has been tuned (T342 found no eligible claim); min_confidence lets any later one
// be re-applied to recorded rows. A page clears it only when its other side stays under 1 − threshold.
export const FAST_PATH_THRESHOLD = 0.9;
export const MIN_AGREEING_ITEMS = 2;
// Part of the frozen candidate (src/resolve/shadow.ts): bump on any change to this file's rule or constants.
export const FAST_PATH_VERSION = 'gate.v3-t0.90';
// The frozen model, as the service names it (verifier/serve/model.toml). An answer from any other is refused.
export const VERIFIER_MODEL = 'Leminds/deberta-v3-xsmall-nli-oanc@5f0820a';

export type EscalateReason =
  | 'not_web' // a feed or a profile answers for itself
  | 'primary_holds' // the contract's source says pending or entity gone: the rule table waits, so do we
  | 'too_few_items' // fewer than two passed pages: independence needs two (FR-013)
  | 'absence' // silence is VOID or a human's, never the fast path's (FR-014)
  | 'evidence_disagrees' // passed pages do not all say the same hit or miss
  | 'unconfirmed_check' // a date, event or quote check did not positively pass (FR-013)
  | 'verifier_failed' // a page unread: it may be the one that argues back
  | 'model_mismatch' // an answer from a model other than the frozen one
  | 'verifier_unsure' // a page the model cannot read as one side past the threshold
  | 'verifier_disagrees'; // the model reads a page the other way from its evidence

export type FastPathDecision =
  | { kind: 'finalise'; outcome: 'hit' | 'miss'; confidence: number }
  | { kind: 'escalate'; reason: EscalateReason; confidence: number | null };

// Every page of this run, passed or not; `answer` is the verifier's for a passed page, absent otherwise.
type Read = { item: GatheredItem; answer?: VerifierResult };

export function fastPathDecision(
  contract: Contract,
  reads: readonly Read[],
): FastPathDecision {
  const escalate = (reason: EscalateReason, confidence: number | null = null) =>
    ({ kind: 'escalate', reason, confidence }) as const;
  if (contract.resolution_method !== 'model' || contract.followers)
    return escalate('not_web');
  // A primary pending or entity-gone page fails the gates by design, yet decide.ts still waits on it.
  if (
    reads.some(
      ({ item: { draft, gates } }) =>
        draft.trustLevel === 'primary' &&
        (draft.says === 'pending' || draft.says === 'entity_gone') &&
        gates.quote_found !== false,
    )
  )
    return escalate('primary_holds');
  const passed = reads.filter((r) => r.item.passed);
  if (passed.length < MIN_AGREEING_ITEMS) return escalate('too_few_items');
  if (passed.some((r) => r.item.draft.basis !== 'record'))
    return escalate('absence');
  const says = passed[0]!.item.draft.says;
  if (
    (says !== 'hit' && says !== 'miss') ||
    passed.some((r) => r.item.draft.says !== says)
  )
    return escalate('evidence_disagrees');
  // Passing allows "not applicable"; the fast path needs each check to have looked and agreed.
  if (
    passed.some(
      ({ item: { gates } }) =>
        gates.quote_found !== true ||
        gates.in_window !== true ||
        gates.relevant !== true ||
        gates.consistent === false,
    )
  )
    return escalate('unconfirmed_check');

  type Answered = Extract<VerifierResult, { ok: true }>;
  const answers = passed.map((r) => r.answer);
  if (answers.some((a) => !a || !a.ok)) return escalate('verifier_failed');
  const read = answers as Answered[];
  if (read.some((a) => a.model !== VERIFIER_MODEL))
    return escalate('model_mismatch');
  const sides = read.map((a) => {
    if (a.entail === null || a.contradict === null) return null;
    return says === 'hit'
      ? { side: a.entail, other: a.contradict }
      : { side: a.contradict, other: a.entail };
  });
  const scored = sides.filter((s) => s !== null);
  // A page with no score has no confidence to record: a later threshold must never read it as passable.
  if (scored.length < sides.length) return escalate('verifier_unsure');
  const weakest = Math.min(...scored.map((s) => s.side));
  // The model reading the page the other way, confidently, is a disagreement, not mere doubt.
  if (scored.some((s) => s.other >= FAST_PATH_THRESHOLD))
    return escalate('verifier_disagrees', weakest);
  if (
    scored.some(
      (s) => s.side < FAST_PATH_THRESHOLD || s.other >= 1 - FAST_PATH_THRESHOLD,
    )
  )
    return escalate('verifier_unsure', weakest);
  return { kind: 'finalise', outcome: says, confidence: weakest };
}
