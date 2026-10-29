// Dependency wiring shared by the entrypoints (CLIs, web server with jobs): built once from config.
import type { CoreConfig } from './config.js';
import { getDb } from './db/client.js';
import { createCoinbase } from './feeds/coinbase.js';
import { createLlmClient } from './llm/client.js';
import { createReplayStore } from './llm/replay.js';
import { createPageFetcher } from './resolve/fetch.js';
import { createVerifier } from './resolve/verifier.js';
import { wagerNetworks } from './wager/networks.js';

export function buildDeps(config: CoreConfig) {
  const store = createReplayStore();
  const networks = wagerNetworks(config);
  return {
    db: getDb(),
    llm: createLlmClient({
      mode: config.LLM_MODE,
      apiKey: config.GEMINI_API_KEY,
      store,
    }),
    coinbase: createCoinbase({ mode: config.LLM_MODE, store }),
    normalizerModel: config.NORMALIZER_MODEL,
    answerModel: config.ANSWER_MODEL,
    settlementNetworks: networks.length
      ? networks.map((n) => String(n.chainId))
      : undefined,
    wagerNetworks: networks,
    fetchPage: createPageFetcher({ mode: config.LLM_MODE, store }),
    judgeModelA: config.JUDGE_MODEL_A,
    judgeModelB: config.JUDGE_MODEL_B,
    arbiterModel: config.ARBITER_MODEL,
    // Shadow only on live pages: a replayed page has no text to read (003 FR-016).
    verifier:
      config.VERIFIER_MODE === 'shadow' && config.LLM_MODE !== 'replay'
        ? createVerifier({
            url: config.VERIFIER_URL!,
            key: config.VERIFIER_KEY!,
            serviceAccountFile: config.VERIFIER_SA_KEY_FILE!,
          })
        : undefined,
  };
}
