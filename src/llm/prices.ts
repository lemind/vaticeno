// UNRECONCILED: list prices (USD) as published, not yet checked against a real invoice.
// Update when the first bill arrives. Unknown models cost 0 and log `llm.price_unknown`.
export const MODEL_PRICES_PER_MTOK: Readonly<Record<string, { input: number; output: number }>> = {
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
};

// Google Search grounding: $14 per 1,000 queries after the free allowance (research R4). UNRECONCILED.
export const SEARCH_QUERY_USD = 0.014;

export function modelCostUsd(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const price = MODEL_PRICES_PER_MTOK[model];
  if (!price) return undefined;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
