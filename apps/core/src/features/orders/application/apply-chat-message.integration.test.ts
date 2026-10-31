import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { prisma, systemPrisma, withLockedForUpdate, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { applyChatMessage, type ApplyChatMessageDependencies, type ChatSourceMessage } from "@core/src/features/orders/application/apply-chat-message";
import { allocateOrderNumber, findChatOrderTarget, findChatOrderTargetForUpdate, findChatOrdersOpenedSince, findOrderAggregate, recordProcessedMessage, savePendingOrder } from "@core/src/features/orders/infrastructure/order-repository";
import { createFitReadingContext, readerTokenBudget } from "@core/src/features/orders/infrastructure/chat-reader-budget";
import { findOutcome, insertFailedOutcome, recordOutcome } from "@core/src/features/orders/infrastructure/chat-message-outcome-repository";
import { recordFailedChatMessage } from "@core/src/features/orders/application/record-failed-chat-message";
import { findChatPendings, findChatPendingsForUpdate, saveChatPendings, saveLastIncomingPhotoOfMessageChat } from "@core/src/features/orders/infrastructure/chat-pending-repository";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatReadingContext, ReaderAction, ReaderAnswer } from "@core/src/features/orders/domain/chat-reading";
import { ensureCustomerForContact, lockContact } from "@core/src/features/contacts/infrastructure/contact-repository";
import { findProductIdsOfVariants, findSellableVariantsByQrCodes } from "@core/src/features/products";
import { products } from "@core/src/features/products/composition";
import { saveChatItemChanges } from "@core/src/features/orders/composition";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { identifyProductsInImage } from "@core/src/features/products/application/identify-products-in-image";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { VariantQrCode } from "@core/src/features/products/domain/image-identification";

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** The simulated time of the use cases; a test moves it between messages. */
let simulated: Date | null = null;
const clockNow = () => simulated ?? new Date();
const setNow = (iso: string) => { simulated = new Date(iso); };
afterEach(() => { simulated = null; });

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
    await seedProduct({ id: productId, name: "Shirt", qrCode: productId, variants: variantIds.map((variantId, index) => ({
      id: variantId, attributes: { Size: index ? "L" : "M" }, sku: `SKU-${variantId}`, salePrice: index ? 20 : 10, qrCode: variantId })) });
    await prisma.contact.create({ data: { id: contactId, whatsappAccountId: "111@lid", whatsappLid: "222@lid" } });
    await prisma.chat.create({ data: { id: chatId, contactId } });
  });
  return { companyId, sellerId, contactId, chatId, productId, variantIds, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      for (const table of ["chatPendings", "chatMessageOutcome", "orderMessage", "payment", "orderItem", "order", "chatMessage", "chat", "contact", "customer", "productStock", "productVariant", "productOption", "product", "image"] as const)
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

const fit = createFitReadingContext({ budget: readerTokenBudget({ photoStagesReserveUsd: 0.001 }) });

function dependencies(f: Fixture, over: Partial<ApplyChatMessageDependencies> = {}): ApplyChatMessageDependencies {
  const companyId = f.companyId as CompanyId;
  return {
    findOutcome,
    findSourceMessage: async (id) => {
      const row = await prisma.chatMessage.findFirst({ where: { id }, include: { chat: true } });
      return ok(row && { id: row.id as ChatMessageId, companyId, chatId: row.chatId as ChatId, contactId: row.chat.contactId as ContactId, direction: row.direction,
        uploadedByUserId: row.uploadedByUserId as UserId, imageId: row.imageId as ImageId | null, text: row.text, caption: row.caption } satisfies ChatSourceMessage);
    },
    findChatOrderTarget: (chatId) => findChatOrderTarget(chatId, findProductIdsOfVariants),
    findChatOrdersOpenedSince,
    findChatPendings,
    findChatPendingsForUpdate,
    saveChatPendings,
    readImage: async (imageId) => ok({ bytes: new TextEncoder().encode(imageId), contentType: "image/jpeg" }),
    identifyProductsInImage: (image) => identifyProductsInImage(image, { visual: null,
      readQrCodes: async ({ bytes }) => ok(photos.get(new TextDecoder().decode(bytes)) ?? []),
      findVariantsByCodes: async (codes) => { const found = await findSellableVariantsByQrCodes(codes); return found.success ? ok(found.data.map((item) => ({ ...item, qrCode: item.qrCode as VariantQrCode, productId: item.productId as ProductId }))) : found; } }),
    findProductsForReading: (productIds) => products.findProductsForReading(productIds),
    findMessageCandidates: (text) => products.findMessageCandidates(text),
    catalogSearchReadiness: async () => ok("no_searchable_photos"),
    readChatMessage: async () => ok({ answer: { kind: "no_intent" } as ReaderAnswer, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 } }),
    transaction: (_company, work) => withinTransaction(work),
    lockContact,
    ensureCustomerForContact: async (contactId) => { const ensured = await ensureCustomerForContact(contactId); return ensured.success ? ok({ customerId: ensured.data.customerId as CustomerId }) : ensured; },
    findChatOrderTargetForUpdate: (chatId) => findChatOrderTargetForUpdate(chatId, findProductIdsOfVariants),
    allocateNumber: () => allocateOrderNumber(companyId),
    saveNewOrder: savePendingOrder,
    saveItemChanges: saveChatItemChanges,
    recordOrderMessage: recordProcessedMessage,
    recordOutcome,
    newOrderId: () => randomUUID() as OrderId,
    newItemId: () => randomUUID() as OrderItemId,
    newPendingId: () => randomUUID() as ChatPendingId,
    clock: () => clockNow(),
    limits: { maxItemQuantity: 99 as PositiveInteger, pendingTtlMs: 7 * 86_400_000, maxReaderProducts: 24, maxReaderItems: 40, maxReaderTextChars: 2000 },
    fitReadingContext: (context) => { const fitted = fit(context); return "code" in fitted ? err(fitted) : ok(fitted); },
    photoStageTimeoutMs: 40_000,
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
    const result = await concurrentWithLockHolder(f, first!.id, await message(f, { codes: [f.variantIds[1]!] }), () => prisma.order.update({ where: { id: first!.id }, data: { cancelled: true, cancelledAt: new Date() } }));
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

test("a photo of a QR keeps the combination of the order item in option order after reading it back", async () => {
  const f = await fixture();
  try {
    // Talla is saved before Color: stored as jsonb the keys would come back alphabetically, as Color first.
    const variantId = randomUUID();
    await inTenant(f, () => seedProduct({ name: "Polo", variants: [{ id: variantId, qrCode: variantId, attributes: { Talla: "M", Color: "Negro" }, salePrice: 45 }] }));
    expect(await apply(f, await message(f, { codes: [variantId] }))).toMatchObject({ success: true, data: { kind: "applied", createdOrder: true } });
    const [order] = await chatOrders(f);
    const [stored] = await inTenant(f, () => prisma.$queryRaw<{ attributes: string }[]>`SELECT "variantAttributes"::text AS attributes FROM "OrderItem" WHERE "orderId" = ${order!.id}::uuid`);
    expect(Object.entries(JSON.parse(stored!.attributes))).toEqual([["Talla", "M"], ["Color", "Negro"]]);
    const read = await inTenant(f, () => findOrderAggregate(order!.id as OrderId, f.companyId as CompanyId));
    expect(read.success && read.data?.items.map((item) => Object.entries(item.variantAttributes))).toEqual([[["Talla", "M"], ["Color", "Negro"]]]);
  } finally { await f.cleanup(); }
});

test("a photo of the QR of an inactive variant adds no item", async () => {
  const f = await fixture();
  try {
    await inTenant(f, () => prisma.productVariant.update({ where: { id: f.variantIds[1]! }, data: { status: "inactive" } }));
    expect(await apply(f, await message(f, { codes: [f.variantIds[1]!] }))).toMatchObject({ success: true });
    expect(await inTenant(f, () => prisma.orderItem.count())).toBe(0);
    // The active variant of the same product is still added by its own label.
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    const [order] = await chatOrders(f);
    expect(quantities(order!)).toEqual({ [f.variantIds[0]!]: 1 });
  } finally { await f.cleanup(); }
});

test("a variant deleted between the scan and the item insert fails as a retryable persistence error and writes nothing", async () => {
  const f = await fixture();
  try {
    const result = await apply(f, await message(f, { codes: [f.variantIds[1]!] }), { saveNewOrder: async (order, source) => {
      await prisma.productStock.deleteMany({ where: { variantId: f.variantIds[1]! } });
      await prisma.productVariant.delete({ where: { id: f.variantIds[1]! } });
      return savePendingOrder(order, source);
    } });
    expect(result).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    expect(await inTenant(f, () => prisma.order.count())).toBe(0);
  } finally { await f.cleanup(); }
});

// ---- Pendings: the reader is faked with fixed answers; everything else is real. ----

type Reader = (context: ChatReadingContext) => ReaderAnswer;
const zeroUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
const asReader = (reader: Reader): ApplyChatMessageDependencies["readChatMessage"] => async (context) => ok({ answer: reader(context), usage: zeroUsage });
const actions = (...list: ReaderAction[]): ReaderAnswer => ({ kind: "actions", actions: list as [ReaderAction, ...ReaderAction[]], moreActions: false });
const refOf = (context: ChatReadingContext, productId: string) => context.products.find((product) => product.productId === productId)!.ref;
const choices = (values: Record<string, string>) => Object.entries(values).map(([name, value]) => ({ name, value }));
const addProduct = (productId: string, values: Record<string, string> = {}, quantity: number | null = null): Reader => (context) =>
  actions({ kind: "add", product: { kind: "ref", ref: refOf(context, productId) }, attributes: choices(values), quantity, price: null });
const completeFirst = (values: Record<string, string>, quantity: number | null = null): Reader => (context) =>
  actions({ kind: "complete_pending", pending: context.pendings[0]!.ref, product: null, attributes: choices(values), quantity, price: null });
const noIntent: Reader = () => ({ kind: "no_intent" });

type Catalog = Awaited<ReturnType<typeof seedCatalog>>;

/** A polo with Talla (M, L) and Color (Negro, Blanco), and a cap with a single variant. */
async function seedCatalog(f: Fixture) {
  const polo = await inTenant(f, () => seedProduct({ name: "Polo básico", variants: ["M", "L"].flatMap((Talla) => ["Negro", "Blanco"].map((Color) => ({ attributes: { Talla, Color }, salePrice: 40 }))) }));
  const gorra = await inTenant(f, () => seedProduct({ name: "Gorra", variants: [{ salePrice: 25 }] }));
  return { polo, gorra };
}
const variantOf = (catalog: Catalog["polo"], talla: string, color: string) => catalog.variantIds[["M/Negro", "M/Blanco", "L/Negro", "L/Blanco"].indexOf(`${talla}/${color}`)]!;

/** Applies a text through the real use case at the simulated time with the reader given. */
async function say(f: Fixture, text: string, reader: Reader, over: Partial<ApplyChatMessageDependencies> = {}) {
  const messageId = await message(f, { text });
  const result = await apply(f, messageId, { readChatMessage: asReader(reader), findMessageCandidates: async () => ok({ unavailableProductIds: [], productIds: [], matchCount: 0, durationMs: 0, timedOut: false }), ...over });
  if (!result.success) throw new Error(`${result.error.code}: ${result.error.message}`);
  return { messageId, applied: result.data };
}
/** A photo identified as the product (visual match) without a QR label. */
async function showProduct(f: Fixture, productId: string, reader: Reader = noIntent, caption: string | null = null) {
  const messageId = await message(f, { codes: [] });
  if (caption) await inTenant(f, () => prisma.chatMessage.update({ where: { id: messageId }, data: { caption } }));
  const result = await apply(f, messageId, { readChatMessage: asReader(reader),
    identifyProductsInImage: async () => ok({ kind: "found", method: "visual", productId: productId as ProductId, confidence: 0.95 as never, candidates: 1, topDistance: 0 }) });
  if (!result.success) throw new Error(`${result.error.code}: ${result.error.message}`);
  return { messageId, applied: result.data };
}
const outcomeKindsOf = (done: Awaited<ReturnType<typeof say>>) => done.applied.kind === "applied" ? done.applied.outcomes.map(({ kind }) => kind) : [done.applied.kind];
const noticeDue = (done: Awaited<ReturnType<typeof say>>) => done.applied.kind === "applied" && done.applied.noticeDue;
const storedPendings = (f: Fixture) => inTenant(f, () => prisma.chatPendings.findUnique({ where: { companyId_chatId: { companyId: f.companyId, chatId: f.chatId } } }));
const pendingCount = async (f: Fixture) => { const row = await storedPendings(f); return row ? (row.pendings as unknown[]).length : 0; };
const itemsOf = async (f: Fixture) => (await chatOrders(f)).map((order) => order.items.map((item) => item.variantId).sort());
const addPayment = (f: Fixture, orderId: string, status: "confirmed" | "reported", paidAt: string) => inTenant(f, async () => {
  const id = randomUUID();
  await prisma.payment.create({ data: status === "confirmed"
    ? { id, orderId, status, amount: new Prisma.Decimal("10"), currency: "PEN", method: "digital_wallet", data: { confirmedAt: paidAt, confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } }
    : { id, orderId, status, amount: null, currency: "PEN", method: null, data: { receiptImageId: randomUUID(), reportedAt: paidAt } } });
  return id;
});
/** Voids a payment; one that was only reported becomes a confirmed-from-report payment voided at the same time, as the use cases store it. */
const voidPayment = (f: Fixture, paymentId: string, voidedAt: string) => inTenant(f, async () => {
  const payment = await prisma.payment.findFirstOrThrow({ where: { id: paymentId } });
  const data = payment.data as { reportedAt?: string; receiptImageId?: string };
  const confirmation = payment.status === "reported"
    ? { confirmedAt: voidedAt, confirmedBy: { kind: "legacy" }, evidence: { kind: "buyer_report", report: { receiptImageId: data.receiptImageId, reportedAt: data.reportedAt } } }
    : payment.data;
  await prisma.payment.update({ where: { id: paymentId }, data: { status: "voided", amount: new Prisma.Decimal("10"), method: "digital_wallet", data: { ...(confirmation as object), voidedAt, voidedBy: "x" } } });
});

test("photo without size, then «en talla M», then «negro» creates the order with one item and one notice", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    setNow("2026-10-01T10:00:00Z");
    const first = await showProduct(f, catalog.polo.productId);
    expect(outcomeKindsOf(first)).toEqual(["pending_created", "variant_missing"]);
    setNow("2026-10-01T10:05:00Z");
    const second = await say(f, "en talla M", completeFirst({ Talla: "M" }));
    setNow("2026-10-01T10:06:00Z");
    const third = await say(f, "negro", completeFirst({ Color: "Negro" }));
    expect([first, second, third].map(noticeDue)).toEqual([true, false, false]);
    expect(await itemsOf(f)).toEqual([[variantOf(catalog.polo, "M", "Negro")]]);
    expect(outcomeKindsOf(third)).toContain("pending_completed");
    expect(await pendingCount(f)).toBe(0);
    expect(await storedPendings(f)).toBeNull();
  } finally { await f.cleanup(); }
});

