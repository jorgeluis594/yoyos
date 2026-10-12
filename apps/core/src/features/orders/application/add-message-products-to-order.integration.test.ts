import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { getCompanyId, prisma, systemPrisma, withLockedForUpdate, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { orders } from "@core/src/features/orders/composition";
import { addMessageProductsToOrder, type AddMessageProductsDependencies, type OrderSourceMessage } from "@core/src/features/orders/application/add-message-products-to-order";
import { allocateOrderNumber, findOpenChatOrderCandidate, findOrderForUpdate, findProcessedMessage, recordProcessedMessage, saveAddedItems, savePendingOrder } from "@core/src/features/orders/infrastructure/order-repository";
import { findSellableVariantsByQrCodes } from "@core/src/features/products";
import { parseBuyer } from "@core/src/features/orders/domain/checkout";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, ContactId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import type { ImageId } from "@core/src/features/products/domain/product";

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const contactId = randomUUID();
  const chatId = randomUUID();
  const productId = randomUUID();
  const variantIds = [randomUUID(), randomUUID()];
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Message orders", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    await prisma.product.create({ data: { id: productId, name: "Shirt", currency: "PEN", qrCode: productId, status: "active", createdAt: new Date(), updatedAt: new Date() } });
    for (const [index, variantId] of variantIds.entries())
      await prisma.productVariant.create({ data: { id: variantId, productId, attributes: { Size: index ? "L" : "M" }, sku: `SKU-${variantId}`, salePrice: index ? 20 : 10, qrCode: variantId, status: "active" } });
    await prisma.contact.create({ data: { id: contactId, whatsappAccountId: "111@lid", whatsappLid: "222@lid" } });
    await prisma.chat.create({ data: { id: chatId, contactId } });
  });
  return { companyId, sellerId, contactId, chatId, productId, variantIds, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.orderMessage.deleteMany();
      await prisma.payment.deleteMany();
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.chatMessage.deleteMany();
      await prisma.chat.deleteMany();
      await prisma.contact.deleteMany();
      await prisma.customer.deleteMany();
      await prisma.productVariant.deleteMany();
      await prisma.product.deleteMany();
      await prisma.image.deleteMany();
      await systemPrisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

/** An incoming photo whose fake QR content is given by `codes`. */
const photos = new Map<string, readonly string[]>();
async function photo(f: Fixture, codes: readonly string[], over: { uploader?: string; direction?: "incoming" | "outgoing" } = {}) {
  const messageId = randomUUID() as ChatMessageId;
  const imageId = randomUUID();
  photos.set(imageId, codes);
  const direction = over.direction ?? "incoming";
  await withTenantIsolation(f.companyId, async () => {
    await prisma.image.create({ data: { id: imageId, storageKey: `images/${imageId}` } });
    await prisma.chatMessage.create({ data: { id: messageId, chatId: f.chatId, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction,
      source: direction === "incoming" ? "contact" : "seller", type: "image", imageId, imageStatus: "ready", uploadedByUserId: over.uploader ?? f.sellerId,
      sentAt: new Date(), receivedAt: new Date() } });
  });
  return messageId;
}

/** Same rule as the real `ensureCustomerForContact` (T4): lock the contact, then create and link an empty customer when missing. */
const ensureCustomerForContact: AddMessageProductsDependencies["ensureCustomerForContact"] = async (contactId) => {
  return withLockedForUpdate<{ id: string; customerId: string | null }, never>(getCompanyId(), Prisma.sql`SELECT id, "customerId" FROM "Contact" WHERE id = ${contactId}::uuid`, async (row) => {
    if (!row) return err({ code: "CONTACT_NOT_FOUND" as const, message: "Contact is not available" }) as never;
    const customerId = (row.customerId ?? randomUUID()) as CustomerId;
    if (!row.customerId) {
      await prisma.customer.create({ data: { id: customerId, createdAt: new Date() } });
      await prisma.contact.update({ where: { id: contactId }, data: { customerId } });
    }
    return ok({ customerId, contactId, name: null, phone: null }) as never;
  });
};

function dependencies(f: Fixture, over: Partial<AddMessageProductsDependencies> = {}): AddMessageProductsDependencies {
  const companyId = f.companyId as CompanyId;
  return {
    findSourceMessage: async (id) => {
      const row = await prisma.chatMessage.findFirst({ where: { id }, include: { chat: true } });
      return ok(row && { id: row.id as ChatMessageId, companyId, chatId: row.chatId as ChatId, contactId: row.chat.contactId as ContactId, direction: row.direction,
        uploadedByUserId: row.uploadedByUserId as UserId, imageId: row.imageId as ImageId | null } satisfies OrderSourceMessage);
    },
    readImage: async (imageId) => ok({ bytes: new TextEncoder().encode(imageId), contentType: "image/jpeg" }),
    readQrCodes: async ({ bytes }) => ok(photos.get(new TextDecoder().decode(bytes)) ?? []),
    findVariantsByCodes: async (codes) => { const found = await findSellableVariantsByQrCodes(codes); return found.success ? ok(found.data as never) : found; },
    findProcessedMessage,
    transaction: (_company, work) => withinTransaction(work),
    ensureCustomerForContact,
    findOpenChatOrderCandidate,
    findOrderForUpdate: async (id) => { // stored-data errors surface as retryable persistence failures here
      const locked = await findOrderForUpdate(id, companyId);
      return locked.success ? locked : err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: locked.error.message });
    },
    allocateNumber: allocateOrderNumber,
    saveNewOrder: savePendingOrder,
    saveAddedItems,
    recordProcessedMessage,
    newOrderId: () => randomUUID() as OrderId,
    newItemId: () => randomUUID() as OrderItemId,
    clock: () => new Date(),
    ...over,
  };
}

