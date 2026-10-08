import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { normalizePhone, type PhoneContact } from "@core/src/features/contacts/domain/contact";

export type EnsureContactInput = Readonly<{ phone: string; profileName: string | null }>;
export type ContactError = Readonly<{ code: "INVALID_CONTACT" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;
export type ContactRepository = Readonly<{
  findByPhone: (phone: string) => Promise<Result<PhoneContact | null, ContactError>>;
  insertIfAbsent: (input: Readonly<{ phone: string; name: string | null }>) => Promise<Result<PhoneContact, ContactError>>;
  setName: (contactId: string, name: string) => Promise<Result<PhoneContact, ContactError>>;
}>;

export async function ensureContact(input: EnsureContactInput, repository: ContactRepository): Promise<Result<PhoneContact, ContactError>> {
  const phone = normalizePhone(input.phone);
  if (!phone) {
    return err({ code: "INVALID_CONTACT", message: "Invalid contact" });
  }
  const profileName = input.profileName?.trim() ? input.profileName : null;
  const existing = await repository.findByPhone(phone);
  if (!existing.success) return existing;
  let contact = existing.data;
  if (!contact) {
    const inserted = await repository.insertIfAbsent({ phone, name: profileName });
    if (!inserted.success) return inserted;
    contact = inserted.data;
  }
  if (profileName && contact.name !== profileName) return repository.setName(contact.id, profileName);
  return { success: true, data: contact };
}
