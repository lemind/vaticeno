// NEEDS INFO (case A): every example we suggest must itself record (FR-008). Each proposed example goes
// through the same proposal + checks as a real amend; failures are dropped; one regeneration; then the
// fixed fallback. An unchecked example is never returned.
import { runChecks } from '../contract/checks.js';
import type { Proposal } from '../contract/proposal.js';
import type { Coinbase } from '../feeds/coinbase.js';
import type { CallCost, LlmClient } from '../llm/client.js';
import { proposeContract } from '../llm/normalize.js';
import { ReplayMiss } from '../llm/replay.js';
import { log } from '../log.js';
import { fallbackExample, needsInfoReply, weightedLength, X_MAX_CHARS } from './templates.js';

const EXAMPLES_CHECKED = 2; // per round: at most 2 + 1 regeneration + 1 = 4 extra calls per reply

export type NeedsInfoDeps = { llm: LlmClient; coinbase: Coinbase; normalizerModel: string };

export type NeedsInfoResult = { reply: string; example: string | null; costs: CallCost[] };

export async function buildNeedsInfoReply(
  deps: NeedsInfoDeps,
  input: { text: string; proposal: Proposal | null; explanation: string; now: Date },
): Promise<NeedsInfoResult> {
  const costs: CallCost[] = [];
  const today = input.now.toISOString().slice(0, 10);
  const { explanation } = input;

  const fits = (example: string) => weightedLength(needsInfoFrame(explanation, example)) <= X_MAX_CHARS;
  let example = await firstRecordable(deps, input.proposal?.examples ?? [], today, input.now, costs, fits);
  if (!example) {
    // One regeneration: ask again for this text; the added hint makes it a distinct (recordable) call.
    const again = await proposeContract(deps.llm, deps.normalizerModel, `${input.text}\n\n(suggest different examples)`, today);
    costs.push(...again.costs);
    if (again.kind === 'ok') example = await firstRecordable(deps, again.proposal.examples.slice(0, 1), today, input.now, costs, fits);
  }

  const reply = needsInfoReply(explanation, example ?? fallbackExample(input.now));
  return { reply, example, costs };
}

async function firstRecordable(
  deps: NeedsInfoDeps, examples: string[], today: string, now: Date, costs: CallCost[], fits: (example: string) => boolean,
): Promise<string | null> {
  for (const example of examples.slice(0, EXAMPLES_CHECKED)) {
    const body = example.replace(/^amend\s+/i, '').trim();
    if (!body || !fits(body)) continue; // must fit the reply, or it is useless
    const proposed = await proposeContract(deps.llm, deps.normalizerModel, body, today);
    costs.push(...proposed.costs);
    if (proposed.kind !== 'ok') continue;
    const checked = runChecks(proposed.proposal, now, { sourcePostClaimed: false });
    if (checked.outcome === 'recorded' && await priceFeedAnswers(deps.coinbase, checked.contract)) return body;
  }
  return null;
}

// FR-004 for examples too: a price example is offered only if the feed has that market. Feed down → skip it.
async function priceFeedAnswers(coinbase: Coinbase, contract: { resolution_method: string; price?: { product_id: string } }): Promise<boolean> {
  if (contract.resolution_method !== 'price_feed' || !contract.price) return true;
  try {
    return (await coinbase.productStatus(contract.price.product_id)) === 'online';
  } catch (error) {
    if (error instanceof ReplayMiss) throw error; // a missing recording fails loudly, never changes the answer
    log('warn', 'price feed check for an example failed; example skipped', { event: 'needs_info.example_feed_failed', error: String(error) });
    return false;
  }
}

// Same text as needsInfoReply, without the length assertion, to test whether an example fits.
function needsInfoFrame(explanation: string, example: string): string {
  try {
    return needsInfoReply(explanation, example);
  } catch {
    return 'x'.repeat(X_MAX_CHARS + 1);
  }
}