const process = (f: Fixture, messageId: ChatMessageId, over?: Partial<AddMessageProductsDependencies>) =>
  withTenantIsolation(f.companyId, () => addMessageProductsToOrder({ companyId: f.companyId as CompanyId, messageId }, dependencies(f, over)));
const inTenant = <T,>(f: Fixture, work: () => Promise<T>) => withTenantIsolation(f.companyId, async () => await work()); // Prisma queries are lazy: await inside the tenant scope
const chatOrders = (f: Fixture) => inTenant(f, () => prisma.order.findMany({ where: { chatId: f.chatId }, include: { items: true, buyer: true }, orderBy: { number: "asc" } }));
const quantities = (order: { items: { variantId: string; quantity: bigint }[] }) => Object.fromEntries(order.items.map((item) => [item.variantId, Number(item.quantity)]));

test("an incoming label photo creates an order for the contact's new customer linked to the chat", async () => {
  const f = await fixture();
  try {
    const result = await process(f, await photo(f, [f.variantIds[0]!, "https://pay.example/yape"]));
    expect(result).toMatchObject({ success: true, data: { kind: "order_created", variantIds: [f.variantIds[0]], unknownCodes: [] } });
    const [order] = await chatOrders(f);
    const contact = await inTenant(f, () => prisma.contact.findUniqueOrThrow({ where: { id: f.contactId } }));
    expect(contact.customerId).not.toBeNull();
    expect(order).toMatchObject({ customerId: contact.customerId, chatId: f.chatId, sellerId: f.sellerId, buyer: { contactId: f.contactId, name: null, phone: null } });
    expect(quantities(order!)).toEqual({ [f.variantIds[0]!]: 1 });
    expect(await inTenant(f, () => prisma.orderMessage.count())).toBe(1);
  } finally { await f.cleanup(); }
});

test("a second photo in the same chat adds its variant to the same order", async () => {
  const f = await fixture();
  try {
    await process(f, await photo(f, [f.variantIds[0]!]));
    const second = await process(f, await photo(f, [f.variantIds[1]!]));
    expect(second).toMatchObject({ success: true, data: { kind: "items_added" } });
    const all = await chatOrders(f);
    expect(all).toHaveLength(1);
    expect(quantities(all[0]!)).toEqual({ [f.variantIds[0]!]: 1, [f.variantIds[1]!]: 1 });
    expect(Number(all[0]!.total)).toBe(30);
    expect(await inTenant(f, () => prisma.customer.count())).toBe(1);
  } finally { await f.cleanup(); }
});

