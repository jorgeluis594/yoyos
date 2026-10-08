import { randomUUID } from "node:crypto";
import { registerMobileMessage as register } from "@core/src/features/chats/application/register-mobile-message";
import { dispatchMessageRecorded, markEventDispatched } from "@core/src/features/chats/infrastructure/mobile-message-dispatch";
import { storeOnce } from "@core/src/features/chats/store-mobile-message";
import type { ChatMessageId, MobileMessageInput, RegistrationContext } from "@core/src/features/chats/domain/mobile-message";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

export function registerMobileMessage(input: MobileMessageInput, context: RegistrationContext) {
  return withTenantIsolation(context.companyId, () => register(input, context, {
    storeOnce, markEventDispatched, dispatchMessageRecorded,
    newMessageId: () => randomUUID() as ChatMessageId,
    now: () => new Date(),
  }));
}
