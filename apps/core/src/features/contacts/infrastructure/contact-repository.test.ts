import { expect, test } from "vitest";
import { mapWhatsAppContact } from "@core/src/features/contacts/infrastructure/contact-repository";

test("rejects malformed stored LID contacts instead of substituting identity", () => {
  const row = { id: crypto.randomUUID(), whatsappAccountId: "123@lid", whatsappLid: "456@lid", createdAt: new Date(0), updatedAt: new Date(0) };
  expect(mapWhatsAppContact(row)).toMatchObject({ whatsappAccountId: "123@lid", whatsappLid: "456@lid" });
  expect(mapWhatsAppContact({ ...row, whatsappLid: "" })).toBeNull();
  expect(mapWhatsAppContact({ ...row, whatsappAccountId: "not-a-lid" })).toBeNull();
});
