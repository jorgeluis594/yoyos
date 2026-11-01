import type { PromptRegistry, StageVersion } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import type { IntentReading, ReadingInput } from "@core/src/features/orders/domain/reader/readings";
import { parseIntentAnswer } from "@core/src/features/orders/infrastructure/reader/stages/intent/intent-parser";
import { intentInstructions, intentJsonSchema } from "@core/src/features/orders/infrastructure/reader/stages/intent/intent.v1";
import { renderIntentInput } from "@core/src/features/orders/infrastructure/reader/stages/intent/render-intent-input";

const intentV1: StageVersion<ReadingInput, IntentReading> = {
  stage: "intent", version: "intent-v1", instructions: intentInstructions, schemaName: "intent_answer", jsonSchema: intentJsonSchema,
  reasoningEffort: "none", maxOutputTokens: 1500,
  renderInput: (input) => renderIntentInput(input),
  parse: parseIntentAnswer,
};

/** The prompt versions of the intent stage, keyed by version («intent-v1»). */
export const intentVersions: PromptRegistry["intent"] = { "intent-v1": intentV1 };
