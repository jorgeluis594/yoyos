import type { Result } from "@shared/result";
import type { ModelUsage, ReaderStage } from "@core/src/features/orders/domain/reader/readings";
import type { StageError } from "@core/src/features/orders/application/reader/stages";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
export type Provider = "openai" | "fake";

/** What a stage version asks of a model: the fixed instructions, the rendered input and the strict answer schema. */
export type StructuredModelRequest = Readonly<{
  stage: ReaderStage; model: string; instructions: string; input: string;
  schemaName: string; jsonSchema: Readonly<Record<string, unknown>>; reasoningEffort: ReasoningEffort; maxOutputTokens: number;
}>;
/** The answer is parsed JSON, not yet validated: the stage version's parser owns that. */
export type StructuredModelAnswer = Readonly<{ json: unknown; usage: ModelUsage | null }>;
/** Exists only in infrastructure; the application sees one named port per stage. */
export type StructuredModel = (request: StructuredModelRequest, signal: AbortSignal) => Promise<Result<StructuredModelAnswer, StageError>>;

export const failureOf = (request: StructuredModelRequest, code: StageError["code"], message: string): Result<never, StageError> =>
  ({ success: false, error: { code, stage: request.stage, call: null, message } });
