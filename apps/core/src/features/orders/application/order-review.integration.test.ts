import { findUnverdictedChanges, saveMessageChanges } from "@core/src/features/orders/infrastructure/message-change-repository";
import type { OrderItemChangeId, OrderReviewId } from "@core/src/features/orders/domain/message-changes";
import type { OrderLinkActionId } from "@core/src/features/orders/domain/order-review";
import { saveMessageTrace } from "@core/src/features/orders/infrastructure/message-trace-repository";
import { toOrderAggregateListJson } from "@core/src/features/orders/presentation/order-json";
import type { QuoteId } from "@core/src/features/orders/domain/reader/refs";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { ok } from "@shared/functional";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import type { ChatSourceMessage } from "@core/src/features/orders/application/chat-source-message";
import { applyChatMessage, type ApplyChatMessageDependencies } from "@core/src/features/orders/application/apply-chat-message";
import { allocateOrderNumber, findChatOrderTarget, findChatOrderTargetForUpdate, findChatOrdersOpenedSince, recordProcessedMessage, savePendingOrder } from "@core/src/features/orders/infrastructure/order-repository";
import { findOutcome, recordOutcome } from "@core/src/features/orders/infrastructure/chat-message-outcome-repository";
import { findChatMemory, findChatPendings, findChatPendingsForUpdate, saveChatPendings } from "@core/src/features/orders/infrastructure/chat-pending-repository";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import { ensureCustomerForContact, lockContact } from "@core/src/features/contacts/infrastructure/contact-repository";
import { findProductIdsOfVariants, findSellableVariantsByQrCodes } from "@core/src/features/products";
import { products } from "@core/src/features/products/composition";
import { loadReadingContext, orders, saveChatItemChanges } from "@core/src/features/orders/composition";
import { buildMessageTrace } from "@core/src/features/orders/application/reader/build-message-trace";
import { withAbort } from "@core/src/features/orders/infrastructure/reader/runtime/reading-deadline";
import { findLinkNoticeArming } from "@core/src/features/orders/infrastructure/order-review-repository";
import type { OrderLineQuantity } from "@core/src/features/orders/domain/order-edit";
import type { VariantId } from "@core/src/features/products/domain/product";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { identifyProductsInImage } from "@core/src/features/products/application/identify-products-in-image";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, ContactId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { VariantQrCode } from "@core/src/features/products/domain/image-identification";

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** The simulated time of the use cases; a test moves it between messages. */
let simulated: Date | null = null;
const clockNow = () => simulated ?? new Date();
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
      id: variantId, attributes: { Size: index ? "L" : "M" }, sku: `SKU-${variantId}`, salePrice: index ? 20 : 10, stock: 50, qrCode: variantId })) });
    await prisma.contact.create({ data: { id: contactId, whatsappAccountId: "111@lid", whatsappLid: "222@lid" } });
    await prisma.chat.create({ data: { id: chatId, contactId } });
  });
  return { companyId, sellerId, contactId, chatId, productId, variantIds, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      for (const table of ["chatPendings", "chatMessageOutcome", "orderLinkAction", "orderItemChange", "orderReview", "messageTrace", "messageMaskedText", "orderMessage", "payment", "orderItem", "order", "chatMessage", "chat", "contact", "customer", "productStock", "productVariant", "productOption", "product", "image"] as const)
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

function dependencies(f: Fixture, over: Partial<ApplyChatMessageDependencies> = {}): ApplyChatMessageDependencies {
  const companyId = f.companyId as CompanyId;
  return {
    findOutcome,
    findSourceMessage: async (id) => {
      const row = await prisma.chatMessage.findFirst({ where: { id }, include: { chat: true } });
      return ok(row && { id: row.id as ChatMessageId, companyId, chatId: row.chatId as ChatId, contactId: row.chat.contactId as ContactId, direction: row.direction,
        uploadedByUserId: row.uploadedByUserId as UserId, imageId: row.imageId as ImageId | null, text: row.text, caption: row.caption, sentAt: row.sentAt, receivedAt: row.receivedAt } satisfies ChatSourceMessage);
    },
    findChatOrderTarget: (chatId) => findChatOrderTarget(chatId, findProductIdsOfVariants),
    findChatOrdersOpenedSince,
    findChatPendings,
    findChatPendingsForUpdate,
    findChatMemory,
    saveChatPendings,
    readImage: async (imageId) => ok({ bytes: new TextEncoder().encode(imageId), contentType: "image/jpeg" }),
    identifyProductsInImage: (image) => identifyProductsInImage(image, { visual: null,
      readQrCodes: async ({ bytes }) => ok(photos.get(new TextDecoder().decode(bytes)) ?? []),
      findVariantsByCodes: async (codes) => { const found = await findSellableVariantsByQrCodes(codes); return found.success ? ok(found.data.map((item) => ({ ...item, qrCode: item.qrCode as VariantQrCode, productId: item.productId as ProductId }))) : found; } }),
    loadReadingContext: (loaded, target, pendings, photoMemory) => loadReadingContext(loaded, target, pendings, photoMemory),
    findMentionCandidates: (mentions) => products.findMentionCandidates(mentions),
    findProductsForReading: (productIds) => products.findProductsForReading(productIds),
    catalogSearchReadiness: async () => ok("no_searchable_photos"),
    // These tests read only label photos, which call no stage.
    stages: null,
    readChatMessage: null,
    createDeadline: (_budget, _meta, jobSignal) => jobSignal,
    withAbort,
    transaction: (_company, work) => withinTransaction(work),
    lockContact,
    ensureCustomerForContact: async (contactId) => { const ensured = await ensureCustomerForContact(contactId); return ensured.success ? ok({ customerId: ensured.data.customerId as CustomerId }) : ensured; },
    findChatOrderTargetForUpdate: (chatId) => findChatOrderTargetForUpdate(chatId, findProductIdsOfVariants),
    allocateNumber: () => allocateOrderNumber(companyId),
    saveNewOrder: savePendingOrder,
    saveItemChanges: saveChatItemChanges,
    recordOrderMessage: recordProcessedMessage,
    findUnverdictedChanges,
    findLinkNoticeArming,
    saveMessageChanges,
    newChangeId: () => randomUUID() as OrderItemChangeId,
    recordOutcome,
    newOrderId: () => randomUUID() as OrderId,
    newItemId: () => randomUUID() as OrderItemId,
    newPendingId: () => randomUUID() as ChatPendingId,
    clock: () => clockNow(),
    buildMessageTrace,
    saveMessageTrace: async () => ok(null),
    shadowReader: null,
    limits: { maxItemQuantity: 99 as PositiveInteger, pendingTtlMs: 7 * 86_400_000, maxReaderProducts: 24, maxReaderItems: 40, maxReaderTextChars: 2000,
      readingBudgetMs: 60_000, candidatesPerMention: 5, traceRetentionDays: 90, shadowWaitMs: 0 },
    ...over,
  };
}

const apply = (f: Fixture, messageId: ChatMessageId, over?: Partial<ApplyChatMessageDependencies>) =>
  withTenantIsolation(f.companyId, () => applyChatMessage({ companyId: f.companyId as CompanyId, messageId }, dependencies(f, over), new AbortController().signal));
const inTenant = <T,>(f: Fixture, work: () => Promise<T>) => withTenantIsolation(f.companyId, async () => await work()); // Prisma queries are lazy: await inside the tenant scope
const chatOrders = (f: Fixture) => inTenant(f, () => prisma.order.findMany({ where: { chatId: f.chatId }, include: { items: true, buyer: true }, orderBy: { number: "asc" } }));
const quantities = (order: { items: { variantId: string; quantity: bigint }[] }) => Object.fromEntries(order.items.map((item) => [item.variantId, Number(item.quantity)]));

type Order = Awaited<ReturnType<typeof chatOrders>>[number];
const access = (f: Fixture) => ({ companyId: f.companyId as CompanyId, userId: f.sellerId as UserId });
const load = async (f: Fixture, orderId: string) => {
  const loaded = await inTenant(f, () => orders.loadOrderReview({ orderId: orderId as OrderId }, access(f)));
  if (!loaded.success) throw new Error(loaded.error.code);
  return loaded.data;
};
const confirm = (f: Fixture, review: Awaited<ReturnType<typeof load>>, orderId: string, overrides: Partial<Parameters<typeof orders.confirmOrderReview>[0]> = {}) =>
  inTenant(f, () => orders.confirmOrderReview({ reviewId: randomUUID() as OrderReviewId, orderId: orderId as OrderId, origin: "link", linkAction: null, loaded: review.loaded, corrections: [], ...overrides }, access(f)));
const changes = (f: Fixture) => inTenant(f, () => prisma.orderItemChange.findMany({ orderBy: { seq: "asc" } }));
/** Marks the change as doubtful, as a message that read it with doubt would have written it. */
const markDoubtful = (f: Fixture, changeId: string) => inTenant(f, () => prisma.$executeRaw`UPDATE "OrderItemChange" SET decision = 'doubtful', doubt = '{"kind":"caption_unread"}'::jsonb WHERE id = ${changeId}::uuid`);
const lastChange = async (f: Fixture) => (await changes(f)).at(-1)!;

/** Order #1: variant 0 added by a sure message, variant 1 added by a doubtful one. */
async function orderWithDoubtfulItem(f: Fixture) {
  await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
  await apply(f, await message(f, { codes: [f.variantIds[1]!] }));
  await markDoubtful(f, (await lastChange(f)).id);
  const [order] = await chatOrders(f);
  return order!;
}
const itemOf = (order: Order, variantId: string) => order.items.find((item) => item.variantId === variantId)!;

test("a review that removes a doubtful item removes it, records removed and a second review finds nothing to review", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    const review = await load(f, order.id);
    expect(review.status).toMatchObject({ toReview: true, doubtfulCount: 1, entry: "link" });
    expect(review.doubtful).toHaveLength(1);
    const removed = itemOf(order, f.variantIds[1]!);
    expect(await confirm(f, review, order.id, { corrections: [{ itemId: removed.id as OrderItemId, quantity: 0 }], linkAction: { id: randomUUID() as OrderLinkActionId, action: "copy" } })).toMatchObject({ success: true });
    expect(Object.keys(quantities((await chatOrders(f))[0]!))).toEqual([f.variantIds[0]]);
    expect((await changes(f)).map((change) => change.verdict)).toEqual(["kept", "removed"]);
    expect(await inTenant(f, () => prisma.orderLinkAction.count())).toBe(1);
    expect((await load(f, order.id)).status).toMatchObject({ toReview: false, doubtfulCount: 0, hasPreviousReview: true });
  } finally { await f.cleanup(); }
});