test("a pending of an order closed by a reported payment ends and never reaches a new order, also after the payment is voided", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    setNow("2026-10-01T10:00:00Z");
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    const [order] = await chatOrders(f);
    setNow("2026-10-01T10:05:00Z");
    await showProduct(f, catalog.polo.productId);
    expect(await pendingCount(f)).toBe(1);
    const paymentId = await addPayment(f, order!.id, "reported", "2026-10-01T10:10:00.000Z");
    setNow("2026-10-01T10:20:00Z");
    const late = await say(f, "en talla M", () => ({ kind: "actions", actions: [{ kind: "variant_only" }], moreActions: false }));
    expect(outcomeKindsOf(late)).toEqual(["pending_ended", "variant_only"]);
    expect(await pendingCount(f)).toBe(0);
    await voidPayment(f, paymentId, "2026-10-01T10:30:00.000Z");
    setNow("2026-10-01T10:40:00Z");
    expect(outcomeKindsOf(await say(f, "en talla M", () => ({ kind: "actions", actions: [{ kind: "variant_only" }], moreActions: false })))).toEqual(["variant_only"]);
    expect(await chatOrders(f)).toHaveLength(1);
  } finally { await f.cleanup(); }
});

test("a pending voided out of its order never reaches the order that reopens, even before any message", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    setNow("2026-10-01T10:00:00Z");
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    const [order] = await chatOrders(f);
    setNow("2026-10-01T10:05:00Z");
    await showProduct(f, catalog.polo.productId);
    const paymentId = await addPayment(f, order!.id, "reported", "2026-10-01T10:10:00.000Z");
    await voidPayment(f, paymentId, "2026-10-01T10:30:00.000Z");
    setNow("2026-10-01T10:40:00Z");
    const done = await say(f, "negro M", (context) => context.pendings.length ? completeFirst({ Talla: "M", Color: "Negro" })(context) : { kind: "actions", actions: [{ kind: "variant_only" }], moreActions: false });
    expect(outcomeKindsOf(done)).toEqual(["pending_ended", "variant_only"]);
    expect(await itemsOf(f)).toEqual([[f.variantIds[0]!]]);
  } finally { await f.cleanup(); }
});

