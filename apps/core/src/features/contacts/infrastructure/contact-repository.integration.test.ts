import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { ensureWhatsAppContact } from "@core/src/features/contacts";
import { ensureCustomerForContact, findContactById, searchSaleContacts } from "@core/src/features/contacts/infrastructure/contact-repository";
import { createOrderInTransaction } from "@core/src/features/orders/application/create-order";
import { ok } from "@shared/functional";

const companyA = randomUUID();
const companyB = randomUUID();
const account = "123@lid";
const lid = "456@lid";

test("LID contacts remain tenant scoped and cannot become sale buyers without a phone", async () => {
  const cleanup = (companyId: string) => withTenantIsolation(companyId, async () => {
    await prisma.chatMessage.deleteMany({ where: { companyId } });
    await prisma.chat.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });
  try {
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: "LID test", country: "PE" } }));
    expect(await withTenantIsolation(companyA, () => ensureWhatsAppContact({ companyId: companyA, whatsappAccountId: "123@c.us", whatsappLid: lid })))
      .toMatchObject({ success: false, error: { code: "INVALID_CONTACT" } });
    const first = await withTenantIsolation(companyA, () => ensureWhatsAppContact({ companyId: companyA, whatsappAccountId: account, whatsappLid: lid }));
    expect(first).toMatchObject({ success: true, data: { phone: null, name: null, whatsappAccountId: account, whatsappLid: lid } });
    if (!first.success) return;
    expect(await withTenantIsolation(companyA, () => ensureWhatsAppContact({ companyId: companyA, whatsappAccountId: account, whatsappLid: lid })))
      .toMatchObject({ success: true, data: { id: first.data.id } });
    expect(await withTenantIsolation(companyA, () => ensureWhatsAppContact({ companyId: companyA, whatsappAccountId: "789@lid", whatsappLid: lid })))
      .toMatchObject({ success: true, data: { phone: null } });
    const named = await withTenantIsolation(companyA, async () => await prisma.contact.create({ data: { phone: "+51912345678", name: "Existing name", whatsappAccountId: "333@lid", whatsappLid: lid } }));
    expect(await withTenantIsolation(companyA, () => ensureWhatsAppContact({ companyId: companyA, whatsappAccountId: "333@lid", whatsappLid: lid })))
      .toMatchObject({ success: true, data: { id: named.id, phone: named.phone, name: named.name } });
    expect(await withTenantIsolation(companyA, async () => await prisma.contact.findUnique({ where: { id: named.id } })))
      .toMatchObject({ phone: "+51912345678", name: "Existing name", whatsappAccountId: "333@lid", whatsappLid: lid });
    const other = await withTenantIsolation(companyB, () => ensureWhatsAppContact({ companyId: companyB, whatsappAccountId: account, whatsappLid: lid }));
    expect(other).toMatchObject({ success: true, data: { phone: null } });
    if (other.success) expect(other.data.id).not.toBe(first.data.id);
    await withTenantIsolation(companyA, async () => {
      expect(await prisma.contact.count()).toBe(3);
      expect(await findContactById(first.data.id)).toEqual({ success: true, data: null });
      expect(await searchSaleContacts("")).toMatchObject({ success: true, data: [{ id: named.id, phone: named.phone }] });
      const orderInput = { id: randomUUID(), contactId: first.data.id, items: [{ variantId: randomUUID(), quantity: 1 }] } as unknown as Parameters<typeof createOrderInTransaction>[0];
      const orderAccess = { companyId: companyA, userId: "seller" } as unknown as Parameters<typeof createOrderInTransaction>[1];
      expect(await createOrderInTransaction(orderInput, orderAccess, {
        orderExists: async () => ok(false), findContact: findContactById,
        findVariant: async () => ok(null), allocateNumber: async () => ok(1n as never),
        saveOrder: async () => ok(null), newItemId: randomUUID as never, clock: () => new Date(),
      })).toMatchObject({ success: false, error: { code: "CONTACT_NOT_FOUND" } });
      expect(await prisma.contact.findFirst({ where: { id: other.success ? other.data.id : "" } })).toBeNull();
      await expect(prisma.contact.create({ data: { phone: null, whatsappAccountId: account, whatsappLid: null } })).rejects.toThrow();
      await expect(prisma.contact.create({ data: { phone: null } })).rejects.toThrow();
      await expect(prisma.contact.create({ data: { phone: "" } })).rejects.toThrow();
      const phone = await prisma.contact.create({ data: { phone: "+51987654321" } });
      expect(await findContactById(phone.id)).toMatchObject({ success: true, data: { phone: "+51987654321" } });
      expect(await searchSaleContacts("9876")).toMatchObject({ success: true, data: [{ id: phone.id, phone: "+51987654321" }] });

      const chat = await prisma.chat.create({ data: { contactId: first.data.id } });
      const base = { chatId: chat.id, externalId: "same-native-id", direction: "incoming" as const,
        source: "contact" as const, sentAt: new Date(0), receivedAt: new Date(), userId: null };
      const mobile = await prisma.chatMessage.create({ data: { ...base, type: "image", text: null,
        whatsappMessageId: "protocol-1", uploadedByUserId: "uploader", imageStatus: "metadata_only",
        imageMimeType: "image/jpeg", imageSize: BigInt(Number.MAX_SAFE_INTEGER) } });
      expect(mobile.imageSize).toBe(BigInt(Number.MAX_SAFE_INTEGER));
      await expect(prisma.chatMessage.create({ data: { ...base, externalId: "different-native-id", type: "text", text: "repeat",
        whatsappMessageId: "protocol-1", uploadedByUserId: "uploader" } })).rejects.toThrow();
      await expect(prisma.chatMessage.create({ data: { ...base, externalId: "bad-cloud", type: "image", imageStatus: "metadata_only" } })).rejects.toThrow();
      await expect(prisma.chatMessage.create({ data: { ...base, externalId: "bad-mobile", type: "text", text: "",
        whatsappMessageId: "protocol-2", uploadedByUserId: "uploader" } })).rejects.toThrow();
      await expect(prisma.chatMessage.create({ data: { ...base, externalId: "bad-size", type: "image", imageStatus: "metadata_only",
        whatsappMessageId: "protocol-3", uploadedByUserId: "uploader", imageSize: -1n } })).rejects.toThrow();
    });
  } finally {
    await cleanup(companyA);
    await cleanup(companyB);
  }
});

