import type { Result } from "@shared/result";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { ChatReadingContext, ReaderAnswer } from "@core/src/features/orders/domain/chat-reading";

export type ReaderUsage = Readonly<{ inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number }>;
export type ReaderReading = Readonly<{ answer: ReaderAnswer; usage: ReaderUsage }>;
export type ReaderError = Readonly<{ code: "AI_PROVIDER_UNAVAILABLE" | "DEADLINE_EXCEEDED" | "INVALID_AI_RESPONSE"; message: string }>;

/** The reader port: one model call that turns the message and its context into a `ReaderAnswer`. */
export type ReadChatMessage = (
  context: ChatReadingContext,
  meta: Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>,
  signal: AbortSignal,
) => Promise<Result<ReaderReading, ReaderError>>;
