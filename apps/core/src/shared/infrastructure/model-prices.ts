/** US dollars per million tokens. */
export type ModelPrice = Readonly<{ input: number; output: number }>;

/**
 * The one price table of every priced model: the chat reader's token budget, the photo stages' reserve and the eval meter read it.
 * gpt-6-luna from third-party listings of OpenAI's price page (verify on developers.openai.com/api/docs/pricing); embeddings by the input only.
 * Changing a model means adding its price here and re-running the cost measurements.
 */
export const modelPrices: Readonly<Record<string, ModelPrice>> = {
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

/** The price of a model, or null when it has none (a model the cost bound cannot be computed for). */
export function priceOf(model: string): ModelPrice | null {
  return Object.hasOwn(modelPrices, model) ? modelPrices[model]! : null;
}