async function customerFixture() {
  const [companyId, otherCompanyId] = [randomUUID(), randomUUID()];
  for (const id of [companyId, otherCompanyId]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: "Customer test", country: "PE" } }));
  return { companyId, otherCompanyId, cleanup: async () => {
    for (const id of [companyId, otherCompanyId]) await withTenantIsolation(id, async () => {
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.customer.deleteMany({ where: { companyId: id } });
      await prisma.company.deleteMany({ where: { id } });
    });
  } };
}

test("ensureCustomerForContact creates and links an empty customer", async () => {
  const f = await customerFixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const contact = await prisma.contact.create({ data: { phone: "+51912345678", name: "Ana" } });
      const result = await withinTransaction(() => ensureCustomerForContact(contact.id));
      expect(result).toMatchObject({ success: true, data: { contactId: contact.id, name: "Ana", phone: "+51912345678" } });
      const linked = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
      expect(linked.customerId).toBe(result.success ? result.data.customerId : null);
      expect(await prisma.customer.count()).toBe(1);
    });
  } finally { await f.cleanup(); }
});

test("ensureCustomerForContact returns the existing customer without creating another", async () => {
  const f = await customerFixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const customer = await prisma.customer.create({ data: { id: randomUUID(), createdAt: new Date() } });
      const contact = await prisma.contact.create({ data: { whatsappAccountId: "1@lid", whatsappLid: "2@lid", customerId: customer.id } });
      const result = await withinTransaction(() => ensureCustomerForContact(contact.id));
      expect(result).toMatchObject({ success: true, data: { customerId: customer.id, contactId: contact.id, name: null, phone: null } });
      expect(await prisma.customer.count()).toBe(1);
    });
  } finally { await f.cleanup(); }
});

test("two concurrent calls create one customer", async () => {
  const f = await customerFixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const contact = await prisma.contact.create({ data: { phone: "+51912345679" } });
      const results = await Promise.all([1, 2, 3].map(() => withTenantIsolation(f.companyId, () => withinTransaction(() => ensureCustomerForContact(contact.id)))));
      const ids = new Set(results.map((result: (typeof results)[number]) => result.success ? result.data.customerId : result.error.code));
      expect(ids.size).toBe(1);
      expect(await prisma.customer.count()).toBe(1);
    });
  } finally { await f.cleanup(); }
});

test("returns CONTACT_NOT_FOUND for a contact of another company", async () => {
  const f = await customerFixture();
  try {
    const foreign = await withTenantIsolation(f.otherCompanyId, async () => await prisma.contact.create({ data: { phone: "+51912345670" } }));
    await withTenantIsolation(f.companyId, async () => {
      expect(await withinTransaction(() => ensureCustomerForContact(foreign.id))).toMatchObject({ success: false, error: { code: "CONTACT_NOT_FOUND" } });
      expect(await withinTransaction(() => ensureCustomerForContact(randomUUID()))).toMatchObject({ success: false, error: { code: "CONTACT_NOT_FOUND" } });
    });
    expect(await withTenantIsolation(f.otherCompanyId, async () => await prisma.customer.count())).toBe(0);
  } finally { await f.cleanup(); }
});
