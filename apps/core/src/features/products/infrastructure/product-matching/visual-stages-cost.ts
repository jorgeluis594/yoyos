import { priceOf, type ModelPrice } from "@core/src/shared/infrastructure/model-prices";
import { describeMaxOutputTokens } from "@core/src/features/products/infrastructure/product-matching/openai-image-embedder";

/**
 * Worst billed tokens of the model calls a photo message makes besides the reader (design §10.1, «Photo stages»).
 * Initial values came from the recorded chooser calls (about 910 billed tokens per image). The tuning measured square 1,024 × 1,024
 * images with direct calls and pinned the larger value: a chooser call with the customer image, a detail image and 8 candidates billed
 * 10,769 input tokens (twice) and one description billed 1,297 input and 29 output tokens (embedding of it: 25).
 * Billed tokens, so no tokenizer ratio applies.
 */
export const visualStagesTokens = {
  /** One 1,024-px image in a request. */
  imageInput: 1_047,
  /** Instructions and labels of the chooser, besides its images. */
  chooserTextInput: 300,
  /** A choice and a predicate; billed 0 in every recorded call, reserved at 100. */
  chooserOutput: 100,
  /** One 1,024-px image and the description prompt. */
  describerInput: 1_300,
  describerOutput: describeMaxOutputTokens,
  /** The description of at most 80 words, embedded. */
  embeddingInput: describeMaxOutputTokens,
} as const;

/** The most candidate images the chooser sees. */
export const maxPhotoCandidates = 8;

export type PhotoStagesCostConfig = Readonly<{
  /** Candidate images the chooser compares, at most `maxPhotoCandidates`. */
  candidates: number;
  matcherModel: string;
  /** The local embedder makes no billed call. */
  embedder: Readonly<{ provider: "local" }> | Readonly<{ provider: "openai"; describeModel: string; embedModel: string }>;
}>;

function priced(model: string): ModelPrice {
  const price = priceOf(model);
  if (!price) throw new Error(`The model ${model} has no price in model-prices.ts, so the cost of a photo message cannot be bounded`);
  return price;
}

const dollars = (price: ModelPrice, input: number, output: number) => (input * price.input + output * price.output) / 1_000_000;

/**
 * The worst US dollars the photo stages bill for one message: one chooser call with the customer image, a detail image and every candidate,
 * and, with the OpenAI embedder, one description and its embedding. Throws when a model has no price (startup).
 */
export function photoStagesReserveUsd(config: PhotoStagesCostConfig): number {
  const tokens = visualStagesTokens;
  const chooserInput = (2 + config.candidates) * tokens.imageInput + tokens.chooserTextInput;
  const chooser = dollars(priced(config.matcherModel), chooserInput, tokens.chooserOutput);
  if (config.embedder.provider === "local") return chooser;
  const describer = dollars(priced(config.embedder.describeModel), tokens.describerInput, tokens.describerOutput);
  const embedding = dollars(priced(config.embedder.embedModel), tokens.embeddingInput, 0);
  return chooser + describer + embedding;
}
