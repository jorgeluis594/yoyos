import type { Result } from "@shared/result";
import type { ExtractedRequest, IntentReading, ModelUsage, ProductMention, ProductResolution, ReaderStage, Reading, ReadingInput, RequestIntent, StageCall } from "@core/src/features/orders/domain/reader/readings";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

export type { ModelUsage, ReaderStage, Reading, StageCall };

/** One application port per model stage, named by intention. There is no generic model port in application. */
export type ReaderStages = Readonly<{
  readIntent: (input: ReadingInput, reading: Reading, signal: AbortSignal) => Promise<Result<StageResult<IntentReading>, StageError>>;
  extractRequests: (input: ReadingInput, intents: readonly RequestIntent[], reading: Reading, signal: AbortSignal)
    => Promise<Result<StageResult<readonly ExtractedRequest[]>, StageError>>;
  chooseProducts: (mentions: readonly ProductMention[], candidates: readonly ProductForReading[], reading: Reading, signal: AbortSignal)
    => Promise<Result<StageResult<readonly ProductResolution[]>, StageError>>;
  /** Which stages have a confirming configuration. */
  confirms: Readonly<Record<ReaderStage, boolean>>;
}>;
export type StageResult<T> = Readonly<{ value: T; call: StageCall }>;
export type StageError = Readonly<{ code: "AI_PROVIDER_UNAVAILABLE" | "DEADLINE_EXCEEDED" | "INVALID_AI_RESPONSE"; stage: ReaderStage; call: StageCall | null; message: string }>;
