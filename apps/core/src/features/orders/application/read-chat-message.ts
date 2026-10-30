import type { Result } from "@shared/result";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { ChatReadingContext, ReaderAnswer } from "@core/src/features/orders/domain/chat-reading";

export type ReaderUsage = Readonly<{ inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number }>;
export type ReaderReading = Readonly<{ answer: ReaderAnswer; usage: ReaderUsage }>;
export type ReaderError = Readonly<{ code: "AI_PROVIDER_UNAVAILABLE" | "DEADLINE_EXCEEDED" | "INVALID_AI_RESPONSE"; message: string }>;

/** A reading context fitted to the input-token budget of its kind, with what the fit counted and cut. */
export type FittedReadingContext = Readonly<{ context: ChatReadingContext; countedInputTokens: number; droppedProducts: number }>;
/** The part of the request that is never cut does not fit the budget: no reader call. `countedInputTokens` is the budget plus one ("over budget"), not a measured size: the count stops at the limit. */
export type ContextTooLarge = Readonly<{ code: "CONTEXT_TOO_LARGE"; message: string; countedInputTokens: number }>;

/** The reader port: one model call that turns the message and its context into a `ReaderAnswer`. */
export type ReadChatMessage = (
  context: ChatReadingContext,
  meta: Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>,
  signal: AbortSignal,
) => Promise<Result<ReaderReading, ReaderError>>;
