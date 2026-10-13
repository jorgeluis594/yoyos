import { randomUUID } from "node:crypto";
import { registerMobileMessage as register } from "@core/src/features/chats/application/register-mobile-message";
import { dispatchMessageRecorded, markEventDispatched } from "@core/src/features/chats/infrastructure/mobile-message-dispatch";
import { storeOnce } from "@core/src/features/chats/store-mobile-message";
import type { ChatMessageId, MobileMessageInput, RegistrationContext } from "@core/src/features/chats/domain/mobile-message";
import { findAvailablePublicImage } from "@core/src/shared/images";
import { err, ok } from "@shared/functional";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

export function registerMobileMessage(input: MobileMessageInput, context: RegistrationContext) {
  return withTenantIsolation(context.companyId, () => register(input, context, {
    findImage: async (imageId) => {
      const found = await findAvailablePublicImage(imageId);
      return found.success ? ok(found.data !== null) : err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to look up image" });
    },
    storeOnce, markEventDispatched, dispatchMessageRecorded,
    newMessageId: () => randomUUID() as ChatMessageId,
    now: () => new Date(),
  }));
}