test("an orderless pending joins the order another message creates and ends when that order closes", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    setNow("2026-10-01T10:00:00Z");
    await say(f, "un polo", addProduct(catalog.polo.productId), { findMessageCandidates: async () => ok({ unavailableProductIds: [], productIds: [catalog.polo.productId as ProductId], matchCount: 1, durationMs: 0, timedOut: false }) });
    expect(await pendingCount(f)).toBe(1);
    setNow("2026-10-01T10:05:00Z");
    await say(f, "y una gorra", addProduct(catalog.gorra.productId), { findMessageCandidates: async () => ok({ unavailableProductIds: [], productIds: [catalog.gorra.productId as ProductId], matchCount: 1, durationMs: 0, timedOut: false }) });
    const [order] = await chatOrders(f);
    expect(order!.items.map((item) => item.variantId)).toEqual(catalog.gorra.variantIds);
    expect((await storedPendings(f))!.pendings).toMatchObject([{ order: { orderId: order!.id, attachedAt: "2026-10-01T10:05:00.000Z" } }]);
    await addPayment(f, order!.id, "reported", "2026-10-01T10:10:00.000Z");
    setNow("2026-10-01T10:20:00Z");
    const late = await say(f, "en M", () => ({ kind: "actions", actions: [{ kind: "variant_only" }], moreActions: false }));
    expect(outcomeKindsOf(late)).toEqual(["pending_ended", "variant_only"]);
    expect(await chatOrders(f)).toHaveLength(1);
  } finally { await f.cleanup(); }
});

