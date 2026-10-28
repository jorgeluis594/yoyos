import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { cleanNoticesOnSignOut } from "@mobile/features/notifications/application/sign-out-notices";
import { createExpoNotificationsGateway } from "@mobile/features/notifications/infrastructure/expo-notifications-gateway";
import { createNoticeStore } from "@mobile/features/notifications/infrastructure/push-registration-store";
import type { RemoteRevocation } from "@mobile/features/users/application/sign-out";

/** Sign-out cleanup: dismisses shown notices and queues an unregister when core was not reached. Native only. */
export async function cleanNotices(revocation: RemoteRevocation): Promise<void> {
  if (Platform.OS === "web") return;
  await cleanNoticesOnSignOut(revocation, { gateway: createExpoNotificationsGateway(), store: createNoticeStore(SecureStore) });
}
