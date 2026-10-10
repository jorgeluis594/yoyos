import { expect, test } from "vitest";
import { mapWhatsAppContact } from "@core/src/features/contacts/infrastructure/contact-repository";

test("rejects malformed stored LID contacts instead of substituting identity", () => {
  const row = { id: crypto.randomUUID(), phone: null, name: null, whatsappAccountId: "123@lid", whatsappLid: "456@lid", createdAt: new Date(0), updatedAt: new Date(0) };
  expect(mapWhatsAppContact(row)).toMatchObject({ whatsappAccountId: "123@lid", whatsappLid: "456@lid" });
  expect(mapWhatsAppContact({ ...row, whatsappLid: null })).toBeNull();
  expect(mapWhatsAppContact({ ...row, whatsappAccountId: "not-a-lid" })).toBeNull();
  expect(mapWhatsAppContact({ ...row, phone: "not-a-phone" })).toBeNull();
});
