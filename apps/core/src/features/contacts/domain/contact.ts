import { internationalPhonePattern } from "@shared/phone";

type ContactDetails = Readonly<{ id: string; name: string | null; createdAt: Date; updatedAt: Date }>;
export type PhoneContact = ContactDetails & Readonly<{ phone: string; whatsappAccountId?: string | null; whatsappLid?: string | null }>;
export type WhatsAppContact = ContactDetails & Readonly<{ phone: string | null; whatsappAccountId: string; whatsappLid: string }>;
export type Contact = PhoneContact | WhatsAppContact;

export function validWhatsAppLid(value: string): boolean {
  return value.length <= 128 && /^[0-9]+@lid$/.test(value);
}

export function normalizePhone(phone: string): string | null {
  if (!internationalPhonePattern.test(phone)) return null;
  return phone;
}
