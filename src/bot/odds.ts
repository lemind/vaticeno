// The odds lookup (spec 006, ADR 009): one grounded call names the event and gives each outcome's price at several
// bookmakers; code keeps outcomes two bookmakers price and averages them. An outage is thrown, never answered.
import { z } from 'zod';
import type { CallCost } from '../llm/client.js';
import { loadInstruction } from '../llm/instructions.js';
import { log } from '../log.js';
import { averaged, oddsText } from './odds-format.js';

// Lenient on purpose: one odd row (a price as "2.5", a null, a long name) is dropped, never the whole answer.
const Answer = z.union([
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    event: z.string().catch(''),
    outcomes: z.array(
      z
        .object({
          name: z.string(),
          prices: z.array(z.coerce.number().catch(Number.NaN)),
        })
        .nullable()
        .catch(null),
    ),
  }),
]);

export type OddsDeps = {
  answerModel: string;
  llm: {
    groundedAnswer: (call: {
      model: string;
      instructionVersion: string;
      system: string;
      input: string;
    }) => Promise<{
      text: string;
      urls: string[];
      sites?: string[];
      costs: CallCost[];
    }>;
  };
};

export type OddsLookup = {
  // `odds`: the reply; `no_prices`: an answer came back without two bookmakers; `no_event`: nothing named one.
  outcome: 'odds' | 'no_prices' | 'no_event';
  text: string | null;
  costs: CallCost[]; // recorded as `odds` (FR-007)
};

export async function lookUpOdds(
  deps: OddsDeps,
  input: { prediction: string | null; conversation: string[]; request: string },
): Promise<OddsLookup> {
  // LlmUnavailable propagates: the mention is retried next run, never answered "no prices" (INIT_SPEC §6.7).
  const answer = await deps.llm.groundedAnswer({
    model: deps.answerModel,
    instructionVersion: 'odds.v2',
    system: loadInstruction('odds.v2'),
    input: JSON.stringify(input),
  });
  const costs = answer.costs.map((cost) => ({
    ...cost,
    operation: 'odds' as const,
  }));
  const start = answer.text.indexOf('{');
  const end = answer.text.lastIndexOf('}');
  let raw: unknown = null;
  try {
    raw = start >= 0 ? JSON.parse(answer.text.slice(start, end + 1)) : null;
  } catch {
    raw = null; // a malformed answer is "no prices", as one with no prices is
  }
  const parsed = Answer.safeParse(raw);
  if (!parsed.success) return { outcome: 'no_prices', text: null, costs };
  if (!parsed.data.found) return { outcome: 'no_event', text: null, costs };
  const outcomes = parsed.data.outcomes.filter((o) => o !== null);
  // Every price the search gave and the sites it read: why our odds differ from someone else's is answered here.
  log('info', 'odds looked up', {
    event: 'odds.lookup',
    match: parsed.data.event,
    outcomes: outcomes.map((o) => ({ name: o.name, prices: o.prices })),
    sources: answer.sites ?? [],
  });
  const text = oddsText(parsed.data.event, averaged(outcomes));
  return text
    ? { outcome: 'odds', text, costs }
    : { outcome: 'no_prices', text: null, costs };
}