test("a pending without order expires after eight days and a partial completion on day six restarts the count", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    const withPolo = { findMessageCandidates: async () => ok({ unavailableProductIds: [], productIds: [catalog.polo.productId as ProductId], matchCount: 1, durationMs: 0, timedOut: false }) };
    setNow("2026-10-01T10:00:00Z");
    await say(f, "dos polos", addProduct(catalog.polo.productId, {}, 2), withPolo);
    setNow("2026-10-07T10:00:00Z");
    const partial = await say(f, "uno en M", completeFirst({ Talla: "M" }, 1));
    expect(outcomeKindsOf(partial)).toContain("pending_split");
    setNow("2026-10-09T10:00:00Z");
    expect(outcomeKindsOf(await say(f, "hola", noIntent))).toEqual(["no_intent"]);
    expect(await pendingCount(f)).toBe(2);
    setNow("2026-10-15T10:00:00Z");
    expect(outcomeKindsOf(await say(f, "hola", noIntent))).toEqual(["pending_ended", "pending_ended", "no_intent"]);
    expect(await pendingCount(f)).toBe(0);
  } finally { await f.cleanup(); }
});

/** An order paid by `parts` confirmed payments on day 1, with a polo pending drafted on day 2. */
async function paidOrderWithPolo(f: Fixture, catalog: Catalog, parts: number) {
  setNow("2026-10-01T10:00:00Z");
  await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
  const [order] = await chatOrders(f);
  const payments: string[] = [];
  for (let part = 0; part < parts; part += 1) payments.push(await addPayment(f, order!.id, "confirmed", `2026-10-01T11:0${part}:00.000Z`));
  setNow("2026-10-02T10:00:00Z");
  await showProduct(f, catalog.polo.productId);
  expect(await pendingCount(f)).toBe(1);
  return { order: order!, payments };
}

