export { ensureContact } from "@core/src/features/contacts/application/ensure-contact";
import { ensureWhatsAppContact as ensureWhatsAppContactWithRepository, type EnsureWhatsAppContactInput } from "@core/src/features/contacts/application/ensure-whatsapp-contact";
import { whatsappContactRepository } from "@core/src/features/contacts/infrastructure/contact-repository";

export function ensureWhatsAppContact(input: EnsureWhatsAppContactInput) {
  return ensureWhatsAppContactWithRepository(input, whatsappContactRepository);
}
export type { ContactError, EnsureContactInput } from "@core/src/features/contacts/application/ensure-contact";
export type { Contact, PhoneContact, WhatsAppContact } from "@core/src/features/contacts/domain/contact";
export { normalizePhone } from "@core/src/features/contacts/domain/contact";
export { findContactById, searchSaleContacts } from "@core/src/features/contacts/infrastructure/contact-repository";
