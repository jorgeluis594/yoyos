import { err, ok } from "@shared/functional";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ClaimedNotice } from "@core/src/features/orders/domain/seller-notice";
import type { NoticeLocale } from "@core/src/features/orders/application/describe-chat-message-notice";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import type { EventHandler } from "@core/src/shared/events/application/contracts";
import { log } from "@core/src/shared/infrastructure/logger";
import { registerPushDevice, type PushDeviceAccess, type RegisterPushDeviceInput } from "@core/src/features/notifications/application/register-push-device";
import { unregisterPushDevice } from "@core/src/features/notifications/application/unregister-push-device";
import { sendChatMessageNotice, type SendChatMessageNoticeDependencies } from "@core/src/features/notifications/application/send-chat-message-notice";
import { createExpoGateway, createExpoPushSender, disabledPushSender } from "@core/src/features/notifications/infrastructure/expo-push-sender";
import { readNotificationsEnv, type NotificationsEnv } from "@core/src/features/notifications/infrastructure/notifications-env";
import { pushDeviceRepository } from "@core/src/features/notifications/infrastructure/push-device-repository";

export const pushDevices = {
  register: (input: RegisterPushDeviceInput, access: PushDeviceAccess) => registerPushDevice(input, access, {
    save: pushDeviceRepository.save,
    onRegistered: (event) => log.info({ event: "notifications_push_device_registered", ...event }, "notifications_push_device_registered"),
  }),
  unregister: (token: string) => unregisterPushDevice({ token }, { removeByToken: pushDeviceRepository.removeByToken }),
};

export function createPushSender(env: NotificationsEnv): SendChatMessageNoticeDependencies["sendPush"] {
  return env.PUSH_PROVIDER === "expo"
    ? createExpoPushSender(createExpoGateway(env.EXPO_ACCESS_TOKEN), { ttlSeconds: env.PUSH_NOTICE_TTL_SECONDS })
    : disabledPushSender;
}

/** The send handler's infrastructure half; the orders capabilities (claim, describe, release) come in `sendChatMessageNoticeHandler`. */
export function pushNoticeDependencies(env: NotificationsEnv = readNotificationsEnv()): Pick<SendChatMessageNoticeDependencies, "findDeviceForSession" | "sendPush" | "removeDevice"> {
  return {
    findDeviceForSession: pushDeviceRepository.findForSession,
    sendPush: createPushSender(env),
    removeDevice: pushDeviceRepository.remove,
  };
}

export { sendChatMessageNotice };

/** What the handler needs from orders; `src/composition` supplies it so notifications does not depend on orders. */
export type NoticeOrders = Readonly<{
  claimChatMessageNotice: (messageId: ChatMessageId) => ReturnType<SendChatMessageNoticeDependencies<ClaimedNotice>["claimNotice"]>;
  describeChatMessageNotice: (claim: ClaimedNotice, locale: NoticeLocale) => ReturnType<SendChatMessageNoticeDependencies<ClaimedNotice>["describeNotice"]>;
  releaseChatMessageNotice: (messageId: ChatMessageId) => ReturnType<SendChatMessageNoticeDependencies["releaseNotice"]>;
}>;

/** Handler of `chat_message_processed`: claims the notice in orders, then sends it to the phone that registered the message. */
export function createSendChatMessageNoticeHandler(
  infrastructure: Pick<SendChatMessageNoticeDependencies, "findDeviceForSession" | "sendPush" | "removeDevice">,
  orders: NoticeOrders,
): EventHandler<AppEvents, "chat_message_processed"> {
  return (payload, _metadata, context) => withTenantIsolation(payload.companyId, async () => {
    const base = { companyId: payload.companyId, messageId: payload.messageId, attempt: context.attempt };
    const result = await sendChatMessageNotice<ClaimedNotice>(payload, { attempt: context.attempt }, {
      ...infrastructure,
      claimNotice: (messageId) => orders.claimChatMessageNotice(messageId as ChatMessageId),
      describeNotice: (claim, locale) => orders.describeChatMessageNotice(claim, locale),
      releaseNotice: (messageId) => orders.releaseChatMessageNotice(messageId as ChatMessageId),
      onSent: (sent) => log.info({ event: "notifications_notice_sent", ...base, ...sent }, "notifications_notice_sent"),
    });
    if (!result.success) return err(result.error);
    if (result.data.status === "dropped") log.info({ event: "notifications_notice_dropped", ...base, reason: result.data.reason }, "notifications_notice_dropped");
    return ok(undefined);
  });
}
