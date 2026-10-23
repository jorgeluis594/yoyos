import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import type { EventHandler, EventHandlerContext, EventHandlerError, EventMetadata } from "@core/src/shared/events/application/contracts";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import { isRetryableChatMessageError, type ApplyChatMessageError, type ApplyChatMessageOutcome, type PermanentChatMessageErrorCode } from "@core/src/features/orders/application/apply-chat-message";
import type { PublishChatMessageProcessed } from "@core/src/features/orders/application/events";
import type { ChatMessageFailureCode } from "@core/src/features/orders/domain/chat-message-outcome";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

type Payload = Readonly<{ companyId: string; chatId: string; messageId: string }>;
type FailedOutcomeResult = Readonly<{ publishNotice: boolean }>;

export type ChatMessageHandlerDependencies = Readonly<{
  /** Runs the work with the tenant isolation of the company. */
  withTenant: <T>(companyId: string, work: () => T) => T;
  apply: (input: Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>, signal: AbortSignal) => Promise<Result<ApplyChatMessageOutcome, ApplyChatMessageError>>;
  /** Records `failed` unless the message has an outcome; says whether a notice must be published. */
  recordFailedOutcome: (messageId: ChatMessageId, errorCode: ChatMessageFailureCode) => Promise<Result<FailedOutcomeResult, Readonly<{ code: string; message: string }>>>;
  publishNotice: PublishChatMessageProcessed;
  /** Time one attempt may take, including every provider call. */
  deadlineMs: number;
  /** Retries after the first attempt, to tell a scheduled retry from the last attempt. */
  retries: number;
}>;

const ids = (payload: Payload) => ({ companyId: payload.companyId as CompanyId, messageId: payload.messageId as ChatMessageId });

async function publishNotice(deps: ChatMessageHandlerDependencies, payload: Payload, metadata: EventMetadata): Promise<void> {
  const published = await deps.withTenant(payload.companyId, () => deps.publishNotice(ids(payload)));
  if (!published.success) log.warn({ event: "orders_chat_message_notice_publish_failed", companyId: payload.companyId, messageId: payload.messageId,
    eventId: metadata.eventId, errorCode: published.error.code }, "orders_chat_message_notice_publish_failed");
}

const retryable = (error: Readonly<{ code: string; message: string }>): EventHandlerError => ({ code: error.code, message: error.message, retryable: true });

/** Handler of `message_created`: applies the message, publishes its notice after the commit and decides what deserves a retry. */
export function createChatMessageHandler(deps: ChatMessageHandlerDependencies): EventHandler<AppEvents, "message_created"> {
  return async (payload, metadata, context: EventHandlerContext) => {
    const started = performance.now();
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(deps.deadlineMs)]);
    const base = () => ({ companyId: payload.companyId, messageId: payload.messageId, eventId: metadata.eventId, attempt: context.attempt });
    const result = await deps.withTenant(payload.companyId, () => deps.apply(ids(payload), signal));
    const durationMs = () => Math.round(performance.now() - started);
    if (result.success) {
      const outcome = result.data;
      if (outcome.kind === "skipped") log.info({ event: "orders_chat_message_skipped", ...base(), reason: outcome.reason }, "orders_chat_message_skipped");
      else if (outcome.kind === "applied") log.info({ event: "orders_chat_message_applied", ...base(), chatId: payload.chatId, orderId: outcome.orderId, createdOrder: outcome.createdOrder,
        outcomeKinds: outcome.outcomes.map(({ kind }) => kind), tools: outcome.trace.tools, extraction: outcome.trace.extraction, decisionCalls: outcome.trace.decisionCalls,
        noticeDue: outcome.noticeDue, durationMs: durationMs() }, "orders_chat_message_applied");
      else log.info({ event: "orders_chat_message_skipped", ...base(), reason: "already_processed" }, "orders_chat_message_skipped");
      if (outcome.kind !== "skipped" && outcome.noticeDue) await publishNotice(deps, payload, metadata);
      return ok(undefined);
    }
    const error = result.error;
    if (isRetryableChatMessageError(error)) {
      // The last attempt is not a retry: the dead-letter handler reports the failure.
      if (context.attempt <= deps.retries) log.warn({ event: "orders_chat_message_retry_scheduled", ...base(), stage: "apply", errorCode: error.code, durationMs: durationMs() }, "orders_chat_message_retry_scheduled");
      return err(retryable(error));
    }
    const recorded = await deps.withTenant(payload.companyId, () => deps.recordFailedOutcome(payload.messageId as ChatMessageId, error.code as PermanentChatMessageErrorCode));
    if (!recorded.success) {
      log.warn({ event: "orders_chat_message_retry_scheduled", ...base(), stage: "record_failed_outcome", errorCode: recorded.error.code, durationMs: durationMs() }, "orders_chat_message_retry_scheduled");
      return err(retryable(recorded.error));
    }
    log.error({ event: "orders_chat_message_failed", ...base(), stage: "apply", errorCode: error.code, source: "permanent" }, "orders_chat_message_failed");
    if (recorded.data.publishNotice) await publishNotice(deps, payload, metadata);
    return ok(undefined);
  };
}

/**
 * Handler of the dead-letter queue: a message whose retries ran out or whose job died is recorded as failed so the chat's
 * queue moves on. It never ends in a permanent error: that would leave the chat's key blocked, so every failure is retried.
 */
export function createChatMessageDeadLetterHandler(deps: ChatMessageHandlerDependencies): EventHandler<AppEvents, "message_created"> {
  return async (payload, metadata, context) => {
    const recorded = await deps.withTenant(payload.companyId, () => deps.recordFailedOutcome(payload.messageId as ChatMessageId, "RETRIES_EXHAUSTED"));
    if (!recorded.success) {
      log.error({ event: "orders_chat_message_retry_scheduled", companyId: payload.companyId, messageId: payload.messageId, eventId: metadata.eventId,
        attempt: context.attempt, stage: "dead_letter", errorCode: recorded.error.code }, "orders_chat_message_retry_scheduled");
      return err(retryable(recorded.error));
    }
    log.error({ event: "orders_chat_message_failed", companyId: payload.companyId, messageId: payload.messageId, eventId: metadata.eventId,
      attempt: context.attempt, stage: "dead_letter", errorCode: "RETRIES_EXHAUSTED", source: "dead_letter" }, "orders_chat_message_failed");
    if (recorded.data.publishNotice) await publishNotice(deps, payload, metadata);
    return ok(undefined);
  };
}
