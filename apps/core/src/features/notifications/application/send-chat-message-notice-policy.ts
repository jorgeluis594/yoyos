import type { HandlerPolicy } from "@core/src/shared/events/application/contracts";
import type { ChatMessageProcessed } from "@core/src/features/orders/application/events";

export const sendChatMessageNoticeQueueId = "send-chat-message-notice";

/**
 * A notice is secondary: the queue has no ordering key, so an outage of the push provider never holds a chat back.
 * Retries wait 15, 30, 60, 120 and 150 seconds, so a provider that stays down ends the job after 6 to 10 minutes.
 */
export const sendChatMessageNoticePolicy: HandlerPolicy<ChatMessageProcessed> = {
  concurrency: 4,
  retries: 5,
  retryDelaySeconds: 15,
  exponentialBackoff: true,
  retryDelayMaxSeconds: 150,
  expireInSeconds: 15,
  deleteAfterSeconds: 7 * 24 * 3600,
};
