import { z } from 'zod';
import { ContractSchema } from './schema.js';

// What the model proposes for one prediction text (contracts/llm-schemas.md "Proposal — normalize.v1").
// The model proposes; deterministic checks (checks.ts) decide.
export const UNCLEAR_ITEMS = ['deadline', 'threshold', 'subject', 'success_condition', 'source', 'ambiguous_event'] as const;
export type UnclearItem = (typeof UNCLEAR_ITEMS)[number];

export const ProposalSchema = z.object({
  is_prediction: z.boolean(),
  x_rules_ok: z.boolean(),
  contract: ContractSchema.nullable(),
  unclear: z.array(z.enum(UNCLEAR_ITEMS)),
  unclear_explanation: z.string().max(120),
  examples: z.array(z.string().max(160)).max(3), // amend bodies "<what happens> by <YYYY-MM-DD>"
  self_confidence: z.number().min(0).max(1), // recorded for analysis only, never a check
});

export type Proposal = z.infer<typeof ProposalSchema>;
