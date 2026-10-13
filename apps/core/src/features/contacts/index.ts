import { ensureWhatsAppContact as ensureWhatsAppContactWithRepository, type EnsureWhatsAppContactInput } from "@core/src/features/contacts/application/ensure-whatsapp-contact";
import { whatsappContactRepository } from "@core/src/features/contacts/infrastructure/contact-repository";

export function ensureWhatsAppContact(input: EnsureWhatsAppContactInput) {
  return ensureWhatsAppContactWithRepository(input, whatsappContactRepository);
}
export type { ContactError } from "@core/src/features/contacts/application/ensure-whatsapp-contact";
export type { WhatsAppContact } from "@core/src/features/contacts/domain/contact";
export { ensureCustomerForContact } from "@core/src/features/contacts/infrastructure/contact-repository";
