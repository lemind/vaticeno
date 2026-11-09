// The repost policy (spec 005 FR-011): of the searched posts, only an upcoming event may be reposted (owner,
// 2026-11-09). One lite-model call sorts them; the caller picks the most-liked of what is left.
import { z } from 'zod';
import { type CallCost, LlmSchemaError } from '../llm/client.js';
import { loadInstruction } from '../llm/instructions.js';
import { log } from '../log.js';
import type { UserPost } from '../x/client.js';
import { type QuoteDeps, saveCosts } from './quote.js';

const KINDS = ['prediction', 'event', 'result', 'development', 'none'] as const;
const FitSchema = z.object({
  posts: z.array(
    z.object({
      index: z.number().int().min(0),
      kind: z.enum(KINDS),
      fit: z.number().int().min(1).max(10),
    }),
  ),
});

// The posts the model marks as upcoming events; empty when none is, or the answer was unusable (no repost).
export async function upcomingEvents<T extends UserPost>(
  deps: QuoteDeps,
  posts: readonly T[],
): Promise<T[]> {
  if (posts.length === 0) return [];
  const costs: CallCost[] = [];
  try {
    const { data, costs: c } = await deps.llm.generateJson({
      model: deps.normalizerModel,
      instructionVersion: 'repost.v2',
      operation: 'feed_model',
      system: loadInstruction('repost.v2'),
      input: JSON.stringify({
        posts: posts.map((p, index) => ({ index, text: p.text })),
      }),
      schema: FitSchema,
    });
    costs.push(...c);
    const events = data.posts
      .filter((p) => p.kind === 'event' && posts[p.index])
      .map((p) => posts[p.index]!);
    log('info', 'repost policy sorted the candidates', {
      event: 'feed.repost_fit',
      candidates: posts.length,
      kinds: data.posts.map((p) => p.kind),
      events: events.length,
    });
    return [...new Set(events)];
  } catch (error) {
    if (!(error instanceof LlmSchemaError)) throw error; // an outage fails the run; the next slot retries
    costs.push(...error.costs);
    log(
      'info',
      'repost policy answer unusable; nothing reposted from this account',
      {
        event: 'feed.repost_fit_failed',
      },
    );
    return [];
  } finally {
    await saveCosts(deps, costs);
  }
}
