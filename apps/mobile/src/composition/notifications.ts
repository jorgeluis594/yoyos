import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createNoticesController } from "@mobile/features/notifications/application/notices-controller";
import { createExpoNotificationsGateway } from "@mobile/features/notifications/infrastructure/expo-notifications-gateway";
import { createPushDeviceApi } from "@mobile/features/notifications/infrastructure/push-device-api";
import { createNoticeStore } from "@mobile/features/notifications/infrastructure/push-registration-store";
import { confirmNoticePrompt } from "@mobile/features/notifications/presentation/notice-permission-prompt";
import { createCatalogReadinessApi } from "@mobile/features/whatsapp/infrastructure/catalog-readiness-api";
import i18n from "@mobile/i18n";
import { authClient } from "@mobile/shared/infrastructure/auth-client";
import { coreUrl } from "@mobile/shared/infrastructure/core-url";
import { request } from "./auth";

export const notices = createNoticesController({
  gateway: createExpoNotificationsGateway(),
  store: createNoticeStore(SecureStore),
  api: createPushDeviceApi(request, coreUrl),
  platform: Platform.OS === "ios" ? "ios" : "android",
  readSessionId: async () => {
    try {
      const session = await authClient.getSession();
      return session.data?.session.id ?? null;
    } catch {
      return null;
    }
  },
  locale: () => (i18n.language === "pt-BR" ? "pt-BR" : "es"),
  confirm: () => confirmNoticePrompt((key) => i18n.t(key)),
});

export const loadCatalogReadiness = createCatalogReadinessApi(request);

/**
 * A foreground notice is drawn by the system (banner and list entry) only when it belongs to the
 * signed-in company; otherwise it is hidden and its device is queued for unregistering.
 */
export function installForegroundNoticeHandler(): void {
  if (Platform.OS === "web") return;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const show = (await notices.decideForeground(notification.request.content.data)) === "show";
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    },
  });
}