test("confirming a review answers REVIEW_OUTDATED and writes nothing when a message added a mark meanwhile", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    const review = await load(f, order.id);
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    await markDoubtful(f, (await lastChange(f)).id);
    expect(await confirm(f, review, order.id)).toMatchObject({ success: false, error: { code: "REVIEW_OUTDATED", affectedItemIds: [itemOf(order, f.variantIds[0]!).id] } });
    expect(await inTenant(f, () => prisma.orderReview.count())).toBe(0);
    expect((await changes(f)).every((change) => change.reviewId === null)).toBe(true);
  } finally { await f.cleanup(); }
});

test("confirming a review answers ORDER_CHANGED when another seller saved an edit meanwhile", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    const review = await load(f, order.id);
    const edited = await inTenant(f, () => orders.edit({ orderId: order.id as OrderId, items: { base: review.loaded.itemsRevision,
      lines: [{ variantId: f.variantIds[0]! as VariantId, quantity: 4 as OrderLineQuantity }, { variantId: f.variantIds[1]! as VariantId, quantity: 1 as OrderLineQuantity }] } }, access(f)));
    expect(edited.success).toBe(true);
    expect(await confirm(f, review, order.id)).toMatchObject({ success: false, error: { code: "ORDER_CHANGED" } });
    expect(await inTenant(f, () => prisma.orderReview.count())).toBe(0);
  } finally { await f.cleanup(); }
});

