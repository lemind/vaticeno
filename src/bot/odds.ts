// The odds lookup (spec 006, ADR 009): one grounded call names the event and gives each outcome's price at several
// bookmakers; code keeps outcomes two bookmakers price and averages them. An outage is thrown, never answered.
import { z } from 'zod';
import { type CallCost, LlmUnavailable } from '../llm/client.js';
import { loadInstruction } from '../llm/instructions.js';
import { log } from '../log.js';
import { averaged, oddsText } from './odds-format.js';

// Lenient on purpose: one odd row (a price as "2.5", a null, a long name) is dropped, never the whole answer.
const Answer = z.union([
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    event: z.string().catch(''),
    status: z.enum(['upcoming', 'live', 'finished']).catch('upcoming'),
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
  // `odds`: the reply; `no_prices`: an answer came back without two bookmakers; `no_event`: nothing named one;
  // `live`: it has started, and in-play odds are never given (owner 2026-11-21).
  outcome: 'odds' | 'no_prices' | 'no_event' | 'live';
  text: string | null;
  costs: CallCost[]; // recorded as `odds` (FR-007)
};

export async function lookUpOdds(
  deps: OddsDeps,
  input: { prediction: string | null; conversation: string[]; request: string },
): Promise<OddsLookup> {
  const first = await askOnce(deps, input);
  // HACK(gemini): OBSERVED 2026-11-21 — "Shoaib Yousaf v John Mitchell" came back as an upcoming event with no
  // prices at all; a second search often finds them. See specs/006-odds-command/spec.md.
  // REVISIT: if no-price answers stay as frequent with one search.
  if (first.lookup.outcome !== 'no_prices' || !first.upcoming) return first.lookup;
  let second;
  try {
    second = await askOnce(deps, input);
  } catch (error) {
    // The first answer was a real one: it stands, and its cost is kept, rather than both being lost to a retry.
    if (error instanceof LlmUnavailable) return first.lookup;
    throw error;
  }
  return {
    ...second.lookup,
    costs: [...first.lookup.costs, ...second.lookup.costs],
  };
}

// LlmUnavailable propagates: the mention is retried next run, never answered "no prices" (INIT_SPEC §6.7).
async function askOnce(
  deps: OddsDeps,
  input: { prediction: string | null; conversation: string[]; request: string },
): Promise<{ lookup: OddsLookup; upcoming: boolean }> {
  const answer = await deps.llm.groundedAnswer({
    model: deps.answerModel,
    instructionVersion: 'odds.v3',
    system: loadInstruction('odds.v3'),
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
  const none = (outcome: OddsLookup['outcome'], upcoming = false) => ({
    lookup: { outcome, text: null, costs },
    upcoming,
  });
  if (!parsed.success) return none('no_prices');
  if (!parsed.data.found) return none('no_event');
  const outcomes = parsed.data.outcomes.filter((o) => o !== null);
  // Every price the search gave and the sites it read: why our odds differ from someone else's is answered here.
  log('info', 'odds looked up', {
    event: 'odds.lookup',
    match: parsed.data.event,
    status: parsed.data.status,
    outcomes: outcomes.map((o) => ({ name: o.name, prices: o.prices })),
    sources: answer.sites ?? [],
  });
  if (parsed.data.status === 'live') return none('live');
  if (parsed.data.status === 'finished') return none('no_prices');
  const text = oddsText(parsed.data.event, averaged(outcomes));
  return text
    ? { lookup: { outcome: 'odds', text, costs }, upcoming: true }
    : none('no_prices', true);
}
