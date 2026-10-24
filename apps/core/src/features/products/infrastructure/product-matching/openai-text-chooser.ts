import OpenAI from "openai";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductMatcherError, TextCandidate, TextChoice, VariantChoice, VariantChoiceInput } from "@core/src/features/products/domain/text-identification";
import { labelFor, NONE } from "@core/src/features/products/infrastructure/product-matching/product-chooser";

export type OpenAITextChooserConfig = Readonly<{ client: OpenAI; model: string; timeoutMs: number; companyId: () => string }>;

// Timeout, network, 429 and 5xx are transient; any other failure means the request or the reply is wrong.
function failureCode(cause: unknown): ProductMatcherError["code"] {
  const status = cause instanceof OpenAI.APIError ? cause.status : undefined;
  return cause instanceof OpenAI.APIConnectionError || cause instanceof OpenAI.APIUserAbortError || (status !== undefined && (status === 429 || status >= 500)) ? "PRODUCT_MATCHER_UNAVAILABLE" : "INVALID_MATCHER_RESPONSE";
}

const answerSchema = (labels: readonly string[]) => z.object({
  choice: z.union([z.enum(labels as [string, ...string[]]), z.literal(NONE)]), confidence: z.number().min(0).max(1),
  probabilities: z.array(z.object({ value: z.string(), probability: z.number().min(0).max(1) })),
});

type Asked = Readonly<{ label: string | null; confidence: number; probabilities: ReadonlyMap<string, number> }>;
type Question = Readonly<{ event: string; instructions: string; text: string; labels: readonly string[]; descriptions: readonly string[] }>;

/** One choice question over labeled options plus none, as text only (no images). Names and words are never logged. */
async function askChoice(config: OpenAITextChooserConfig, question: Question, signal: AbortSignal): Promise<Result<Asked, ProductMatcherError>> {
  const started = performance.now();
  const fields = () => ({ companyId: config.companyId(), model: config.model, durationMs: Math.round(performance.now() - started) });
  let decision: OpenAI.Decision;
  try {
    decision = await config.client.decisions.create({ model: config.model, input: [{ role: "user", content: [{ type: "input_text", text: question.text }] }], questions: [{
      type: "choice", name: "choice", instructions: question.instructions,
      choices: [...question.labels.map((value, index) => ({ value, description: question.descriptions[index] ?? value })), { value: NONE, description: "None of the options" }],
    }] }, { timeout: config.timeoutMs, maxRetries: 0, signal }); // the event bus owns retries; the signal is the job deadline
  } catch (cause) {
    const code = failureCode(cause);
    log.warn({ event: `${question.event}_request_failed`, ...fields(), errorCode: code, httpStatus: cause instanceof OpenAI.APIError ? cause.status : undefined, err: cause }, `${question.event}_request_failed`);
    return err({ code, message: "Product matcher request failed" });
  }
  const answer = decision.answers?.[0];
  const parsed = answerSchema(question.labels).safeParse(answer?.type === "choice" ? answer : null);
  if (!parsed.success) {
    log.error({ event: `${question.event}_invalid_response`, ...fields(), errorCode: "INVALID_MATCHER_RESPONSE", err: { answerType: answer?.type ?? null } }, `${question.event}_invalid_response`);
    return err({ code: "INVALID_MATCHER_RESPONSE", message: "Unexpected matcher output" });
  }
  log.info({ event: `${question.event}_completed`, ...fields(), candidates: question.labels.length, outcome: parsed.data.choice === NONE ? "none" : "choice",
    confidence: parsed.data.confidence, inputTokens: decision.usage?.input_tokens, outputTokens: decision.usage?.output_tokens }, `${question.event}_completed`);
  return ok({ label: parsed.data.choice === NONE ? null : parsed.data.choice, confidence: parsed.data.confidence,
    probabilities: new Map(parsed.data.probabilities.map(({ value, probability }) => [value, probability])) });
}

const money = ({ amount, currency }: Money) => `${amount} ${currency}`;
const priceRange = ({ minPrice, maxPrice }: TextCandidate) => minPrice.amount === maxPrice.amount ? money(minPrice) : `${money(minPrice)} to ${money(maxPrice)}`;

type TextChooserInput = Readonly<{ mention: string; priceHint: number | null; candidates: readonly TextCandidate[] }>;

/** Chooses the catalog product a customer's words name; the price the customer mentioned is a hint, never a requirement. */
export function createOpenAITextProductChooser(config: OpenAITextChooserConfig) {
  return async (input: TextChooserInput, signal: AbortSignal): Promise<Result<TextChoice, ProductMatcherError>> => {
    const labels = input.candidates.map((_, index) => labelFor(index));
    const asked = await askChoice(config, {
      event: "product_text_match", labels, descriptions: input.candidates.map(({ name }) => name),
      instructions: "Decide which catalog product the customer is referring to. The customer's price, when given, is a hint to tell similar products apart, never a reason to reject the only product the words name. "
        + `Answer with the option label, or "${NONE}" if no option is clearly the product.`,
      text: [`Customer words: ${input.mention}`, input.priceHint ? `Price per unit the customer mentioned: ${input.priceHint}, to compare with each product's price in that product's own currency; it may be an offer below that price` : null,
        "Catalog products:", ...input.candidates.map((candidate, index) => `${labels[index]}: ${candidate.name} (${priceRange(candidate)})`)].filter((line) => line !== null).join("\n"),
    }, signal);
    if (!asked.success) return asked;
    const byLabel = (label: string | null) => (label === null ? undefined : input.candidates[labels.indexOf(label)]);
    return ok({ productId: byLabel(asked.data.label)?.productId ?? null, confidence: asked.data.confidence,
      probabilities: input.candidates.map(({ productId }, index): { productId: ProductId; probability: number } => ({ productId, probability: asked.data.probabilities.get(labels[index]!) ?? 0 })) });
  };
}

const describeVariant = ({ variantAttributes }: CatalogItem) => Object.entries(variantAttributes).map(([name, value]) => `${name}: ${value}`).join(", ") || "single variant";

/** Chooses among the sellable variants of one product from the customer's words. */
export function createOpenAIVariantChooser(config: OpenAITextChooserConfig) {
  return async (input: VariantChoiceInput, signal: AbortSignal): Promise<Result<VariantChoice, ProductMatcherError>> => {
    const labels = input.variants.map((_, index) => labelFor(index));
    const asked = await askChoice(config, {
      event: "product_variant_match", labels, descriptions: input.variants.map(describeVariant),
      instructions: "Decide which variant the customer asks for. The words may be a plural, feminine or diminutive form of a value (rojas is Rojo, negrita is Negro, eme is M). "
        + `Answer with the option label, or "${NONE}" if no option is clearly the variant asked for.`,
      text: [`Customer words: ${input.words.join(" ")}`, "Variants:", ...input.variants.map((variant, index) => `${labels[index]}: ${describeVariant(variant)}`)].join("\n"),
    }, signal);
    if (!asked.success) return asked;
    const chosen = asked.data.label === null ? undefined : input.variants[labels.indexOf(asked.data.label)];
    return ok({ variantId: (chosen?.variantId ?? null) as VariantId | null, confidence: asked.data.confidence });
  };
}