test("confirming a review succeeds when a sure message changed another item meanwhile", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    const review = await load(f, order.id);
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    const answer = await confirm(f, review, order.id, { corrections: [{ itemId: itemOf(order, f.variantIds[1]!).id as OrderItemId, quantity: 0 }] });
    expect(answer).toMatchObject({ success: true, data: { changedMeanwhile: [{ kind: "quantity_changed" }] } });
    const stored = await inTenant(f, () => prisma.orderReview.findFirstOrThrow());
    expect(stored.confirmedThrough).toBeGreaterThan(stored.changesThrough);
    // The sure change stays unreviewed: it comes back in the next review as a change since the last one.
    expect((await load(f, order.id)).status).toMatchObject({ toReview: true, doubtfulCount: 0, hasPreviousReview: true });
  } finally { await f.cleanup(); }
});

test("a second review succeeds after a first review confirmed earlier changes of the order", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    expect(await confirm(f, await load(f, order.id), order.id)).toMatchObject({ success: true });
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    const second = await load(f, order.id);
    expect(second.loaded.changeIds).toHaveLength(1);
    expect(await confirm(f, second, order.id)).toMatchObject({ success: true });
    expect(await inTenant(f, () => prisma.orderReview.count())).toBe(2);
  } finally { await f.cleanup(); }
});

