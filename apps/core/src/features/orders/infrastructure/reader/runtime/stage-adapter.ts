import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ModelUsage, StageCall } from "@core/src/features/orders/domain/reader/readings";
import type { StageError, StageResult } from "@core/src/features/orders/application/reader/stages";
import { log } from "@core/src/shared/infrastructure/logger";
import { priceOf } from "@core/src/shared/infrastructure/model-prices";
import type { StageVersion } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import { logMetaOf, remainingMsOf } from "@core/src/features/orders/infrastructure/reader/runtime/reading-deadline";
import type { ReaderStageConfig } from "@core/src/features/orders/infrastructure/reader/runtime/stage-config-env";
import type { StructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";

/** A stage does not start with less than this left of the reading budget. */
export const MIN_STAGE_START_MS = 2000;

export type StageRunner<Input, Output> = (input: Input, signal: AbortSignal) => Promise<Result<StageResult<Output>, StageError>>;

type StageAdapterDependencies<Input, Output> = Readonly<{
  config: ReaderStageConfig;
  version: StageVersion<Input, Output>;
  model: StructuredModel;
  now?: () => number;
}>;

const addUsage = (total: ModelUsage | null, usage: ModelUsage | null): ModelUsage | null => !usage ? total : !total ? usage : ({
  inputTokens: total.inputTokens + usage.inputTokens, cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
  outputTokens: total.outputTokens + usage.outputTokens, reasoningTokens: total.reasoningTokens + usage.reasoningTokens,
});

/** Dollars from the price table; null for a model without a price or a call without usage. Reasoning tokens are part of the output tokens. */
function costOf(provider: string, model: string, usage: ModelUsage | null): number | null {
  const price = provider === "fake" ? null : priceOf(model);
  return price && usage ? (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000 : null;
}

/**
 * A stage: a prompt version, its parser and a structured model. One attempt per call, plus one retry when the answer is invalid; provider
 * failures and deadlines are not retried here (the event bus retries the message). The stage's timeout is capped by what is left of the
 * reading budget, and the stage does not start with less than two seconds left.
 */
export function createStageAdapter<Input, Output>({ config, version, model, now = Date.now }: StageAdapterDependencies<Input, Output>): StageRunner<Input, Output> {
  return async (input, signal) => {
    const started = now();
    const fields = { ...logMetaOf(signal), stage: config.stage, reading: config.reading, model: config.model, promptVersion: config.promptVersion };
    let usage: ModelUsage | null = null;
    let attempts = 0;
    const call = (): StageCall => ({ stage: config.stage, reading: config.reading, provider: config.provider, model: config.model, promptVersion: config.promptVersion,
      usage, costUsd: costOf(config.provider, config.model, usage), durationMs: Math.max(0, now() - started), attempts: Math.max(1, attempts) as 1 | 2 });
    const fail = (code: StageError["code"], message: string): Result<never, StageError> => {
      const error: StageError = { code, stage: config.stage, call: attempts === 0 ? null : call(), message };
      const retryable = code !== "INVALID_AI_RESPONSE";
      log[retryable ? "warn" : "error"]({ event: "reader_stage_failed", ...fields, errorCode: code, durationMs: now() - started, attempts }, "reader_stage_failed");
      return err(error);
    };

    let lastInvalid = "The AI answer was invalid";
    while (attempts < 2) {
      const remaining = remainingMsOf(signal, now);
      if (signal.aborted || remaining < MIN_STAGE_START_MS) return fail("DEADLINE_EXCEEDED", "Not enough of the reading budget is left to start the stage");
      attempts += 1;
      const stageSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.min(config.timeoutMs, remaining))]);
      const answer = await model({
        stage: config.stage, model: config.model, instructions: version.instructions, input: version.renderInput(input),
        schemaName: version.schemaName, jsonSchema: version.jsonSchema, reasoningEffort: version.reasoningEffort, maxOutputTokens: version.maxOutputTokens,
      }, stageSignal);
      if (!answer.success) {
        if (stageSignal.aborted) return fail("DEADLINE_EXCEEDED", "The stage passed its deadline");
        if (answer.error.code !== "INVALID_AI_RESPONSE") return fail(answer.error.code, answer.error.message);
        lastInvalid = answer.error.message;
      } else {
        usage = addUsage(usage, answer.data.usage);
        const parsed = version.parse(answer.data.json, input);
        if (parsed.success) {
          const finished = call();
          log.info({ event: "reader_stage_completed", ...fields, provider: config.provider, inputTokens: usage?.inputTokens, cachedTokens: usage?.cachedInputTokens,
            outputTokens: usage?.outputTokens, reasoningTokens: usage?.reasoningTokens, costUsd: finished.costUsd, durationMs: finished.durationMs, attempts }, "reader_stage_completed");
          return ok({ value: parsed.data, call: finished });
        }
        lastInvalid = parsed.error.message;
      }
      if (attempts < 2) log.warn({ event: "reader_stage_retried_invalid_answer", ...fields }, "reader_stage_retried_invalid_answer");
    }
    const fallback = version.fallback?.(input);
    if (fallback !== undefined && fallback !== null) {
      const finished = call();
      log.info({ event: "reader_stage_completed", ...fields, costUsd: finished.costUsd, durationMs: finished.durationMs, attempts }, "reader_stage_completed");
      return ok({ value: fallback, call: finished });
    }
    return fail("INVALID_AI_RESPONSE", lastInvalid);
  };
}
