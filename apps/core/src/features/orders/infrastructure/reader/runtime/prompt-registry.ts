import { defaultReadingBudgets } from "@core/src/features/orders/domain/reader/budgets";
import type { ReaderStage } from "@core/src/features/orders/domain/reader/readings";
import type { StageVersion, PromptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import { createIntentVersions } from "@core/src/features/orders/infrastructure/reader/stages/intent/versions";
import { createExtractionVersions } from "@core/src/features/orders/infrastructure/reader/stages/extraction/versions";
import { createResolutionVersions } from "@core/src/features/orders/infrastructure/reader/stages/resolution/versions";

export type { ExtractionInput, ResolutionInput, StageIO, StageVersion, PromptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";

/** The registry whose renderers cut every stage input to `maxChars` (`READER_STAGE_INPUT_MAX_CHARS`, read by the composition). */
export const createPromptRegistry = (maxChars: number): PromptRegistry =>
  ({ intent: createIntentVersions(maxChars), extraction: createExtractionVersions(maxChars), resolution: createResolutionVersions(maxChars) });

/** The registry at the default budget, for tests and tools that read no env. */
export const promptRegistry: PromptRegistry = createPromptRegistry(defaultReadingBudgets.stageInputMaxChars);

export function registeredVersions(registry: PromptRegistry) {
  return (Object.keys(registry) as ReaderStage[]).flatMap((stage) =>
    Object.entries<StageVersion<never, unknown>>(registry[stage]).map(([version, registered]) => ({ stage, version, registered })));
}

/** What a version's pinned `<stage>.<version>.model-text.json` records about the text and settings that reach the model. */
export const modelTextOf = (version: StageVersion<never, unknown>) => ({
  instructions: version.instructions, schemaName: version.schemaName, schema: version.jsonSchema,
  reasoningEffort: version.reasoningEffort, maxOutputTokens: version.maxOutputTokens,
});

/** «intent-v1» is pinned in `intent.v1.model-text.json`. */
export const pinnedModelTextPath = (version: string) => `${version.replace("-", ".")}.model-text.json`;