test("confirming a review twice with the same id returns the same answer and leaves one review row", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    const review = await load(f, order.id);
    const reviewId = randomUUID() as OrderReviewId;
    const first = await confirm(f, review, order.id, { reviewId });
    const [again, concurrent] = await Promise.all([confirm(f, review, order.id, { reviewId }), confirm(f, review, order.id, { reviewId })]);
    for (const answer of [again, concurrent]) expect(answer).toMatchObject({ success: true, data: { review: { id: reviewId } } });
    expect(first.success && again.success && again.data.review).toEqual(first.success && first.data.review);
    expect(await inTenant(f, () => prisma.orderReview.count())).toBe(1);
  } finally { await f.cleanup(); }
});

test("confirming a review with corrections on a shipped order answers DELIVERY_LOCKED and without corrections clears the marks", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    await inTenant(f, () => prisma.order.update({ where: { id: order.id }, data: { deliveryStatus: "shipped", shippedAt: new Date(), stockDeducted: true, stockDeductedAt: new Date() } }));
    const review = await load(f, order.id);
    expect(review.status).toMatchObject({ openForMessages: false, entry: "detail", toReview: true, doubtfulCount: 1 });
    expect(await confirm(f, review, order.id, { corrections: [{ itemId: itemOf(order, f.variantIds[1]!).id as OrderItemId, quantity: 0 }] })).toMatchObject({ success: false, error: { code: "DELIVERY_LOCKED" } });
    expect(await confirm(f, review, order.id)).toMatchObject({ success: true });
    expect((await load(f, order.id)).status).toMatchObject({ toReview: false, doubtfulCount: 0 });
  } finally { await f.cleanup(); }
});

test("an earlier doubtful change asks for review again after the message that superseded it is undone", async () => {
  const f = await fixture();
  try {
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    await markDoubtful(f, (await lastChange(f)).id);
    const second = await message(f, { codes: [f.variantIds[0]!] });
    await apply(f, second);
    const [order] = await chatOrders(f);
    expect((await load(f, order!.id)).status.doubtfulCount).toBe(0);
    expect(await inTenant(f, () => orders.undoMessage({ orderId: order!.id as OrderId, messageId: second }, access(f)))).toMatchObject({ success: true, data: { undone: true } });
    const after = await load(f, order!.id);
    expect(after.status).toMatchObject({ doubtfulCount: 1, toReview: true });
    expect(after.doubtful).toHaveLength(1);
    expect(after.messageRows.map((row) => row.undo.kind)).toEqual(["undone", "refused"]); // the first message created the only item, so undoing it would empty the order
  } finally { await f.cleanup(); }
});

