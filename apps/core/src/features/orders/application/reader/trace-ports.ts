import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatSourceMessage } from "@core/src/features/orders/application/apply-chat-message";
import type { ReadingContextData } from "@core/src/features/orders/application/reader/load-reading-context";
import type { StageRecord } from "@core/src/features/orders/application/reader/run-reading";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { DecidedAction } from "@core/src/features/orders/domain/reader/decide-changes";
import type { VerifiedRequest } from "@core/src/features/orders/domain/reader/quotes";
import type { IntentReading, RequestIntent } from "@core/src/features/orders/domain/reader/readings";
import type { MaskedText, MessageTrace, TracePhoto, TraceShadow } from "@core/src/features/orders/domain/reader/trace";

/**
 * Call site contract between `applyChatMessage` (T13 flow) and the trace and shadow builders. The flow calls `buildMessageTrace` after the commit
 * and the shadow reader when the reading starts; neither is called inside the transaction.
 */

export type BuildMessageTraceInput = Readonly<{
  message: Readonly<{ id: ChatMessageId; companyId: CompanyId; receivedAt: Date; text: string | null; caption: string | null }>;
  /** The trace expires `retentionDays` after the message (`receivedAt`), as do the masks it creates. */
  retentionDays: number;
  startedAt: Date;
  /** When the transaction committed; null when the reading ended without one. */
  decidedAt: Date | null;
  queuedMs: number;
  shadowWaitMs: number | null;
  /** The intent answer as read (spans included). Null when the intent stage failed or was not run: the current text is then withheld. */
  intent: IntentReading | null;
  /** The context the reading used: the ids of its kept messages, their texts by ref, and the masks already stored (never re-masked). Null without a reading. */
  context: ReadingContextData | null;
  photo: TracePhoto | null;
  /** Every stage call, in finishing order, with the summaries of its input and its masked output. */
  records: readonly StageRecord[];
  /** The verified requests of the primary chain, in order: `quotes[i]` is the masked quote (at most `maxTraceQuoteChars`) of `requests[i]`, with id `i`. */
  requests: readonly VerifiedRequest[];
  /** The intents of the primary chain, which hold the quote of each request. */
  intents: readonly RequestIntent[];
  decisions: readonly DecidedAction[];
  shadow: TraceShadow | null;
}>;

export type BuiltMessageTrace = Readonly<{
  trace: MessageTrace;
  /** Only the texts with no stored mask yet: the current message (unless withheld) and the context messages the intent stage saw unmasked. */
  masks: readonly MaskedText[];
}>;

/** Pure: no clock and no I/O. `textState` is `withheld` when `intent` is null. */
export type BuildMessageTrace = (input: BuildMessageTraceInput) => BuiltMessageTrace;

/**
 * The legacy single reader, run beside the staged one in phase 5 and never applied. It resolves with its answer kinds and usage, or null when it
 * failed (it logs `reader_shadow_failed` itself). The promise never rejects. It stops when `signal` aborts.
 */
export type LegacyShadowReader = (message: ChatSourceMessage, signal: AbortSignal) => Promise<TraceShadow | null>;

/** `READER_SHADOW_LEGACY` (default true) and `READER_SHADOW_WAIT_MS` (default 3000). */
export type ShadowConfig = Readonly<{ legacy: boolean; waitMs: number }>;