test("a pending without order joins an order reopened by a voided payment", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    const { order, payments } = await paidOrderWithPolo(f, catalog, 1);
    await voidPayment(f, payments[0]!, "2026-10-03T10:00:00.000Z");
    setNow("2026-10-04T10:00:00Z");
    const done = await say(f, "negro M", completeFirst({ Talla: "M", Color: "Negro" }));
    expect(outcomeKindsOf(done)).toContain("pending_completed");
    expect(await chatOrders(f)).toHaveLength(1);
    expect((await itemsOf(f))[0]).toContain(variantOf(catalog.polo, "M", "Negro"));
    expect(done.applied.kind === "applied" && done.applied.orderId).toBe(order.id);
  } finally { await f.cleanup(); }
});

test("a pending joins an order paid in two parts only when its second payment is voided, and completes into it nine days later", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    const { order, payments } = await paidOrderWithPolo(f, catalog, 2);
    await voidPayment(f, payments[0]!, "2026-10-03T10:00:00.000Z");
    await voidPayment(f, payments[1]!, "2026-10-04T10:00:00.000Z");
    setNow("2026-10-11T10:00:00Z");
    const done = await say(f, "negro M", completeFirst({ Talla: "M", Color: "Negro" }));
    expect(outcomeKindsOf(done)).toContain("pending_completed");
    expect(await chatOrders(f)).toHaveLength(1);
    expect(done.applied.kind === "applied" && done.applied.orderId).toBe(order.id);
  } finally { await f.cleanup(); }
});

test("a pending stays without order when a void leaves another payment confirmed, and goes into a new order", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    const { order, payments } = await paidOrderWithPolo(f, catalog, 2);
    await voidPayment(f, payments[0]!, "2026-10-03T10:00:00.000Z");
    setNow("2026-10-05T10:00:00Z");
    const done = await say(f, "negro M", completeFirst({ Talla: "M", Color: "Negro" }));
    expect(outcomeKindsOf(done)).toContain("pending_completed");
    const orders = await chatOrders(f);
    expect(orders).toHaveLength(2);
    expect(orders[0]!.id).toBe(order.id);
    expect(orders[1]!.items.map((item) => item.variantId)).toEqual([variantOf(catalog.polo, "M", "Negro")]);
  } finally { await f.cleanup(); }
});

test("two orderless pendings follow the two different orders reopened after each and end with them", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    const withPolo = { findMessageCandidates: async () => ok({ unavailableProductIds: [], productIds: [catalog.polo.productId as ProductId], matchCount: 1, durationMs: 0, timedOut: false }) };
    setNow("2026-10-01T10:00:00Z");
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    const [first] = await chatOrders(f);
    const paidFirst = await addPayment(f, first!.id, "confirmed", "2026-10-01T10:30:00.000Z");
    setNow("2026-10-01T11:00:00Z");
    await apply(f, await message(f, { codes: [f.variantIds[1]!] }));
    const [, second] = await chatOrders(f);
    const paidSecond = await addPayment(f, second!.id, "confirmed", "2026-10-01T11:30:00.000Z");
    setNow("2026-10-02T10:00:00Z");
    await say(f, "un polo", addProduct(catalog.polo.productId), withPolo);
    await voidPayment(f, paidFirst, "2026-10-03T10:00:00.000Z");
    await addPayment(f, first!.id, "reported", "2026-10-03T10:30:00.000Z");
    setNow("2026-10-03T12:00:00Z");
    const secondPending = await showProduct(f, catalog.polo.productId);
    expect(outcomeKindsOf(secondPending)).toEqual(["pending_ended", "pending_created", "variant_missing"]); // the first one joined the reopened first order and its payment ended it
    await voidPayment(f, paidSecond, "2026-10-04T10:00:00.000Z");
    await addPayment(f, second!.id, "reported", "2026-10-04T10:30:00.000Z");
    setNow("2026-10-05T10:00:00Z");
    const late = await say(f, "en M", (context) => (context.pendings.length ? completeFirst({ Talla: "M" })(context) : { kind: "actions", actions: [{ kind: "variant_only" }], moreActions: false }));
    expect(outcomeKindsOf(late)).toEqual(["pending_ended", "variant_only"]);
    expect(await pendingCount(f)).toBe(0);
  } finally { await f.cleanup(); }
});

