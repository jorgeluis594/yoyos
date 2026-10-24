import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { prisma, systemPrisma, withLockedForUpdate, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { applyChatMessage, type ApplyChatMessageDependencies, type ChatSourceMessage } from "@core/src/features/orders/application/apply-chat-message";
import { createChatToolRegistry } from "@core/src/features/orders/application/chat-message-tools";
import { createChatInterpreter } from "@core/src/features/orders/application/chat-message-interpreter";
import { allocateOrderNumber, findChatOrderTargetForUpdate, recordProcessedMessage, saveItemChanges, savePendingOrder } from "@core/src/features/orders/infrastructure/order-repository";
import { findOutcome, recordOutcome } from "@core/src/features/orders/infrastructure/chat-message-outcome-repository";
import { ensureCustomerForContact, lockContact } from "@core/src/features/contacts/infrastructure/contact-repository";
import { findProductIdsOfVariants, findSellableVariantsByQrCodes } from "@core/src/features/products";
import { loadSellableVariants } from "@core/src/features/products/infrastructure/order-stock";
import { identifyProductsInImage } from "@core/src/features/products/application/identify-products-in-image";
import { resolveVariant } from "@core/src/features/products/application/resolve-variant";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { VariantQrCode } from "@core/src/features/products/domain/image-identification";

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
      for (const table of ["chatMessageOutcome", "orderMessage", "payment", "orderItem", "order", "chatMessage", "chat", "contact", "customer", "productVariant", "product", "image"] as const)
        await (prisma[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
      await systemPrisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

/** An incoming photo whose fake QR content is given by `codes`, or a text. */
const photos = new Map<string, readonly string[]>();
async function message(f: Fixture, content: { codes: readonly string[] } | { text: string }, over: { uploader?: string } = {}) {
  const messageId = randomUUID() as ChatMessageId;
  const imageId = "codes" in content ? randomUUID() : null;
  if (imageId && "codes" in content) photos.set(imageId, content.codes);
  await withTenantIsolation(f.companyId, async () => {
    if (imageId) await prisma.image.create({ data: { id: imageId, storageKey: `images/${imageId}` } });
    await prisma.chatMessage.create({ data: { id: messageId, chatId: f.chatId, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
      source: "contact", type: imageId ? "image" : "text", imageId, text: "text" in content ? content.text : null, uploadedByUserId: over.uploader ?? f.sellerId, sentAt: new Date(), receivedAt: new Date() } });
  });
  return messageId;
}

const registry = createChatToolRegistry({
  loadSellableVariants: loadSellableVariants, identifyProductsInText: async () => ok([]), findTopTextCandidate: async () => ok(null),
  resolveVariant: (input, signal) => resolveVariant(input, { minConfidence: 0.8, chooseVariant: async () => ok({ variantId: null, confidence: 0 }) }, signal),
});
// A text is a greeting for the faked decision API.
const ai = { minActionConfidence: 0.6, minToolPredicate: 0.5, extract: async () => ok([]),
  decide: async () => ok({ action: { choice: "no_intent", confidence: 0.95 }, predicates: {}, choices: {} }) };

function dependencies(f: Fixture, over: Partial<ApplyChatMessageDependencies> = {}): ApplyChatMessageDependencies {
  const companyId = f.companyId as CompanyId;
  return {
    findOutcome,
    findSourceMessage: async (id) => {
      const row = await prisma.chatMessage.findFirst({ where: { id }, include: { chat: true } });
      return ok(row && { id: row.id as ChatMessageId, companyId, chatId: row.chatId as ChatId, contactId: row.chat.contactId as ContactId, direction: row.direction,
        uploadedByUserId: row.uploadedByUserId as UserId, imageId: row.imageId as ImageId | null, text: row.text, caption: row.caption } satisfies ChatSourceMessage);
    },
    findChatOrderContext: async () => ok({ items: [] }),
    readImage: async (imageId) => ok({ bytes: new TextEncoder().encode(imageId), contentType: "image/jpeg" }),
    identifyProductsInImage: (image) => identifyProductsInImage(image, { visual: null,
      readQrCodes: async ({ bytes }) => ok(photos.get(new TextDecoder().decode(bytes)) ?? []),
      findVariantsByCodes: async (codes) => { const found = await findSellableVariantsByQrCodes(codes); return found.success ? ok(found.data.map((item) => ({ ...item, qrCode: item.qrCode as VariantQrCode, productId: item.productId as ProductId }))) : found; } }),
    loadSellableProducts: loadSellableVariants,
    catalogSearchReadiness: async () => ok("no_searchable_photos"),
    interpretationEnabled: true,
    interpretAndApply: createChatInterpreter(registry, ai),
    transaction: (_company, work) => withinTransaction(work),
    lockContact,
    ensureCustomerForContact: async (contactId) => { const ensured = await ensureCustomerForContact(contactId); return ensured.success ? ok({ customerId: ensured.data.customerId as CustomerId }) : ensured; },
    findChatOrderTargetForUpdate: (chatId) => findChatOrderTargetForUpdate(chatId, findProductIdsOfVariants),
    allocateNumber: () => allocateOrderNumber(companyId),
    saveNewOrder: savePendingOrder,
    saveItemChanges,
    recordOrderMessage: recordProcessedMessage,
    recordOutcome,
    newOrderId: () => randomUUID() as OrderId,
    newItemId: () => randomUUID() as OrderItemId,
    clock: () => new Date(),
    limits: { maxItemQuantity: 99 as PositiveInteger },
    ...over,
  };
}

const apply = (f: Fixture, messageId: ChatMessageId, over?: Partial<ApplyChatMessageDependencies>) =>
  withTenantIsolation(f.companyId, () => applyChatMessage({ companyId: f.companyId as CompanyId, messageId }, dependencies(f, over), new AbortController().signal));
const inTenant = <T,>(f: Fixture, work: () => Promise<T>) => withTenantIsolation(f.companyId, async () => await work()); // Prisma queries are lazy: await inside the tenant scope
const chatOrders = (f: Fixture) => inTenant(f, () => prisma.order.findMany({ where: { chatId: f.chatId }, include: { items: true, buyer: true }, orderBy: { number: "asc" } }));
const quantities = (order: { items: { variantId: string; quantity: bigint }[] }) => Object.fromEntries(order.items.map((item) => [item.variantId, Number(item.quantity)]));
const kind = (result: Awaited<ReturnType<typeof apply>>) => result.success ? result.data.kind : result.error.code;

test("an incoming label photo creates an order for the contact's new customer linked to the chat and records its outcome", async () => {
  const f = await fixture();
  try {
    const messageId = await message(f, { codes: [f.variantIds[0]!, "https://pay.example/yape"] });
    expect(await apply(f, messageId)).toMatchObject({ success: true, data: { kind: "applied", createdOrder: true, noticeDue: false } });
    const [order] = await chatOrders(f);
    const contact = await inTenant(f, () => prisma.contact.findUniqueOrThrow({ where: { id: f.contactId } }));
    expect(contact.customerId).not.toBeNull();
    expect(order).toMatchObject({ customerId: contact.customerId, chatId: f.chatId, sellerId: f.sellerId, buyer: { contactId: f.contactId, name: null, phone: null } });
    expect(quantities(order!)).toEqual({ [f.variantIds[0]!]: 1 });
    expect(await inTenant(f, () => prisma.orderMessage.count())).toBe(1);
    expect(await inTenant(f, () => prisma.chatMessageOutcome.findFirstOrThrow({ where: { messageId } }))).toMatchObject({ outcomes: [{ kind: "added", variantId: f.variantIds[0], quantity: 1 }], noticeSentAt: null });
  } finally { await f.cleanup(); }
});

test("a second photo adds to the open order and the same variant increments its quantity", async () => {
  const f = await fixture();
  try {
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    expect(await apply(f, await message(f, { codes: [f.variantIds[1]!] }))).toMatchObject({ success: true, data: { kind: "applied", createdOrder: false } });
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    const all = await chatOrders(f);
    expect(all).toHaveLength(1);
    expect(quantities(all[0]!)).toEqual({ [f.variantIds[0]!]: 2, [f.variantIds[1]!]: 1 });
    expect(Number(all[0]!.total)).toBe(40);
    expect(await inTenant(f, () => prisma.customer.count())).toBe(1);
  } finally { await f.cleanup(); }
});

test("a greeting creates no customer, no order and no order message but records its outcome", async () => {
  const f = await fixture();
  try {
    const messageId = await message(f, { text: "hola" });
    expect(await apply(f, messageId)).toMatchObject({ success: true, data: { kind: "applied", orderId: null, outcomes: [{ kind: "no_intent" }], noticeDue: false } });
    expect(await inTenant(f, () => prisma.customer.count())).toBe(0);
    expect(await chatOrders(f)).toHaveLength(0);
    expect(await inTenant(f, () => prisma.orderMessage.count())).toBe(0);
    expect((await inTenant(f, () => prisma.contact.findUniqueOrThrow({ where: { id: f.contactId } }))).customerId).toBeNull();
    expect(await inTenant(f, () => prisma.chatMessageOutcome.count({ where: { messageId } }))).toBe(1);
  } finally { await f.cleanup(); }
});

test("concurrent messages of one chat without an order create a single order and customer", async () => {
  const f = await fixture();
  try {
    const [a, b] = [await message(f, { codes: [f.variantIds[0]!] }), await message(f, { codes: [f.variantIds[1]!] })];
    const results = await Promise.all([apply(f, a), apply(f, b)]);
    expect(results.every((result) => result.success)).toBe(true);
    const all = await chatOrders(f);
    expect(all).toHaveLength(1);
    expect(quantities(all[0]!)).toEqual({ [f.variantIds[0]!]: 1, [f.variantIds[1]!]: 1 });
    expect(await inTenant(f, () => prisma.customer.count())).toBe(1);
  } finally { await f.cleanup(); }
});

test("applying the same message twice, in sequence or concurrently, changes the order once and records one outcome row", async () => {
  const f = await fixture();
  try {
    const sequential = await message(f, { codes: [f.variantIds[0]!] });
    expect(kind(await apply(f, sequential))).toBe("applied");
    expect(kind(await apply(f, sequential))).toBe("already_processed");
    const concurrent = await message(f, { codes: [f.variantIds[1]!] });
    const results = await Promise.all([apply(f, concurrent), apply(f, concurrent)]);
    expect(results.map(kind).sort()).toEqual(["already_processed", "applied"]);
    const all = await chatOrders(f);
    expect(all).toHaveLength(1);
    expect(quantities(all[0]!)).toEqual({ [f.variantIds[0]!]: 1, [f.variantIds[1]!]: 1 });
    expect(await inTenant(f, () => prisma.orderMessage.count())).toBe(2);
    expect(await inTenant(f, () => prisma.chatMessageOutcome.count())).toBe(2);
  } finally { await f.cleanup(); }
});

/** Holds the order lock inside a transaction while the message waits on it, then applies `change` and commits. */
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
  const run = apply(f, messageId);
  let blocked = false;
  for (let attempt = 0; attempt < 100 && !blocked; attempt++) { // wait until the message waits for this order's row lock
    const [waiting] = await inTenant(f, () => prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid() AND query LIKE '%FROM "Order"%' AND query LIKE '%FOR UPDATE%'`);
    blocked = waiting!.n > 0;
    if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(blocked).toBe(true);
  release();
  await holder;
  return run;
}

test("a payment concurrent with a photo never adds items to a paid order", async () => {
  const f = await fixture();
  try {
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    const [first] = await chatOrders(f);
    const result = await concurrentWithLockHolder(f, first!.id, await message(f, { codes: [f.variantIds[1]!] }), () => prisma.payment.create({ data: { id: randomUUID(), orderId: first!.id,
      status: "confirmed", amount: new Prisma.Decimal("10"), currency: "PEN", method: "digital_wallet",
      data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } } }));
    expect(result).toMatchObject({ success: true, data: { kind: "applied", createdOrder: true, outcomes: [{ kind: "new_order_after_closed" }, { kind: "added" }], noticeDue: true } });
    const all = await chatOrders(f);
    expect(quantities(all[0]!)).toEqual({ [f.variantIds[0]!]: 1 });
    expect(quantities(all[1]!)).toEqual({ [f.variantIds[1]!]: 1 });
  } finally { await f.cleanup(); }
});

test("a cancellation concurrent with a photo puts the items in a new order without a notice", async () => {
  const f = await fixture();
  try {
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    const [first] = await chatOrders(f);
    const result = await concurrentWithLockHolder(f, first!.id, await message(f, { codes: [f.variantIds[1]!] }), () => prisma.order.update({ where: { id: first!.id }, data: { cancelled: true } }));
    expect(result).toMatchObject({ success: true, data: { kind: "applied", createdOrder: true, noticeDue: false } });
    const all = await chatOrders(f);
    expect(all[0]).toMatchObject({ cancelled: true });
    expect(quantities(all[0]!)).toEqual({ [f.variantIds[0]!]: 1 });
    expect(quantities(all[1]!)).toEqual({ [f.variantIds[1]!]: 1 });
  } finally { await f.cleanup(); }
});

test("a seller removed from the company fails with SELLER_UNAVAILABLE and writes nothing", async () => {
  const f = await fixture();
  try {
    const removed = randomUUID();
    await systemPrisma.user.create({ data: { id: removed, name: "Gone", email: `${removed}@example.test`, companyId: f.companyId } });
    const messageId = await message(f, { codes: [f.variantIds[0]!] }, { uploader: removed });
    await systemPrisma.user.delete({ where: { id: removed } });
    expect(await apply(f, messageId)).toMatchObject({ success: false, error: { code: "SELLER_UNAVAILABLE" } });
    expect(await chatOrders(f)).toHaveLength(0);
    expect(await inTenant(f, () => prisma.customer.count())).toBe(0);
    expect(await inTenant(f, () => prisma.orderMessage.count())).toBe(0);
    expect(await inTenant(f, () => prisma.chatMessageOutcome.count())).toBe(0);
    expect((await inTenant(f, () => prisma.contact.findUniqueOrThrow({ where: { id: f.contactId } }))).customerId).toBeNull();
  } finally { await f.cleanup(); }
});

test("a failure inside the transaction rolls back customer, order, items and message", async () => {
  const f = await fixture();
  try {
    const result = await apply(f, await message(f, { codes: [f.variantIds[0]!, f.variantIds[1]!] }), {
      recordOutcome: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "boom" }) });
    expect(result).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    expect(await inTenant(f, () => prisma.order.count())).toBe(0);
    expect(await inTenant(f, () => prisma.orderItem.count())).toBe(0);
    expect(await inTenant(f, () => prisma.customer.count())).toBe(0);
    expect(await inTenant(f, () => prisma.orderMessage.count())).toBe(0);
  } finally { await f.cleanup(); }
});
