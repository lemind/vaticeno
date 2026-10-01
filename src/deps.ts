// Dependency wiring shared by the entrypoints (CLIs, web server with jobs): built once from config.
import type { CoreConfig } from './config.js';
import { getDb } from './db/client.js';
import { createCoinbase } from './feeds/coinbase.js';
import { createLlmClient } from './llm/client.js';
import { createReplayStore } from './llm/replay.js';
import { createPageFetcher } from './resolve/fetch.js';

export function buildDeps(config: CoreConfig) {
  const store = createReplayStore();
  return {
    db: getDb(),
    llm: createLlmClient({ mode: config.LLM_MODE, apiKey: config.GEMINI_API_KEY, store }),
    coinbase: createCoinbase({ mode: config.LLM_MODE, store }),
    normalizerModel: config.NORMALIZER_MODEL,
    fetchPage: createPageFetcher({ mode: config.LLM_MODE, store }),
    judgeModelA: config.JUDGE_MODEL_A,
    judgeModelB: config.JUDGE_MODEL_B,
    arbiterModel: config.ARBITER_MODEL,
  };
}