test("link actions with a repeated id are stored once", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    const input = { id: randomUUID() as OrderLinkActionId, orderId: order.id as OrderId, action: "open" as const };
    expect(await inTenant(f, () => orders.recordLinkAction(input, access(f)))).toMatchObject({ success: true });
    expect(await inTenant(f, () => orders.recordLinkAction(input, access(f)))).toMatchObject({ success: true });
    expect(await inTenant(f, () => prisma.orderLinkAction.count())).toBe(1);
    expect(await inTenant(f, () => orders.recordLinkAction({ ...input, id: randomUUID() as OrderLinkActionId, orderId: randomUUID() as OrderId }, access(f)))).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
  } finally { await f.cleanup(); }
});

test("GET review returns quotes while the trace exists and only reasons after it is deleted", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    const doubtful = await lastChange(f);
    await inTenant(f, () => prisma.$executeRaw`UPDATE "OrderItemChange" SET "quoteId" = 1 WHERE id = ${doubtful.id}::uuid`);
    const future = new Date(Date.now() + 86_400_000);
    await inTenant(f, () => saveMessageTrace({ companyId: f.companyId as CompanyId, messageId: doubtful.messageId as ChatMessageId, messageReceivedAt: new Date(), expiresAt: future, startedAt: new Date(), decidedAt: new Date(), queuedMs: 0,
      shadowWaitMs: null, textState: "masked", contextMessageIds: [], photo: null, stages: [], quotes: [{ id: 1 as QuoteId, text: "la quiero en L" }], decisions: [], shadow: null, costUsd: 0.01 } as never,
      [{ messageId: doubtful.messageId as ChatMessageId, text: "la quiero en L", expiresAt: future }]));
    expect((await load(f, order.id)).doubtful[0]).toMatchObject({ quote: "la quiero en L", change: { decision: { kind: "doubtful", reason: { kind: "caption_unread" } } } });
    await inTenant(f, async () => { await prisma.messageTrace.deleteMany(); });
    expect((await load(f, order.id)).doubtful[0]).toMatchObject({ quote: null, change: { decision: { kind: "doubtful" } } });
  } finally { await f.cleanup(); }
});

const payment = (f: Fixture, orderId: string, amount: number) => inTenant(f, () => orders.registerPayment({ orderId: orderId as OrderId, paymentId: randomUUID() as PaymentId,
  amount: { amount, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: true }, access(f)));
const verdicts = async (f: Fixture) => (await changes(f)).map((change) => change.verdict);

test("a payment that completes a delivered order fixes not_reviewed on its unverdicted changes", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    expect(await payment(f, order.id, 5)).toMatchObject({ success: true });
    expect(await inTenant(f, () => orders.deliver(order.id as OrderId, access(f)))).toMatchObject({ success: true, data: { completedAt: null } });
    expect(await verdicts(f)).toEqual([null, null]);
    expect(await payment(f, order.id, 25)).toMatchObject({ success: true, data: { order: { completedAt: expect.any(Date) } } });
    expect(await verdicts(f)).toEqual(["not_reviewed", "not_reviewed"]);
    expect((await load(f, order.id)).status).toMatchObject({ toReview: false, entry: "none", doubtfulCount: 0 });
  } finally { await f.cleanup(); }
});

test("delivering a paid order fixes not_reviewed on its unverdicted changes", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    expect(await payment(f, order.id, 30)).toMatchObject({ success: true });
    expect(await verdicts(f)).toEqual([null, null]);
    expect(await inTenant(f, () => orders.deliver(order.id as OrderId, access(f)))).toMatchObject({ success: true, data: { completedAt: expect.any(Date) } });
    expect(await verdicts(f)).toEqual(["not_reviewed", "not_reviewed"]);
  } finally { await f.cleanup(); }
});

test("marking a paid order delivered from the shipping update fixes not_reviewed on its unverdicted changes", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    expect(await payment(f, order.id, 30)).toMatchObject({ success: true });
    expect(await inTenant(f, () => orders.updateShipping({ orderId: order.id as OrderId, status: "delivered" }, access(f)))).toMatchObject({ success: true, data: { completedAt: expect.any(Date) } });
    expect(await verdicts(f)).toEqual(["not_reviewed", "not_reviewed"]);
  } finally { await f.cleanup(); }
});

