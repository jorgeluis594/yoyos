import type { Result } from "@shared/result";
import type { ExtractedRequest, IntentReading, ProductMention, ProductResolution, ReaderStage, ReadingInput, RequestIntent } from "@core/src/features/orders/domain/reader/readings";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import { intentVersions } from "@core/src/features/orders/infrastructure/reader/stages/intent/versions";
import { extractionVersions } from "@core/src/features/orders/infrastructure/reader/stages/extraction/versions";
import { resolutionVersions } from "@core/src/features/orders/infrastructure/reader/stages/resolution/versions";
import type { ReasoningEffort } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";

export type ExtractionInput = Readonly<{ input: ReadingInput; intents: readonly RequestIntent[] }>;
export type ResolutionInput = Readonly<{ mentions: readonly ProductMention[]; candidates: readonly ProductForReading[] }>;
/** What each stage takes and gives. */
export type StageIO = Readonly<{
  intent: Readonly<{ input: ReadingInput; output: IntentReading }>;
  extraction: Readonly<{ input: ExtractionInput; output: readonly ExtractedRequest[] }>;
  resolution: Readonly<{ input: ResolutionInput; output: readonly ProductResolution[] }>;
}>;

/**
 * One prompt version of one stage: its fixed instructions, strict schema and settings, the rendering of its input and the parser of its
 * answer. The reasoning effort and the output limit belong to the version. `parse` fails with a reason that never carries model text.
 */
export type StageVersion<Input, Output> = Readonly<{
  stage: ReaderStage; version: string; instructions: string; schemaName: string; jsonSchema: Readonly<Record<string, unknown>>;
  reasoningEffort: ReasoningEffort; maxOutputTokens: number;
  renderInput: (input: Input) => string;
  parse: (answer: unknown, input: Input) => Result<Output>;
}>;

/** The versions of every stage, keyed by prompt version («intent-v1»). Each stage's `versions.ts` fills its own map. */
export type PromptRegistry = Readonly<{ [S in ReaderStage]: Readonly<Record<string, StageVersion<StageIO[S]["input"], StageIO[S]["output"]>>> }>;

export const promptRegistry: PromptRegistry = { intent: intentVersions, extraction: extractionVersions, resolution: resolutionVersions };

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
