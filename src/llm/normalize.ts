import { type Proposal, ProposalSchema } from '../contract/proposal.js';
import { type CallCost, type LlmClient, LlmSchemaError } from './client.js';
import { loadInstruction } from './instructions.js';

export const NORMALIZE_VERSION = 'normalize.v3';
// The fixture corpus was recorded with v2; it replays with it — no paid re-record.
export const CORPUS_NORMALIZE_VERSION = 'normalize.v2';

export type ProposalResult =
  | { kind: 'ok'; proposal: Proposal; modelId: string; costs: CallCost[] }
  | { kind: 'malformed'; modelId: string; costs: CallCost[] };

// One model call plus one retry on schema failure; still malformed → the caller treats it as needs info
// (FR-005). Outages (LlmUnavailable) propagate: no verdict, try again later.
export async function proposeContract(llm: LlmClient, model: string, text: string, todayUtc: string, version: string = NORMALIZE_VERSION): Promise<ProposalResult> {
  const modelId = `${model}/${version}`;
  const costs: CallCost[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data, costs: callCosts } = await llm.generateJson({
        model,
        instructionVersion: version,
        operation: 'normalize',
        system: loadInstruction(version),
        // attempt is part of the input so a retry is a distinct recorded call
        input: JSON.stringify({ today: todayUtc, text, attempt }),
        schema: ProposalSchema,
      });
      costs.push(...callCosts);
      return { kind: 'ok', proposal: data, modelId, costs };
    } catch (error) {
      if (!(error instanceof LlmSchemaError)) throw error;
      costs.push(...error.costs);
    }
  }
  return { kind: 'malformed', modelId, costs };
}
