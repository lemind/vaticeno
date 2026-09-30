import { type Proposal, ProposalSchema } from '../contract/proposal.js';
import { type CallCost, type LlmClient, LlmSchemaError } from './client.js';
import { loadInstruction } from './instructions.js';

export const NORMALIZE_VERSION = 'normalize.v2';

export type ProposalResult =
  | { kind: 'ok'; proposal: Proposal; modelId: string; costs: CallCost[] }
  | { kind: 'malformed'; modelId: string; costs: CallCost[] };

// One model call plus one retry on schema failure; still malformed → the caller treats it as needs info
// (FR-005). Outages (LlmUnavailable) propagate: no verdict, try again later.
export async function proposeContract(llm: LlmClient, model: string, text: string, todayUtc: string): Promise<ProposalResult> {
  const modelId = `${model}/${NORMALIZE_VERSION}`;
  const costs: CallCost[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data, costs: callCosts } = await llm.generateJson({
        model,
        instructionVersion: NORMALIZE_VERSION,
        operation: 'normalize',
        system: loadInstruction(NORMALIZE_VERSION),
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
