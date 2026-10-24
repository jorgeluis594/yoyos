import OpenAI from "openai";
import type { DecisionInputPart } from "openai/resources/decisions";
import { err } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import type { ChooseProduct } from "@core/src/features/products/application/identify-products-in-image";
import { buildChooserPrompt, NONE, parseChooserOutput, SHOWS_PRODUCT, showsProductInstructions, toDataUrl, type ChooserError } from "@core/src/features/products/infrastructure/product-matching/product-chooser";

export type OpenAIProductChooserConfig = Readonly<{ client: OpenAI; model: string; timeoutMs: number; companyId: () => string }>;

// Timeout, network, 429 and 5xx are transient; any other failure means the request or the reply is wrong.
function failureCode(cause: unknown): ChooserError["code"] {
  const status = cause instanceof OpenAI.APIError ? cause.status : undefined;
  return cause instanceof OpenAI.APIConnectionError || (status !== undefined && (status === 429 || status >= 500))
    ? "PRODUCT_MATCHER_UNAVAILABLE" : "INVALID_MATCHER_RESPONSE";
}

/** ChooseProduct over the OpenAI Decisions API: one choice question whose options are the candidate labels and none. */
export function createOpenAIProductChooser(config: OpenAIProductChooserConfig): ChooseProduct {
  return async (input) => {
    const prompt = await buildChooserPrompt(input);
    if (!prompt.success) return prompt;
    const { labels } = prompt.data;
    const content = prompt.data.parts.map((part): DecisionInputPart => part.kind === "text"
      ? { type: "input_text", text: part.text } : { type: "input_image", image_url: toDataUrl(part.image) });
    const started = performance.now();
    const fields = () => ({ companyId: config.companyId(), model: config.model, durationMs: Math.round(performance.now() - started) });
    let decision: OpenAI.Decision;
    try {
      decision = await config.client.decisions.create({ model: config.model, input: [{ role: "user", content }], questions: [{
        type: "choice", name: "product", instructions: prompt.data.instructions,
        choices: [...labels.map((value) => ({ value, description: `Candidate ${value}` })), { value: NONE, description: "None of the candidates" }],
      }, { type: "predicate", name: SHOWS_PRODUCT, instructions: showsProductInstructions }] }, { timeout: config.timeoutMs, maxRetries: 0 }); // the event bus owns retries
    } catch (cause) {
      const code = failureCode(cause);
      log.warn({ event: "product_matcher_request_failed", ...fields(), errorCode: code, httpStatus: cause instanceof OpenAI.APIError ? cause.status : undefined, err: cause }, "product_matcher_request_failed");
      return err({ code, message: "Product matcher request failed" });
    }
    const answer = decision.answers?.find(({ name }) => name === "product");
    const shows = decision.answers?.find(({ name }) => name === SHOWS_PRODUCT);
    const choice = parseChooserOutput(answer?.type === "choice" && shows?.type === "predicate"
      ? { choice: answer.choice, confidence: answer.confidence, showsProduct: shows.probability } : answer, input, labels);
    if (!choice.success) {
      log.error({ event: "product_matcher_invalid_response", ...fields(), errorCode: choice.error.code, err: { answerType: answer?.type ?? null } }, "product_matcher_invalid_response");
      return choice;
    }
    log.info({ event: "product_visual_match_completed", ...fields(), candidates: input.candidates.length, detail: input.detail?.kind ?? null, choice: choice.data.kind,
      confidence: choice.data.kind === "product" ? choice.data.confidence : undefined, showsProduct: choice.data.showsProduct,
      inputTokens: decision.usage?.input_tokens, outputTokens: decision.usage?.output_tokens }, "product_visual_match_completed");
    return choice;
  };
}