test("the same variant photographed twice increments its quantity", async () => {
  const f = await fixture();
  try {
    await process(f, await photo(f, [f.variantIds[0]!]));
    await process(f, await photo(f, [f.variantIds[0]!]));
    const [order] = await chatOrders(f);
    expect(quantities(order!)).toEqual({ [f.variantIds[0]!]: 2 });
    expect(Number(order!.total)).toBe(20);
  } finally { await f.cleanup(); }
});

test("a photo after a payment creates a new order", async () => {
  const f = await fixture();
  try {
    await process(f, await photo(f, [f.variantIds[0]!]));
    const [first] = await chatOrders(f);
    await inTenant(f, () => prisma.payment.create({ data: { id: randomUUID(), orderId: first!.id, status: "confirmed", amount: new Prisma.Decimal("10"), currency: "PEN",
      method: "digital_wallet", data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } } }));
    expect(await process(f, await photo(f, [f.variantIds[1]!]))).toMatchObject({ success: true, data: { kind: "order_created" } });
    const all = await chatOrders(f);
    expect(all).toHaveLength(2);
    expect(quantities(all[0]!)).toEqual({ [f.variantIds[0]!]: 1 });
    expect(quantities(all[1]!)).toEqual({ [f.variantIds[1]!]: 1 });
    expect(all[1]!.customerId).toBe(all[0]!.customerId);
  } finally { await f.cleanup(); }
});

test("two concurrent photos of the same chat create one customer and one order with both products", async () => {
  const f = await fixture();
  try {
    const [a, b] = [await photo(f, [f.variantIds[0]!]), await photo(f, [f.variantIds[1]!])];
    const results = await Promise.all([process(f, a), process(f, b)]);
    expect(results.every((result) => result.success)).toBe(true);
    expect(results.map((result) => result.success && result.data.kind).sort()).toEqual(["items_added", "order_created"]);
    const all = await chatOrders(f);
    expect(all).toHaveLength(1);
    expect(quantities(all[0]!)).toEqual({ [f.variantIds[0]!]: 1, [f.variantIds[1]!]: 1 });
    expect(await inTenant(f, () => prisma.customer.count())).toBe(1);
  } finally { await f.cleanup(); }
});

test("the same message processed twice or concurrently does not duplicate quantities", async () => {
  const f = await fixture();
  try {
    const sequential = await photo(f, [f.variantIds[0]!]);
    expect(await process(f, sequential)).toMatchObject({ success: true, data: { kind: "order_created" } });
    expect(await process(f, sequential)).toMatchObject({ success: true, data: { kind: "already_processed" } });
    const concurrent = await photo(f, [f.variantIds[1]!]);
    const results = await Promise.all([process(f, concurrent), process(f, concurrent)]);
    expect(results.map((result) => result.success && result.data.kind).sort()).toEqual(["already_processed", "items_added"]);
    const all = await chatOrders(f);
    expect(all).toHaveLength(1);
    expect(quantities(all[0]!)).toEqual({ [f.variantIds[0]!]: 1, [f.variantIds[1]!]: 1 });
    expect(await inTenant(f, () => prisma.orderMessage.count())).toBe(2);
  } finally { await f.cleanup(); }
});