test("«y el polo básico rojo x2» on a ×1 polo pending reports variant not available and a later «negro» adds two", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    setNow("2026-10-01T10:00:00Z");
    await showProduct(f, catalog.polo.productId);
    setNow("2026-10-01T10:05:00Z");
    const red = await say(f, "y el polo básico rojo x2", addProduct(catalog.polo.productId, { Color: "Rojo" }, 2));
    expect(outcomeKindsOf(red)).toContain("variant_not_available");
    expect((await storedPendings(f))!.pendings).toMatchObject([{ quantity: 2 }]);
    setNow("2026-10-01T10:10:00Z");
    const black = await say(f, "negro", completeFirst({ Color: "Negro", Talla: "M" }));
    expect(outcomeKindsOf(black)).toContain("pending_completed");
    const [order] = await chatOrders(f);
    expect(order!.items.map((item) => [item.variantId, Number(item.quantity)])).toEqual([[variantOf(catalog.polo, "M", "Negro"), 2]]);
  } finally { await f.cleanup(); }
});

test("a gorra photo whose caption names the pending polo adds both items with no notice", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    setNow("2026-10-01T10:00:00Z");
    await showProduct(f, catalog.polo.productId);
    setNow("2026-10-01T10:05:00Z");
    const done = await showProduct(f, catalog.gorra.productId, (context) => actions(
      { kind: "add", product: { kind: "ref", ref: refOf(context, catalog.gorra.productId) }, attributes: [], quantity: null, price: null },
      { kind: "add", product: { kind: "ref", ref: refOf(context, catalog.polo.productId) }, attributes: choices({ Talla: "M", Color: "Negro" }), quantity: null, price: null }), "y el polo negro M");
    expect(noticeDue(done)).toBe(false);
    expect(await itemsOf(f)).toEqual([[catalog.gorra.variantIds[0]!, variantOf(catalog.polo, "M", "Negro")].sort()]);
    expect(await pendingCount(f)).toBe(0);
  } finally { await f.cleanup(); }
});

test("ready with a pending, then completion sends ready", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    setNow("2026-10-01T10:00:00Z");
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    setNow("2026-10-01T10:05:00Z");
    await showProduct(f, catalog.polo.productId);
    setNow("2026-10-01T10:10:00Z");
    const ready = await say(f, "listo", () => actions({ kind: "ready" }));
    expect(outcomeKindsOf(ready)).toEqual(["ready_with_pendings"]);
    expect(noticeDue(ready)).toBe(true);
    setNow("2026-10-01T10:15:00Z");
    const completed = await say(f, "negro M", completeFirst({ Talla: "M", Color: "Negro" }));
    expect(outcomeKindsOf(completed)).toEqual(expect.arrayContaining(["pending_completed", "ready"]));
    expect(noticeDue(completed)).toBe(true);
  } finally { await f.cleanup(); }
});

test("the same completing message delivered twice adds one item", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    setNow("2026-10-01T10:00:00Z");
    await showProduct(f, catalog.polo.productId);
    setNow("2026-10-01T10:05:00Z");
    const first = await say(f, "negro M", completeFirst({ Talla: "M", Color: "Negro" }));
    const again = await apply(f, first.messageId, { readChatMessage: asReader(completeFirst({ Talla: "M", Color: "Negro" })) });
    expect(again).toMatchObject({ success: true, data: { kind: "already_processed" } });
    const [order] = await chatOrders(f);
    expect(order!.items.map((item) => Number(item.quantity))).toEqual([1]);
  } finally { await f.cleanup(); }
});

test("a deactivated product's pending ends with product not available", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    setNow("2026-10-01T10:00:00Z");
    await showProduct(f, catalog.polo.productId);
    await inTenant(f, () => prisma.productVariant.updateMany({ where: { productId: catalog.polo.productId }, data: { status: "inactive" } }));
    setNow("2026-10-01T10:05:00Z");
    const done = await say(f, "negro M", completeFirst({ Talla: "M", Color: "Negro" }));
    expect(outcomeKindsOf(done)).toEqual(["pending_ended", "product_not_available"]);
    expect(noticeDue(done)).toBe(true);
    expect(await chatOrders(f)).toHaveLength(0);
    expect(await pendingCount(f)).toBe(0);
  } finally { await f.cleanup(); }
});