test("cancelling an order fixes not_reviewed on its unverdicted changes and hides its marks", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    expect(await inTenant(f, () => orders.cancel(order.id as OrderId, access(f)))).toMatchObject({ success: true });
    expect(await verdicts(f)).toEqual(["not_reviewed", "not_reviewed"]);
    expect((await load(f, order.id)).status).toMatchObject({ toReview: false, entry: "none", doubtfulCount: 0 });
  } finally { await f.cleanup(); }
});

test("voiding the completing payment keeps the not_reviewed verdicts", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    const paymentId = randomUUID() as PaymentId;
    expect(await inTenant(f, () => orders.registerPayment({ orderId: order.id as OrderId, paymentId, amount: { amount: 30, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: true }, access(f)))).toMatchObject({ success: true });
    await inTenant(f, () => orders.deliver(order.id as OrderId, access(f)));
    expect(await verdicts(f)).toEqual(["not_reviewed", "not_reviewed"]);
    expect(await inTenant(f, () => orders.voidPayment({ orderId: order.id as OrderId, paymentId }, access(f)))).toMatchObject({ success: true });
    expect(await verdicts(f)).toEqual(["not_reviewed", "not_reviewed"]);
  } finally { await f.cleanup(); }
});

test("the order list marks «Por revisar» only on active WhatsApp orders with something to review in a fixed number of queries", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    const list = async () => {
      const page = await inTenant(f, () => orders.listAggregates({ page: 1, customer: { kind: "all" } }, access(f)));
      if (!page.success) throw new Error(page.error.code);
      return toOrderAggregateListJson(page.data).items.map((item) => [item.id, item.toReview]);
    };
    expect(await list()).toEqual([[order.id, true]]);
    expect(await confirm(f, await load(f, order.id), order.id)).toMatchObject({ success: true });
    expect(await list()).toEqual([[order.id, false]]);
    await apply(f, await message(f, { codes: [f.variantIds[0]!] }));
    expect(await list()).toEqual([[order.id, true]]);
    await inTenant(f, () => orders.cancel(order.id as OrderId, access(f)));
    expect(await list()).toEqual([[order.id, false]]);
  } finally { await f.cleanup(); }
});

test("confirming a review with corrections on a deducted order settles the stock difference and serves waiting orders", async () => {
  const f = await fixture();
  try {
    const order = await orderWithDoubtfulItem(f);
    const [kept, removed] = [f.variantIds[0]!, f.variantIds[1]!];
    const stock = (variantId: string) => inTenant(f, async () => Number((await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity));
    await inTenant(f, () => prisma.productStock.update({ where: { variantId: removed }, data: { quantity: 1n } }));
    expect(await payment(f, order.id, 30)).toMatchObject({ success: true, data: { order: { stockDeducted: true } } });
    expect(await stock(removed)).toBe(0);
    const waiting = await inTenant(f, async () => {
      const id = randomUUID() as OrderId;
      const created = await orders.create({ id, items: [{ variantId: removed as VariantId, quantity: 1 as PositiveInteger }] }, access(f));
      expect(created.success).toBe(true);
      expect(await orders.registerPayment({ orderId: id, paymentId: randomUUID() as PaymentId, amount: { amount: 20, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, access(f))).toMatchObject({ success: true });
      return id;
    });
    expect((await inTenant(f, () => prisma.order.findUniqueOrThrow({ where: { id: waiting } }))).stockDeducted).toBe(false);

    const review = await load(f, order.id);
    const answer = await confirm(f, review, order.id, { corrections: [{ itemId: itemOf(order, removed).id as OrderItemId, quantity: 0 }] });
    expect(answer).toMatchObject({ success: true, data: { order: { stockDeducted: true } } });
    expect(await stock(removed)).toBe(0); // returned by the correction, taken by the waiting order
    expect(await stock(kept)).toBe(49);
    expect((await inTenant(f, () => prisma.order.findUniqueOrThrow({ where: { id: waiting } }))).stockDeducted).toBe(true);
    const items = await inTenant(f, () => prisma.orderItem.findMany({ where: { orderId: order.id } }));
    expect(items.map((item) => [item.variantId, Number(item.stockDeductedQuantity)])).toEqual([[kept, 1]]);
  } finally { await f.cleanup(); }
});
