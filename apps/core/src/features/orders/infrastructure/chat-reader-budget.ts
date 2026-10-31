import { countTokens, isWithinTokenLimit } from "gpt-tokenizer/encoding/o200k_base";
import type { ChatReadingContext } from "@core/src/features/orders/domain/chat-reading";
import type { ContextTooLarge, FittedReadingContext } from "@core/src/features/orders/application/read-chat-message";
import { defaultReaderModel } from "@core/src/features/orders/infrastructure/chat-reader-env";
import { describeReadingContext, productBlock } from "@core/src/features/orders/infrastructure/chat-reader-context-text";
import { readerJsonSchema } from "@core/src/features/orders/infrastructure/chat-reader-schema";
import { readerInstructions } from "@core/src/features/orders/infrastructure/chat-reader-text";
import { priceOf } from "@core/src/shared/infrastructure/model-prices";

/** The cost of one message never exceeds this (US dollars), whatever the catalog: the reader's input is fitted to it before every call. */
export const messageCostBoundUsd = 0.003;
/** The answer limit: a 10-action answer of about 100 tokens an action. With effort `none` there are no reasoning tokens, which would count inside it anyway. */
export const readerOutputTokenLimit = 1000;
/** A photo budget under this fails at startup: the usual captioned photo is about 3,400 tokens. */
const minPhotoInputTokens = 8000;
/**
 * Billed input tokens over the o200k count (a proxy: no tokenizer is published for gpt-6-luna). The dev calls (Latin, about 3,000 tokens)
 * bill 0.97 of the count, below 1.00, so it stays 1.00; nothing is measured at the 25,000-token budget or in a non-Latin script.
 */
export const tokenizerRatio = 1;

export type ReaderTokenBudget = Readonly<{ maxOutputTokens: number; tokenizerRatio: number; textInputTokens: number; photoInputTokens: number }>;

/**
 * The input-token budgets that keep input + answer (+ the photo stages' reserve) at or under the cost bound at the model's prices:
 * `floor(((bound − reserve) × 10⁶ − maxOutputTokens × output price) / input price / ratio)`. A photo message pays its photo stages first.
 */
export function readerTokenBudget(options: Readonly<{ photoStagesReserveUsd: number; model?: string; tokenizerRatio?: number }>): ReaderTokenBudget {
  const model = options.model ?? defaultReaderModel;
  const price = priceOf(model);
  if (!price) throw new Error(`The reader model ${model} has no price in model-prices.ts`);
  const ratio = options.tokenizerRatio ?? tokenizerRatio;
  const inputTokens = (reserveUsd: number) =>
    // Micro-dollars as whole numbers, then a small epsilon, so a bound that lands exactly on an integer is not lost to floating point.
    Math.floor(((Math.round((messageCostBoundUsd - reserveUsd) * 1e9) / 1000 - readerOutputTokenLimit * price.output) / price.input / ratio) + 1e-6);
  const budget = { maxOutputTokens: readerOutputTokenLimit, tokenizerRatio: ratio, textInputTokens: inputTokens(0), photoInputTokens: inputTokens(options.photoStagesReserveUsd) };
  if (budget.photoInputTokens < minPhotoInputTokens) throw new Error(`The photo stages' reserve leaves a photo reader budget of ${budget.photoInputTokens} tokens, under ${minPhotoInputTokens.toLocaleString("en-US")}`);
  return budget;
}

/** The tokenizer the fit counts with; `within` stops counting at the limit and says `false` when the text is longer. */
export type Tokenizer = Readonly<{ count: (text: string) => number; within: (text: string, limit: number) => number | false }>;
const o200k: Tokenizer = { count: countTokens, within: isWithinTokenLimit };

const schemaText = JSON.stringify(readerJsonSchema);
/** What the model reads for a context: the fixed instructions, the schema and the context text (framing tokens of the API are left out). */
export const requestTextOf = (contextText: string): string => [readerInstructions, schemaText, contextText].join("\n");
/** o200k tokens of the request for a context text, as the fit counts it. */
export const countRequestTokens = (contextText: string): number => o200k.count(requestTextOf(contextText));

/** Fits a reading context to the input budget of its kind, or says the part that is never cut does not fit. */
export type FitReadingContext = (context: ChatReadingContext) => FittedReadingContext | ContextTooLarge;

/**
 * Counts in priority order with early exit (technical design §2 «Reader input-token budget»): the part never cut (the text, the items,
 * the pendings and the shown products) once, then each other product block with its separator, stopping at the first that does not fit;
 * the rest are dropped without being tokenized. The whole rendered request then confirms the fit, dropping products from the tail while it
 * does not. Products keep the order the context gives, which is the selection priority.
 */
export function createFitReadingContext(options: Readonly<{ budget: ReaderTokenBudget; tokenizer?: Tokenizer }>): FitReadingContext {
  const { budget } = options;
  const tokenizer = options.tokenizer ?? o200k;
  const fixedTokens = tokenizer.count(requestTextOf("")); // the instructions, the schema and the newlines that join the context to them
  return (context) => {
    const limit = context.kind === "text" ? budget.textInputTokens : budget.photoInputTokens;
    // The early exit stops counting at the limit, so this is "over the budget" (limit + 1), not a measured size: never log it as one.
    const tooLarge = (): ContextTooLarge => ({ code: "CONTEXT_TOO_LARGE", message: "The request does not fit the input-token budget", countedInputTokens: limit + 1 });
    const neverCut = context.products.filter(({ shown }) => shown);
    const baseTokens = tokenizer.within(describeReadingContext({ ...context, products: neverCut }), limit - fixedTokens);
    if (baseTokens === false) return tooLarge();
    let remaining = limit - fixedTokens - baseTokens;
    const kept = new Set(neverCut);
    for (const product of context.products) {
      if (product.shown) continue;
      const tokens = tokenizer.within(`\n${productBlock(product)}`, remaining);
      if (tokens === false) break;
      remaining -= tokens;
      kept.add(product);
    }
    const droppable = context.products.filter((product) => kept.has(product) && !product.shown);
    for (;;) {
      const products = context.products.filter((product) => kept.has(product));
      const dropped = context.products.length - products.length;
      const fitted: ChatReadingContext = { ...context, products, truncated: context.truncated || dropped > 0 };
      const counted = tokenizer.within(requestTextOf(describeReadingContext(fitted)), limit);
      if (counted !== false) return { context: fitted, countedInputTokens: counted, droppedProducts: dropped };
      const last = droppable.pop();
      if (!last) return tooLarge();
      kept.delete(last);
    }
  };
}