test("eleven pendings end the first silently", async () => {
  const f = await fixture();
  try {
    const seeded = await Promise.all(Array.from({ length: 11 }, (_, n) => inTenant(f, () => seedProduct({ name: `Producto ${n}`, variants: [{ attributes: { Talla: "M" }, salePrice: 10 }, { attributes: { Talla: "L" }, salePrice: 10 }] }))));
    let last: Awaited<ReturnType<typeof say>> | null = null;
    for (const [n, product] of seeded.entries()) {
      setNow(`2026-10-01T10:${String(n).padStart(2, "0")}:00Z`);
      last = await say(f, `quiero producto ${n}`, addProduct(product.productId), { findMessageCandidates: async () => ok({ unavailableProductIds: [], productIds: [product.productId as ProductId], matchCount: 1, durationMs: 0, timedOut: false }) });
    }
    expect(await pendingCount(f)).toBe(10);
    expect(outcomeKindsOf(last!)).toEqual(["pending_created", "variant_missing", "pending_ended"]);
    const ids = ((await storedPendings(f))!.pendings as Array<{ subject: { productId: string } }>).map((pending) => pending.subject.productId);
    expect(ids).not.toContain(seeded[0]!.productId);
    expect(ids).toContain(seeded[10]!.productId);
  } finally { await f.cleanup(); }
});

test("two concurrent runs of one message write one item and one outcome", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    setNow("2026-10-01T10:00:00Z");
    await showProduct(f, catalog.polo.productId);
    setNow("2026-10-01T10:05:00Z");
    const messageId = await message(f, { text: "negro M" });
    const over = { readChatMessage: asReader(completeFirst({ Talla: "M", Color: "Negro" })) };
    const results = await Promise.all([apply(f, messageId, over), apply(f, messageId, over)]);
    expect(results.map(kind).sort()).toEqual(["already_processed", "applied"]);
    const [order] = await chatOrders(f);
    expect(order!.items.map((item) => Number(item.quantity))).toEqual([1]);
    expect(await inTenant(f, () => prisma.chatMessageOutcome.count({ where: { messageId } }))).toBe(1);
  } finally { await f.cleanup(); }
});

// ---- The photo just sent, the payment request and the not-sellable product. ----

const unnamedSet = (quantity: number): Reader => () => actions({ kind: "change_quantity", target: { kind: "unnamed" }, mode: "set", quantity });
const storedMemory = async (f: Fixture) => (await storedPendings(f))?.lastIncomingPhoto ?? null;
const pendingQuantities = async (f: Fixture) => ((await storedPendings(f))?.pendings as { quantity: number }[] | undefined ?? []).map(({ quantity }) => quantity);
const outgoing = (f: Fixture, text: string) => inTenant(f, async () => {
  const id = randomUUID();
  await prisma.chatMessage.create({ data: { id, chatId: f.chatId, externalId: `ext-${id}`, whatsappMessageId: `wa-${id}`, direction: "outgoing", source: "seller", type: "text", text,
    uploadedByUserId: f.sellerId, sentAt: new Date(), receivedAt: new Date() } });
  return id as ChatMessageId;
});
const itemQuantities = async (f: Fixture) => (await chatOrders(f)).flatMap((order) => order.items.map((item) => Number(item.quantity)));

test("a photo then «quiero 3 de esos» sets the photo's pending to 3 without a notice", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    await showProduct(f, catalog.polo.productId);
    expect(await storedMemory(f)).toMatchObject({ left: { kind: "pending" } });
    const done = await say(f, "quiero 3 de esos", unnamedSet(3));
    expect(outcomeKindsOf(done)).toEqual(["pending_updated"]);
    expect(noticeDue(done)).toBe(false);
    expect(await pendingQuantities(f)).toEqual([3]);
    expect(await storedMemory(f)).toBeNull();
  } finally { await f.cleanup(); }
});

test("a photo of a single-variant product then a set quantity sets the item without a notice", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    await showProduct(f, catalog.gorra.productId);
    expect(await itemQuantities(f)).toEqual([1]);
    const done = await say(f, "quiero 3 de esos", unnamedSet(3));
    expect(noticeDue(done)).toBe(false);
    expect(await itemQuantities(f)).toEqual([3]);
  } finally { await f.cleanup(); }
});

test("a photo, an outgoing seller reply and an emoji text, then a set quantity still apply to the photo", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    await showProduct(f, catalog.polo.productId);
    const reply = await outgoing(f, "¡Claro! ¿Qué talla?");
    expect(await apply(f, reply)).toMatchObject({ success: true, data: { kind: "skipped", reason: "outgoing_message" } });
    expect(outcomeKindsOf(await say(f, "👍", noIntent))).toEqual(["skipped"]);
    const done = await say(f, "quiero 3 de esos", unnamedSet(3));
    expect(noticeDue(done)).toBe(false);
    expect(await pendingQuantities(f)).toEqual([3]);
  } finally { await f.cleanup(); }
});

