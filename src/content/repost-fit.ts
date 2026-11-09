// The repost policy (spec 005 FR-011): of an account's eligible posts, only an upcoming event is reposted (owner,
// 2026-11-09). One lite-model call sorts them; no event, no repost.
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

// The best-fitting post, or null when none fits or the model gave no usable answer (then nothing is reposted).
export async function bestFit(
  deps: QuoteDeps,
  posts: readonly UserPost[],
): Promise<UserPost | null> {
  if (posts.length === 0) return null;
  const costs: CallCost[] = [];
  try {
    const { data, costs: c } = await deps.llm.generateJson({
      model: deps.normalizerModel,
      instructionVersion: 'repost.v1',
      operation: 'feed_model',
      system: loadInstruction('repost.v1'),
      input: JSON.stringify({
        posts: posts.map((p, index) => ({ index, text: p.text })),
      }),
      schema: FitSchema,
    });
    costs.push(...c);
    const best = data.posts
      .filter((p) => p.kind === 'event' && posts[p.index])
      .sort((a, b) => b.fit - a.fit)[0];
    log('info', 'repost policy sorted the candidates', {
      event: 'feed.repost_fit',
      candidates: posts.length,
      kinds: data.posts.map((p) => p.kind),
      picked: best ? posts[best.index]!.id : null,
    });
    return best ? posts[best.index]! : null;
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
    return null;
  } finally {
    await saveCosts(deps, costs);
  }
}
