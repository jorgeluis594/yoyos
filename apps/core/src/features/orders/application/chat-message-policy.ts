import type { HandlerPolicy, RetryPolicy } from "@core/src/shared/events/application/contracts";
import type { MessageCreated } from "@core/src/features/chats/application/events";

/** Leaf module: event-handlers reads the policy while loading, before the handler composition exists. */
export const applyChatMessageQueueId = "apply-chat-message";
export const applyChatMessageDeadLetterId = "apply-chat-message-dead-letter";

/** One attempt ends by this deadline; `expireInSeconds` (90) is the safety net behind it. */
export const chatMessageDeadlineMs = 85_000;

const sevenDaysInSeconds = 7 * 24 * 3600;

/**
 * Messages of one chat run one at a time in arrival order; a company never takes more than half of a worker's slots.
 * A job that ends failed goes to the dead-letter handler, which releases the chat.
 */
export const chatMessagePolicy: HandlerPolicy<MessageCreated> = {
  concurrency: Number(process.env.APPLY_CHAT_MESSAGE_CONCURRENCY) || 16,
  groupKey: (payload) => payload.companyId,
  groupConcurrency: 8,
  orderingKey: (payload) => payload.chatId,
  retries: 8,
  retryDelaySeconds: 5,
  exponentialBackoff: true,
  retryDelayMaxSeconds: 100,
  expireInSeconds: 90,
  heartbeatSeconds: 30,
  deleteAfterSeconds: sevenDaysInSeconds,
};

export const chatMessageDeadLetterPolicy: RetryPolicy = {
  retries: 8,
  retryDelaySeconds: 30,
  exponentialBackoff: false,
  concurrency: 2,
  deleteAfterSeconds: sevenDaysInSeconds,
};
