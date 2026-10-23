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

/** The send handler's infrastructure half; T12 adds the orders capabilities (claim, describe, release) and registers the handler. */
export function pushNoticeDependencies(env: NotificationsEnv = readNotificationsEnv()): Pick<SendChatMessageNoticeDependencies, "findDeviceForSession" | "sendPush" | "removeDevice"> {
  return {
    findDeviceForSession: pushDeviceRepository.findForSession,
    sendPush: createPushSender(env),
    removeDevice: pushDeviceRepository.remove,
  };
}

export { sendChatMessageNotice };
