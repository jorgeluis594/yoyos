import { internationalPhonePattern } from "@shared/phone";

export type Contact = Readonly<{ id: string; phone: string; name: string | null; createdAt: Date; updatedAt: Date }>;

export function normalizePhone(phone: string): string | null {
  if (!internationalPhonePattern.test(phone)) return null;
  return phone;
}
