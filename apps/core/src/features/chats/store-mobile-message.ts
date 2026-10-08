import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { ensureWhatsAppContact } from "@core/src/features/contacts";
import { storeMobileMessage } from "@core/src/features/chats/application/store-mobile-message";
import { chatRepository } from "@core/src/features/chats/infrastructure/chat-repository";
import { mobileMessageRepository } from "@core/src/features/chats/infrastructure/mobile-message-repository";
import type { NewMobileMessage, RegisterMobileMessageError, StoreOutcome } from "@core/src/features/chats/domain/mobile-message";
import { withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";

const invalidStoredData = { code: "INVALID_STORED_DATA", message: "Invalid stored message" } as const;
const unavailable = { code: "PERSISTENCE_UNAVAILABLE", message: "Unable to persist message" } as const;

export async function storeOnce(input: NewMobileMessage): Promise<Result<StoreOutcome, RegisterMobileMessageError>> {
  return withTenantIsolation(input.companyId, async () => {
    try {
      return await storeMobileMessage(input, {
        ensureContact: async (identity) => {
          const result = await ensureWhatsAppContact(identity);
          return result.success ? result : err(result.error.code === "PERSISTENCE_UNAVAILABLE" ? unavailable : invalidStoredData);
        },
        ensureChat: async (contactId) => {
          const result = await chatRepository.ensureChat(contactId);
          return result.success ? result : err(result.error.code === "PERSISTENCE_UNAVAILABLE" ? unavailable : invalidStoredData);
        },
        insertAndRead: mobileMessageRepository.insertAndRead,
        transaction: withinTransaction,
      });
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_commit_mobile_message", err: cause }, "unable_to_commit_mobile_message");
      return err(unavailable satisfies RegisterMobileMessageError);
    }
  });
}
