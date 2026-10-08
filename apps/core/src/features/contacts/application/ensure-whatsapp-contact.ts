import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { validWhatsAppLid, type WhatsAppContact } from "@core/src/features/contacts/domain/contact";
import type { ContactError } from "@core/src/features/contacts/application/ensure-contact";

export type EnsureWhatsAppContactInput = Readonly<{ companyId: string; whatsappAccountId: string; whatsappLid: string }>;
export type WhatsAppContactRepository = Readonly<{
  insertIfAbsent: (input: EnsureWhatsAppContactInput) => Promise<Result<WhatsAppContact, ContactError>>;
}>;

export function ensureWhatsAppContact(input: EnsureWhatsAppContactInput, repository: WhatsAppContactRepository): Promise<Result<WhatsAppContact, ContactError>> {
  if (!validWhatsAppLid(input.whatsappAccountId) || !validWhatsAppLid(input.whatsappLid)) {
    return Promise.resolve(err({ code: "INVALID_CONTACT", message: "Invalid contact" }));
  }
  return repository.insertIfAbsent(input);
}
