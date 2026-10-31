import { z } from "zod";
import type { HandlerPolicy, RetryPolicy } from "@core/src/shared/events/application/contracts";
import type { MessageCreated } from "@core/src/features/chats/application/events";

/** Leaf module: event-handlers reads the policy while loading, before the handler composition exists. */
export const applyChatMessageQueueId = "apply-chat-message";
export const applyChatMessageDeadLetterId = "apply-chat-message-dead-letter";

/** One attempt ends by this deadline; `expireInSeconds` (90) is the safety net behind it. */
export const chatMessageDeadlineMs = 85_000;

/**
 * Most apply-chat-message jobs one worker runs at once. The worker's pool (`DATABASE_POOL_MAX` 28) is sized from it: 16 messages, 4 notices,
 * 2 for the second policy below, 1 for the shared event handlers and 1 for photo indexing make 24, plus 4 of headroom.
 * The invariant that protects the pool: a job never waits for a second connection while it holds a transaction open
 * (no query on the base client inside an open transaction). Raising this bound means resizing the pool.
 */
export const applyChatMessageConcurrencyMax = 16;
const concurrencySchema = z.coerce.number().int().min(1).max(applyChatMessageConcurrencyMax).default(applyChatMessageConcurrencyMax);

/** Invalid values fail at startup; empty counts as unset. */
export const readApplyChatMessageConcurrency = (env: Readonly<Record<string, string | undefined>>): number =>
  concurrencySchema.parse(env.APPLY_CHAT_MESSAGE_CONCURRENCY === "" ? undefined : env.APPLY_CHAT_MESSAGE_CONCURRENCY);

const sevenDaysInSeconds = 7 * 24 * 3600;

/**
 * Messages of one chat run one at a time in arrival order; a company never takes more than half of a worker's slots.
 * A job that ends failed goes to the dead-letter handler, which releases the chat.
 */
export const chatMessagePolicy: HandlerPolicy<MessageCreated> = {
  concurrency: readApplyChatMessageConcurrency(process.env),
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
