// What a mention means when code can't tell: a command word with more text, or a non-prediction. The model
// sees the thread above it (texts in memory only, never stored) and may answer a question directly.
import { z } from 'zod';
import type { CallCost, LlmClient } from './client.js';
import { loadInstruction } from './instructions.js';

export const INTENTS = ['prediction', 'quote', 'selfpromo', 'help', 'ping', 'stop', 'question', 'other'] as const;
export type Intent = (typeof INTENTS)[number];
export type ThreadPost = { from: 'bot' | 'user'; text: string };

export async function classifyIntent(llm: LlmClient, model: string, text: string, thread: ThreadPost[], version = 'intent.v4'): Promise<{ intent: Intent; answer: string | null; wantsOlder: boolean; needsLive: boolean; costs: CallCost[] }> {
  const { data, costs } = await llm.generateJson({
    model, instructionVersion: version, operation: 'normalize', system: loadInstruction(version),
    input: JSON.stringify({ text, thread }), schema: z.object({ intent: z.enum(INTENTS), answer: z.string().max(400).nullable(), older_posts_would_help: z.boolean().optional(), needs_live_source: z.boolean().optional() }),
  });
  return { intent: data.intent, answer: data.answer, wantsOlder: data.older_posts_would_help ?? false, needsLive: data.needs_live_source ?? false, costs };
}
