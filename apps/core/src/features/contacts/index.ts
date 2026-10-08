export { ensureContact } from "@core/src/features/contacts/application/ensure-contact";
export { ensureWhatsAppContact } from "@core/src/features/contacts/application/ensure-whatsapp-contact";
export type { ContactError, EnsureContactInput } from "@core/src/features/contacts/application/ensure-contact";
export type { Contact, PhoneContact, WhatsAppContact } from "@core/src/features/contacts/domain/contact";
export { findContactById, searchSaleContacts } from "@core/src/features/contacts/infrastructure/contact-repository";
export { whatsappContactRepository } from "@core/src/features/contacts/infrastructure/contact-repository";