test("two photos in a row then a set quantity change nothing and notify an unnamed add", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    await showProduct(f, catalog.polo.productId);
    await showProduct(f, catalog.polo.productId);
    const before = await pendingQuantities(f);
    const done = await say(f, "quiero 3 de esos", unnamedSet(3));
    expect(outcomeKindsOf(done)).toContain("unnamed_add");
    expect(noticeDue(done)).toBe(true);
    expect(await pendingQuantities(f)).toEqual(before);
  } finally { await f.cleanup(); }
});

test("a photo then a second photo with caption «quiero 3» leaves the first photo's pending unchanged and gives the second photo's product quantity 3", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    await showProduct(f, catalog.polo.productId);
    const done = await showProduct(f, catalog.gorra.productId, unnamedSet(3), "quiero 3");
    expect(noticeDue(done)).toBe(false);
    expect(await pendingQuantities(f)).toEqual([1]);
    expect(await itemQuantities(f)).toEqual([3]);
  } finally { await f.cleanup(); }
});

test("a photo then a text too long then a set quantity notify an unnamed add", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    await showProduct(f, catalog.polo.productId);
    const long = await say(f, "a".repeat(2001), noIntent);
    expect(outcomeKindsOf(long)).toEqual(["invalid_action"]);
    expect(await storedMemory(f)).toBeNull();
    const done = await say(f, "quiero 3 de esos", unnamedSet(3));
    expect(outcomeKindsOf(done)).toContain("unnamed_add");
    expect(await pendingQuantities(f)).toEqual([1]);
  } finally { await f.cleanup(); }
});

test("a photo then «gracias» then a set quantity notify an unnamed add", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    await showProduct(f, catalog.polo.productId);
    await say(f, "gracias", noIntent);
    const done = await say(f, "quiero 3 de esos", unnamedSet(3));
    expect(outcomeKindsOf(done)).toContain("unnamed_add");
    expect(noticeDue(done)).toBe(true);
    expect(await pendingQuantities(f)).toEqual([1]);
  } finally { await f.cleanup(); }
});

test("a failed message after a photo makes a following set quantity an unnamed add", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    await showProduct(f, catalog.polo.productId);
    const failedId = await message(f, { text: "algo" });
    const recorded = await inTenant(f, () => recordFailedChatMessage({ transaction: (work) => withinTransaction(work), insertFailedOutcome, saveLastIncomingPhotoOfMessageChat })(failedId, "INVALID_AI_RESPONSE"));
    expect(recorded).toEqual({ success: true, data: { publishNotice: true } });
    expect(await storedMemory(f)).toEqual({ left: null });
    const done = await say(f, "quiero 3 de esos", unnamedSet(3));
    expect(outcomeKindsOf(done)).toContain("unnamed_add");
    expect(await pendingQuantities(f)).toEqual([1]);
  } finally { await f.cleanup(); }
});

test("a payment request with an open order and a pending left records the payment outcome and its notice is due", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    await showProduct(f, catalog.gorra.productId);
    await showProduct(f, catalog.polo.productId);
    const done = await say(f, "¿cómo te pago?", () => actions({ kind: "payment_request" }));
    const [order] = await chatOrders(f);
    expect(done.applied).toMatchObject({ kind: "applied", noticeDue: true,
      outcomes: [{ kind: "payment_requested", order: { kind: "open", orderId: order!.id }, productIds: [catalog.polo.productId], unnamed: 0 }] });
    expect(await itemQuantities(f)).toEqual([1]);
  } finally { await f.cleanup(); }
});

test("a named product whose variants are all inactive reports product not available", async () => {
  const f = await fixture();
  try {
    const catalog = await seedCatalog(f);
    const old = await inTenant(f, () => seedProduct({ name: "Casaca denim antigua", variants: [{ attributes: { Talla: "M" }, salePrice: 90 }] }));
    await inTenant(f, () => prisma.productVariant.updateMany({ where: { productId: old.productId }, data: { status: "inactive" } }));
    const done = await say(f, "quiero la casaca denim antigua", (context) => {
      const entry = context.products.find(({ productId }) => productId === old.productId);
      expect(entry).toMatchObject({ sellable: false });
      return actions({ kind: "add", product: { kind: "ref", ref: entry!.ref }, attributes: [], quantity: null, price: null });
    }, { findMessageCandidates: (text) => products.findMessageCandidates(text) });
    expect(outcomeKindsOf(done)).toEqual(["product_not_available"]);
    expect(noticeDue(done)).toBe(true);
    expect(catalog.polo.productId).not.toBe(old.productId);
  } finally { await f.cleanup(); }
});
