// Paid-tier list prices (USD), from ai.google.dev/gemini-api/docs/pricing on 2026-09-30.
// UNRECONCILED: not yet checked against a real invoice. Unknown models cost 0 and log `llm.price_unknown`.
export const MODEL_PRICES_PER_MTOK: Readonly<Record<string, { input: number; output: number }>> = {
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 }, // doubles on 2027-01-01
  'gemini-3.5-flash': { input: 1.5, output: 9 },
  'gemini-3.1-pro-preview': { input: 2, output: 12 },
};

// Google Search grounding on Gemini 3.x: 5,000 free requests/month, then $14 per 1,000. UNRECONCILED.
export const SEARCH_QUERY_USD = 0.014;

export function modelCostUsd(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const price = MODEL_PRICES_PER_MTOK[model];
  if (!price) return undefined;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
