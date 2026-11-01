import { defaultReadingBudgets } from "@core/src/features/orders/domain/reader/budgets";
import type { PromptRegistry, ResolutionInput } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";
import { parseResolution, resolutionFallback } from "@core/src/features/orders/infrastructure/reader/stages/resolution/resolution-parser";
import { planResolution } from "@core/src/features/orders/infrastructure/reader/stages/resolution/resolution-plan";
import { resolutionInstructions, resolutionJsonSchema, type ResolutionVersion } from "@core/src/features/orders/infrastructure/reader/stages/resolution/resolution.v1";

/** `resolution-v1` with the stage input budget it renders and parses under (technical design 6.8). */
export function createResolutionV1(maxChars: number): ResolutionVersion {
  return {
    stage: "resolution", version: "resolution-v1", instructions: resolutionInstructions, schemaName: "resolution_answer", jsonSchema: resolutionJsonSchema,
    reasoningEffort: "low", maxOutputTokens: 1500,
    renderInput: (input: ResolutionInput) => planResolution(input, maxChars).text,
    parse: (answer, input) => parseResolution(answer, input, maxChars),
    fallback: (input, lastAnswer) => resolutionFallback(lastAnswer, input, maxChars),
  };
}

/** The prompt versions of the resolution stage, keyed by version («resolution-v1»). */
export const resolutionVersions: PromptRegistry["resolution"] = { "resolution-v1": createResolutionV1(defaultReadingBudgets.stageInputMaxChars) };