/** Holds the order lock inside a transaction while `photoRun` waits on it, then applies `change` and commits. */
async function concurrentWithLockHolder(f: Fixture, orderId: string, messageId: ChatMessageId, change: () => Promise<unknown>) {
  let locked!: () => void;
  const hasLock = new Promise<void>((resolve) => { locked = resolve; });
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const holder = withTenantIsolation(f.companyId, () => withinTransaction(async () => {
    await withLockedForUpdate(f.companyId, Prisma.sql`SELECT id FROM "Order" WHERE id = ${orderId}::uuid`, () => ok(null));
    locked();
    await released;
    await change();
    return ok(null);
  }));
  await hasLock;
  const run = process(f, messageId);
  for (let attempt = 0; attempt < 100; attempt++) { // wait until the photo is blocked on a lock
    const [waiting] = await inTenant(f, () => prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock'`);
    if (waiting!.n > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  release();
  await holder;
  return run;
}

test("a payment concurrent with a photo never adds items to a paid order", async () => {
  const f = await fixture();
  try {
    await process(f, await photo(f, [f.variantIds[0]!]));
    const [first] = await chatOrders(f);
    const result = await concurrentWithLockHolder(f, first!.id, await photo(f, [f.variantIds[1]!]), () => prisma.payment.create({ data: { id: randomUUID(), orderId: first!.id,
      status: "confirmed", amount: new Prisma.Decimal("10"), currency: "PEN", method: "digital_wallet",
      data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } } }));
    expect(result).toMatchObject({ success: true, data: { kind: "order_created" } });
    const all = await chatOrders(f);
    expect(quantities(all[0]!)).toEqual({ [f.variantIds[0]!]: 1 });
    expect(quantities(all[1]!)).toEqual({ [f.variantIds[1]!]: 1 });
  } finally { await f.cleanup(); }
});

test("a cancellation concurrent with a photo puts the items in a new order", async () => {
  const f = await fixture();
  try {
    await process(f, await photo(f, [f.variantIds[0]!]));
    const [first] = await chatOrders(f);
    const result = await concurrentWithLockHolder(f, first!.id, await photo(f, [f.variantIds[1]!]), () => prisma.order.update({ where: { id: first!.id }, data: { cancelled: true } }));
    expect(result).toMatchObject({ success: true, data: { kind: "order_created" } });
    const all = await chatOrders(f);
    expect(all[0]).toMatchObject({ cancelled: true });
    expect(quantities(all[0]!)).toEqual({ [f.variantIds[0]!]: 1 });
    expect(quantities(all[1]!)).toEqual({ [f.variantIds[1]!]: 1 });
  } finally { await f.cleanup(); }
});

test("confirming checkout with the old total after items were added returns TOTAL_CHANGED", async () => {
  const f = await fixture();
  try {
    await process(f, await photo(f, [f.variantIds[0]!]));
    const [first] = await chatOrders(f);
    const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
    await withTenantIsolation(f.companyId, () => orders.enableCheckout(first!.id as OrderId, context));
    await process(f, await photo(f, [f.variantIds[1]!]));
    const buyer = parseBuyer({ name: "Ana", phone: "+14155552671" });
    if (!buyer.success) throw new Error("Invalid test buyer");
    const access = { companyId: context.companyId, orderId: first!.id as OrderId };
    expect(await orders.confirmCheckout({ buyer: buyer.data, expectedTotal: { amount: 10, currency: "PEN" } }, access)).toMatchObject({ success: false, error: { code: "TOTAL_CHANGED" } });
    expect(await orders.confirmCheckout({ buyer: buyer.data, expectedTotal: { amount: 30, currency: "PEN" } }, access)).toMatchObject({ success: true });
  } finally { await f.cleanup(); }
});

test("a seller removed from the company fails with SELLER_UNAVAILABLE and writes nothing", async () => {
  const f = await fixture();
  try {
    const removed = randomUUID();
    await systemPrisma.user.create({ data: { id: removed, name: "Gone", email: `${removed}@example.test`, companyId: f.companyId } });
    const messageId = await photo(f, [f.variantIds[0]!], { uploader: removed });
    await systemPrisma.user.delete({ where: { id: removed } });
    expect(await process(f, messageId)).toMatchObject({ success: false, error: { code: "SELLER_UNAVAILABLE" } });
    expect(await chatOrders(f)).toHaveLength(0);
    expect(await inTenant(f, () => prisma.customer.count())).toBe(0);
    expect(await inTenant(f, () => prisma.orderMessage.count())).toBe(0);
    expect((await inTenant(f, () => prisma.contact.findUniqueOrThrow({ where: { id: f.contactId } }))).customerId).toBeNull();
  } finally { await f.cleanup(); }
});

test("a failure inside the transaction rolls back customer, order and items", async () => {
  const f = await fixture();
  try {
    const result = await process(f, await photo(f, [f.variantIds[0]!, f.variantIds[1]!]), {
      recordProcessedMessage: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "boom" }) });
    expect(result).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    expect(await inTenant(f, () => prisma.order.count())).toBe(0);
    expect(await inTenant(f, () => prisma.orderItem.count())).toBe(0);
    expect(await inTenant(f, () => prisma.customer.count())).toBe(0);
    expect((await inTenant(f, () => prisma.contact.findUniqueOrThrow({ where: { id: f.contactId } }))).customerId).toBeNull();
  } finally { await f.cleanup(); }
});
