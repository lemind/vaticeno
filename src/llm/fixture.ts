// Sports claims: a grounded search confirms the match exists and is scheduled, and names its competition
// and kickoff (owner decision 2026-09-30: an invented match is not recorded).
import { z } from 'zod';
import type { Contract } from '../contract/schema.js';
import type { CallCost, LlmClient } from './client.js';
import { loadInstruction } from './instructions.js';

export const FIXTURE_VERSION = 'fixture.v1';

const FixtureSchema = z.object({
  found: z.boolean(),
  home: z.string().max(80).nullable(),
  away: z.string().max(80).nullable(),
  competition: z.string().max(80).nullable(),
  kickoff_utc: z.string().max(40).nullable(), // unparseable = unknown
  criterion: z.string().max(200).nullable(),
});
export type Fixture = z.infer<typeof FixtureSchema>;

export async function findFixture(llm: LlmClient, model: string, contract: Contract, now: Date): Promise<{ fixture: Fixture; costs: CallCost[] }> {
  const { data, costs } = await llm.generateJson({
    model,
    instructionVersion: FIXTURE_VERSION,
    operation: 'search',
    system: loadInstruction(FIXTURE_VERSION),
    input: JSON.stringify({ criterion: contract.criterion, subject: contract.subject, deadline: contract.deadline_at, now: now.toISOString() }),
    schema: FixtureSchema,
    googleSearch: true,
  });
  return { fixture: data, costs };
}
