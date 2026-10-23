import { Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { err, ok } from "@shared/functional";
import type { NoticeGateway, NoticePermission, NoticeResponse } from "../application/ports";

export const noticeChannelId = "chat-notices";

function toPermission(response: Notifications.NotificationPermissionsStatus): NoticePermission {
  if (response.granted) return "granted";
  return response.canAskAgain && response.status === Notifications.PermissionStatus.UNDETERMINED ? "undetermined" : "denied";
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(noticeChannelId, { name: "Avisos", importance: Notifications.AndroidImportance.HIGH });
}

function toResponse(response: Notifications.NotificationResponse): NoticeResponse {
  const { identifier, content } = response.notification.request;
  return { id: identifier, data: content.data };
}

export function createExpoNotificationsGateway(): NoticeGateway {
  return {
    permission: async () => toPermission(await Notifications.getPermissionsAsync()),
    requestPermission: async () => {
      await ensureAndroidChannel();
      return toPermission(await Notifications.requestPermissionsAsync());
    },
    openSettings: () => Linking.openSettings(),
    getToken: async () => {
      try {
        await ensureAndroidChannel();
        const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
        const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
        return ok(token.data);
      } catch {
        return err({ code: "NOTICE_UNAVAILABLE", message: "Unable to read the push token" });
      }
    },
    onTokenChange: (listener) => { const subscription = Notifications.addPushTokenListener(listener); return () => subscription.remove(); },
    onResponse: (listener) => { const subscription = Notifications.addNotificationResponseReceivedListener((response) => listener(toResponse(response))); return () => subscription.remove(); },
    lastResponse: async () => {
      const response = Notifications.getLastNotificationResponse();
      return response ? toResponse(response) : null;
    },
    onReceived: (listener) => { const subscription = Notifications.addNotificationReceivedListener((notification) => listener(notification.request.content.data)); return () => subscription.remove(); },
    dismissAll: async () => { try { await Notifications.dismissAllNotificationsAsync(); } catch { /* nothing shown to dismiss */ } },
  };
}
