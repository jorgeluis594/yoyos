import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { applyChatMessage, isRetryableChatMessageError, type ApplyChatMessageDependencies, type ChatSourceMessage } from "@core/src/features/orders/application/apply-chat-message";
import type { ReaderAnswer, ReaderAction, ChatReadingContext } from "@core/src/features/orders/domain/chat-reading";
import type { ContextTooLarge, FittedReadingContext, ReaderError } from "@core/src/features/orders/application/read-chat-message";
import type { ImageIdentification } from "@core/src/features/products/application/identify-products-in-image";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order";
import type { ChatPending, ChatPendingId, ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatMessageOutcomes, StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { CatalogItem, MatchConfidence } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { CatalogSearchReadiness } from "@core/src/features/products/domain/text-identification";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1) as CompanyId;
const messageId = id(2) as ChatMessageId;
const chatId = id(3) as ChatId;
const contactId = id(4) as ContactId;
const sellerId = "uploader" as UserId;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-11T12:00:00Z");
const hourBefore = new Date(at.getTime() - 3_600_000);
const productPolo = id(10) as ProductId;
const productCap = id(11) as ProductId;
const variant = (n: number, name: string, attributes: Record<string, string>, amount = 35): CatalogItem =>
  ({ variantId: id(100 + n) as VariantId, productName: name, variantAttributes: attributes, sku: null, unitPrice: money(amount) });
const poloM = variant(1, "Polo básico", { Talla: "M" });
const poloL = variant(2, "Polo básico", { Talla: "L" });
const cap = variant(3, "Gorra", {}, 25);
const forReading = (productId: ProductId, name: string, variants: readonly CatalogItem[], sellable = true): ProductForReading => ({ productId, name, nameKey: name.toLowerCase(), sellable,
  attributes: Object.entries(variants.reduce<Record<string, string[]>>((all, { variantAttributes }) => {
    for (const [attribute, value] of Object.entries(variantAttributes)) all[attribute] = [...new Set([...(all[attribute] ?? []), value])];
    return all;
  }, {})).map(([name, values]) => ({ name, values })), variants });
const polo = forReading(productPolo, "Polo básico", [poloM, poloL]);
const gorra = forReading(productCap, "Gorra", [cap]);

const photoMessage = (over: Partial<ChatSourceMessage> = {}): ChatSourceMessage => ({ id: messageId, companyId, chatId, contactId, direction: "incoming", uploadedByUserId: sellerId,
  imageId: id(5) as ImageId, text: null, caption: null, ...over });
const textMessage = (text: string | null, over: Partial<ChatSourceMessage> = {}): ChatSourceMessage => photoMessage({ imageId: null, text, ...over });

const visual = (productId: ProductId, confidence = 0.92): ImageIdentification =>
  ({ kind: "found", method: "visual", productId, confidence: confidence as MatchConfidence, candidates: 2, topDistance: 0.1, chosenDistance: 0.1 });
const notProduct: ImageIdentification = { kind: "not_product", topDistance: 0.5 };

const existingOrder = (items: OrderAggregate["items"] = [{ id: id(60) as OrderItemId, variantId: cap.variantId, productName: "Gorra", variantAttributes: {}, sku: null,
  quantity: 1 as PositiveInteger, unitPrice: money(25), subtotal: money(25), mentionedPrice: null }]): OrderAggregate => ({
  number: 1007 as OrderNumber, id: id(9) as OrderId, companyId, sellerId, chatId, buyer: { contactId, name: null, phone: null },
  fromCatalog: false, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: hourBefore, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false, cancelledAt: null,
  items, payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null,
  itemsTotal: money(25), deliveryCost: money(0), deliveryCharge: money(0), total: money(25) });
const openTarget = (order = existingOrder()): ChatOrderTarget => ({ kind: "open", order, productIds: new Map(order.items.map((item) => [item.variantId, productCap])) });

const pendingOf = (n: number, over: Partial<ChatPending> = {}): ChatPending => ({ id: id(n) as ChatPendingId, subject: { kind: "variant", productId: productPolo }, known: {}, quantity: 1 as PositiveInteger,
  price: null, order: null, lastChangedAt: hourBefore, sourceMessageId: id(900 + n) as ChatMessageId, requestId: id(n) as ChatPendingId, ...over });
const pendingSet = (...pendings: ChatPending[]): ChatPendings => ({ pendings, readyRemembered: false, lastIncomingPhoto: null });

const zeroUsage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 };
const refOf = (context: ChatReadingContext, productId: ProductId) => context.products.find((product) => product.productId === productId)!.ref;
const add = (context: ChatReadingContext, productId: ProductId, attributes: ReaderAction extends infer A ? A extends { kind: "add"; attributes: infer T } ? T : never : never = [], quantity: number | null = null): ReaderAction =>
  ({ kind: "add", product: { kind: "ref", ref: refOf(context, productId) }, attributes, quantity, price: null });
const actions = (...list: ReaderAction[]): ReaderAnswer => ({ kind: "actions", actions: list as [ReaderAction, ...ReaderAction[]], moreActions: false });

type Reader = (context: ChatReadingContext) => ReaderAnswer | ReaderError;
type Candidates = Readonly<{ productIds: readonly ProductId[]; unavailableProductIds?: readonly ProductId[]; matchCount: number; durationMs: number; timedOut: boolean }>;

type Options = Readonly<{
  message?: ChatSourceMessage | null;
  identification?: ImageIdentification;
  reader?: Reader | null;
  target?: ChatOrderTarget;
  pendings?: ChatPendings;
  openedSince?: readonly OrderAggregate[];
  stored?: StoredChatMessageOutcome;
  readiness?: CatalogSearchReadiness;
  catalog?: readonly ProductForReading[];
  candidates?: Candidates;
  limits?: Partial<ApplyChatMessageDependencies["limits"]>;
  overrides?: Partial<ApplyChatMessageDependencies>;
  fit?: (context: ChatReadingContext) => FittedReadingContext | ContextTooLarge;
  photoStageTimeoutMs?: number;
}>;

type Store = { orders: Map<string, OrderAggregate>; pendings: ChatPendings; customers: Set<string>; messages: Map<string, string>; outcomes: Map<string, ChatMessageOutcomes> };

/** In-memory ports; `transaction` restores the state when its work fails, like a rollback. */
function harness(options: Options = {}) {
  const calls: string[] = [];
  const contexts: ChatReadingContext[] = [];
  const readingIds: ProductId[][] = [];
  const candidateQueries: string[] = [];
  const openedSinceQueries: Date[] = [];
  const pendingSaves: ChatPendings[] = [];
  const identifySignals: AbortSignal[] = [];
  const store: Store = { orders: new Map(), pendings: options.pendings ?? pendingSet(), customers: new Set(), messages: new Map(), outcomes: new Map() };
  const called = <T,>(name: string, value: T): T => { calls.push(name); return value; };
  const target: ChatOrderTarget = options.target ?? { kind: "none" };
  if (target.kind === "open") store.orders.set(target.order.id, target.order);
  const catalog = options.catalog ?? [polo, gorra];
  const reader = options.reader === undefined ? ((): Reader => () => ({ kind: "no_intent" }))() : options.reader;
  const deps: ApplyChatMessageDependencies = {
    findOutcome: async (key) => called("findOutcome", ok(options.stored && key === messageId ? options.stored : store.outcomes.has(key) ? { outcomes: store.outcomes.get(key)!, noticeSentAt: null } : null)),
    findSourceMessage: async () => called("findSourceMessage", ok(options.message === undefined ? photoMessage() : options.message)),
    findChatOrderTarget: async () => called("findChatOrderTarget", ok(target.kind === "open" ? { ...target, order: store.orders.get(target.order.id)! } : target)),
    findChatOrdersOpenedSince: async (_chat, since) => { openedSinceQueries.push(since); return called("findChatOrdersOpenedSince", ok(options.openedSince ?? [])); },
    findChatPendings: async () => called("findChatPendings", ok(store.pendings)),
    findChatPendingsForUpdate: async () => called("findChatPendingsForUpdate", ok(store.pendings)),
    saveChatPendings: async (_chat, set) => { calls.push("saveChatPendings"); pendingSaves.push(set); store.pendings = set; return ok(null); },
    readImage: async () => called("readImage", ok({ bytes: new Uint8Array([1]), contentType: "image/jpeg" })),
    identifyProductsInImage: async (_image, signal) => { identifySignals.push(signal); return called("identifyProductsInImage", ok(options.identification ?? visual(productCap))); },
    findProductsForReading: async (ids) => { readingIds.push([...ids]); return called("findProductsForReading", ok(catalog.filter((product) => ids.includes(product.productId)))); },
    findMessageCandidates: async (text) => { candidateQueries.push(text); return called("findMessageCandidates", ok({ unavailableProductIds: [], ...(options.candidates ?? { productIds: [], matchCount: 0, durationMs: 4, timedOut: false }) })); },
    catalogSearchReadiness: async () => called("catalogSearchReadiness", ok(options.readiness ?? "ready")),
    readChatMessage: reader === null ? null : async (context) => {
      calls.push("readChatMessage");
      contexts.push(context);
      const answered = reader(context);
      return "code" in answered ? err(answered) : ok({ answer: answered, usage: zeroUsage });
    },
    transaction: async (_company, work) => {
      calls.push("transaction");
      const snapshot = structuredClone({ orders: store.orders, pendings: store.pendings, customers: store.customers, messages: store.messages, outcomes: store.outcomes });
      const result = await work();
      if (!result.success) Object.assign(store, snapshot);
      return result;
    },
    lockContact: async () => called("lockContact", ok(null)),
    ensureCustomerForContact: async () => { calls.push("ensureCustomerForContact"); store.customers.add("customer"); return ok({ customerId: id(400) as CustomerId }); },
    findChatOrderTargetForUpdate: async () => called("findChatOrderTargetForUpdate", ok(target.kind === "open" ? { ...target, order: store.orders.get(target.order.id)! } : target)),
    allocateNumber: async () => called("allocateNumber", ok(1008 as OrderNumber)),
    saveNewOrder: async (order) => { calls.push("saveNewOrder"); store.orders.set(order.id, order); return ok(null); },
    saveItemChanges: async (order) => { calls.push("saveItemChanges"); store.orders.set(order.id, order); return ok(null); },
    recordOrderMessage: async (orderId, key) => { calls.push("recordOrderMessage"); store.messages.set(key, orderId); return ok(null); },
    recordOutcome: async ({ messageId: key, outcomes }) => { calls.push("recordOutcome"); store.outcomes.set(key, outcomes); return ok(null); },
    newOrderId: () => id(500) as OrderId,
    newItemId: (() => { let counter = 300; return () => id(counter++) as OrderItemId; })(),
    newPendingId: (() => { let counter = 700; return () => id(counter++) as ChatPendingId; })(),
    clock: () => at,
    limits: { maxItemQuantity: 99 as PositiveInteger, pendingTtlMs: 7 * 86_400_000, maxReaderProducts: 24, maxReaderItems: 40, maxReaderTextChars: 2000, ...options.limits },
    fitReadingContext: (context) => { const fitted = options.fit ? options.fit(context) : { context, countedInputTokens: 1000, droppedProducts: 0 }; return "code" in fitted ? err(fitted) : ok(fitted); },
    photoStageTimeoutMs: options.photoStageTimeoutMs ?? 40_000,
    ...options.overrides,
  };
  const controller = new AbortController();
  return { calls, contexts, readingIds, candidateQueries, openedSinceQueries, pendingSaves, identifySignals, store, controller, deps, run: () => applyChatMessage({ companyId, messageId }, deps, controller.signal) };
}

const quantityOf = (store: Store, variantId: VariantId) => [...store.orders.values()].flatMap((order) => order.items).find((item) => item.variantId === variantId)?.quantity;
const succeeded = async <T,>(result: Promise<Result<T, { code: string; message: string }>>) => { const done = await result; if (!done.success) throw new Error(done.error.code); return done.data; };
const outcomeKinds = (store: Store) => [...store.outcomes.values()].flatMap((outcomes) => outcomes.map(({ kind }) => kind));

describe("applyChatMessage: photos", () => {
  test("adds the photo's only variant without calling the reader", async () => {
    const h = harness({ identification: visual(productCap) });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", createdOrder: true, noticeDue: false, outcomes: [{ kind: "added", variantId: cap.variantId, quantity: 1,
      identification: { method: "visual", productId: productCap, confidence: 0.92 } }], trace: { readerCalls: 0, answer: "fixed" } });
    expect(h.contexts).toHaveLength(0);
    expect(quantityOf(h.store, cap.variantId)).toBe(1);
    expect(h.calls).not.toContain("catalogSearchReadiness");
  });

  test("passes the attempt's signal to the photo identification", async () => {
    const h = harness({ identification: visual(productCap) });
    await h.run();
    expect(h.identifySignals).toHaveLength(1);
    expect(h.identifySignals[0]!.aborted).toBe(false);
    h.controller.abort();
    expect(h.identifySignals[0]!.aborted).toBe(true);
  });

  test("creates a pending and a variant-missing notice for a photo without size", async () => {
    const h = harness({ identification: visual(productPolo) });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", orderId: null, noticeDue: true, pendingsBefore: 0, pendingsAfter: 1,
      outcomes: [{ kind: "pending_created" }, { kind: "variant_missing", productId: productPolo, identification: { method: "visual" } }] });
    expect(h.store.orders.size).toBe(0);
    expect(h.store.pendings.pendings).toMatchObject([{ subject: { kind: "variant", productId: productPolo }, quantity: 1 }]);
    expect(h.calls).not.toContain("ensureCustomerForContact");
  });

  test("drafts a pending for a photo with a caption and no reader, and sends no caption-not-applied", async () => {
    const h = harness({ message: photoMessage({ caption: "2 en talla M" }), identification: visual(productPolo), reader: null });
    const applied = await succeeded(h.run());
    expect(applied).toMatchObject({ kind: "applied", noticeDue: true, trace: { readerCalls: 0, answer: "fixed" } });
    expect(outcomeKinds(h.store)).not.toContain("caption_not_applied");
    expect(h.store.pendings.pendings).toHaveLength(1);
  });

  test("adds a photo's QR variant and keeps the caption ignored without the reader", async () => {
    const h = harness({ message: photoMessage({ caption: "dos de estos" }), identification: { kind: "found", method: "qr", items: [{ ...poloM, productId: productPolo }], unknownCodes: [] }, reader: null });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: poloM.variantId }], noticeDue: false });
    expect(outcomeKinds(h.store)).not.toContain("caption_not_applied");
  });

  test("reads the caption of a product photo and applies what it asks", async () => {
    const h = harness({ message: photoMessage({ caption: "2 en talla M" }), identification: visual(productPolo),
      reader: (context) => actions(add(context, productPolo, [{ name: "Talla", value: "M" }], 2)) });
    expect(await succeeded(h.run())).toMatchObject({ trace: { readerCalls: 1, answer: "actions", actionKinds: ["add"], usage: zeroUsage }, noticeDue: false });
    expect(quantityOf(h.store, poloM.variantId)).toBe(2);
    expect(h.contexts[0]).toMatchObject({ kind: "photo_product", text: "2 en talla M" });
  });

  test("tells the seller about a doubted caption by adding the photo's product", async () => {
    const h = harness({ message: photoMessage({ caption: "no sé" }), identification: visual(productCap), reader: () => ({ kind: "doubt" }) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: cap.variantId }, { kind: "caption_not_applied", productId: productCap }], noticeDue: true });
  });

  test("applies the fixed answer with a caption notice for a caption over the text limit", async () => {
    const h = harness({ message: photoMessage({ caption: "x".repeat(30) }), identification: visual(productCap), limits: { maxReaderTextChars: 20 } });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added" }, { kind: "caption_not_applied", productId: productCap }], trace: { readerCalls: 0 } });
    expect(h.contexts).toHaveLength(0);
  });

  test("records not identified for a photo without a match even when it has a caption", async () => {
    const h = harness({ message: photoMessage({ caption: "2 de estos en talla M" }), identification: { kind: "not_found", reason: "no_visual_match", topDistance: 0.5 } });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", source: "photo", identification: null, silent: false }], noticeDue: true });
    expect(h.contexts).toHaveLength(0);
  });

  test("keeps a photo miss silent while the catalog cannot recognize photos", async () => {
    const h = harness({ identification: { kind: "not_found", reason: "no_visual_match", topDistance: 0.5 }, readiness: "no_searchable_photos" });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", silent: true }], noticeDue: false });
  });

  test("records no intent and no notice for a photo that does not show a product", async () => {
    const h = harness({ identification: notProduct });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "no_intent" }], noticeDue: false });
    expect(h.contexts).toHaveLength(0);
  });

  test("runs no candidate query for a non-product photo with a caption", async () => {
    const h = harness({ message: photoMessage({ caption: "y agrégame una gorra negra" }), identification: notProduct,
      reader: () => actions({ kind: "add", product: { kind: "not_in_catalog" }, attributes: [], quantity: null, price: null }) });
    const applied = await succeeded(h.run());
    expect(h.candidateQueries).toEqual([]);
    expect(h.readingIds).toEqual([]);
    expect(applied).toMatchObject({ outcomes: [{ kind: "image_with_request" }] });
  });

  test("makes no reader call for a non-product photo without a caption", async () => {
    const h = harness({ identification: notProduct });
    await h.run();
    expect(h.calls).not.toContain("readChatMessage");
  });

  test("reports a product that left the catalog since it was matched as not identified", async () => {
    const h = harness({ identification: visual(productCap), catalog: [polo] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", source: "photo", identification: { method: "visual", productId: productCap } }], noticeDue: true });
    expect(h.store.orders.size).toBe(0);
  });
});

describe("applyChatMessage: texts and pendings", () => {
  test("completes the pending from «en talla M» on the next message without a notice", async () => {
    const h = harness({ message: textMessage("en talla M"), pendings: pendingSet(pendingOf(20)),
      reader: (context) => actions({ kind: "complete_pending", pending: context.pendings[0]!.ref, product: null, attributes: [{ name: "Talla", value: "M" }], quantity: null, price: null }) });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", createdOrder: true, noticeDue: false, pendingsBefore: 1, pendingsAfter: 0,
      outcomes: expect.arrayContaining([{ kind: "pending_completed", pendingId: id(20) }]) });
    expect(quantityOf(h.store, poloM.variantId)).toBe(1);
    expect(h.store.pendings.pendings).toEqual([]);
    expect(h.calls).toContain("ensureCustomerForContact");
  });

  test("never shows the reader a pending whose order closed", async () => {
    const closed = pendingOf(20, { order: { orderId: id(9) as OrderId, attachedAt: hourBefore } });
    const h = harness({ message: textMessage("en talla M"), pendings: pendingSet(closed), target: { kind: "closed", orderId: id(9) as OrderId, number: 1007 as OrderNumber } });
    const applied = await succeeded(h.run());
    expect(h.contexts[0]!.pendings).toEqual([]);
    expect(applied).toMatchObject({ outcomes: [{ kind: "pending_ended", pendingId: id(20), reason: "order_closed" }, { kind: "no_intent" }], pendingsBefore: 1, pendingsAfter: 0 });
    expect(h.store.pendings.pendings).toEqual([]);
  });

  test("never shows the reader an expired pending", async () => {
    const old = pendingOf(20, { lastChangedAt: new Date(at.getTime() - 8 * 86_400_000) });
    const h = harness({ message: textMessage("hola"), pendings: pendingSet(old) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "pending_ended", reason: "expired" }, { kind: "no_intent" }] });
    expect(h.contexts[0]!.pendings).toEqual([]);
  });

  test("reads the chat orders opened since only when an orderless pending exists", async () => {
    const without = harness({ message: textMessage("hola") });
    await without.run();
    expect(without.calls).not.toContain("findChatOrdersOpenedSince");
    const attached = harness({ message: textMessage("hola"), target: openTarget(), pendings: pendingSet(pendingOf(20, { order: { orderId: id(9) as OrderId, attachedAt: hourBefore } })) });
    await attached.run();
    expect(attached.calls).not.toContain("findChatOrdersOpenedSince");
    const orderless = harness({ message: textMessage("hola"), pendings: pendingSet(pendingOf(20, { lastChangedAt: hourBefore }), pendingOf(21, { lastChangedAt: new Date(hourBefore.getTime() - 60_000) })) });
    await orderless.run();
    expect(orderless.openedSinceQueries).toEqual([new Date(hourBefore.getTime() - 60_000), new Date(hourBefore.getTime() - 60_000)]);
  });

  test("keeps the shown and pendings' products within the ceiling and cuts candidates first", async () => {
    const extra = [12, 13, 14].map((n) => forReading(id(n) as ProductId, `Extra ${n}`, [variant(n, `Extra ${n}`, {})]));
    const h = harness({ message: textMessage("quiero algo"), target: openTarget(), pendings: pendingSet(pendingOf(20)), catalog: [polo, gorra, ...extra],
      candidates: { productIds: extra.map((product) => product.productId), matchCount: 3, durationMs: 5, timedOut: false }, limits: { maxReaderProducts: 3 } });
    const applied = await succeeded(h.run());
    expect(h.readingIds).toEqual([[productPolo, productCap, extra[0]!.productId]]);
    expect(h.contexts[0]).toMatchObject({ truncated: true });
    expect(applied).toMatchObject({ trace: { contextTruncated: true, candidateMatchCount: 3, candidateMs: 5, candidatesTimedOut: false } });
    const photo = harness({ identification: visual(productPolo), message: photoMessage({ caption: "dos" }), target: openTarget(), limits: { maxReaderProducts: 1 } });
    await photo.run();
    expect(photo.readingIds).toEqual([[productPolo]]);
  });

  test("lists at least one candidate of each of ten doubtful pendings within the ceiling", async () => {
    const first = Array.from({ length: 10 }, (_, n) => forReading(id(200 + n) as ProductId, `A${n}`, [variant(200 + n, `A${n}`, {})]));
    const second = Array.from({ length: 10 }, (_, n) => forReading(id(300 + n) as ProductId, `B${n}`, [variant(300 + n, `B${n}`, {})]));
    const pendings = first.map((product, n): ChatPending => pendingOf(20 + n, { subject: { kind: "product", candidates: [product.productId, second[n]!.productId] } }));
    const h = harness({ message: textMessage("el primero"), pendings: pendingSet(...pendings), catalog: [polo, gorra, ...first, ...second], limits: { maxReaderProducts: 12 } });
    await succeeded(h.run());
    const requested = h.readingIds[0]!;
    expect(requested).toHaveLength(12);
    for (const product of first) expect(requested).toContain(product.productId);
    expect(h.contexts[0]!.pendings).toHaveLength(10);
  });

  test("reports text too long without calling the reader", async () => {
    const h = harness({ message: textMessage("x".repeat(30)), limits: { maxReaderTextChars: 20 } });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "invalid_action", orderId: null, reason: "text_too_long" }], noticeDue: true, trace: { readerCalls: 0 } });
    expect(h.calls).not.toContain("readChatMessage");
    expect(h.calls).not.toContain("findMessageCandidates");
  });

  test("skips a text without the reader and ignores a caption", async () => {
    const text = harness({ message: textMessage("hola"), reader: null });
    expect(await succeeded(text.run())).toEqual({ kind: "skipped", reason: "reader_disabled" });
    expect(text.calls).not.toContain("transaction");
    const photo = harness({ message: photoMessage({ caption: "2 en talla M" }), identification: notProduct, reader: null });
    expect(await succeeded(photo.run())).toMatchObject({ outcomes: [{ kind: "no_intent" }] });
  });

  test("skips an outgoing message and an empty text", async () => {
    expect(await succeeded(harness({ message: textMessage("hola", { direction: "outgoing" }) }).run())).toEqual({ kind: "skipped", reason: "outgoing_message" });
    expect(await succeeded(harness({ message: textMessage("   ") }).run())).toEqual({ kind: "skipped", reason: "empty_text" });
  });

  test("adds the product the reader names for a text and finds it through the candidates", async () => {
    const h = harness({ message: textMessage("una gorra"), candidates: { productIds: [productCap], matchCount: 1, durationMs: 3, timedOut: false },
      reader: (context) => actions(add(context, productCap)) });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", createdOrder: true, noticeDue: false, outcomes: [{ kind: "added", variantId: cap.variantId }] });
    expect(h.candidateQueries).toEqual(["una gorra"]);
  });

  test("reads the text without candidates when their search times out and marks the context truncated", async () => {
    const h = harness({ message: textMessage("una gorra"), candidates: { productIds: [], matchCount: 0, durationMs: 1000, timedOut: true } });
    expect(await succeeded(h.run())).toMatchObject({ trace: { candidatesTimedOut: true, contextTruncated: true } });
  });

  test("retries when the reader is unavailable and writes nothing", async () => {
    const h = harness({ message: textMessage("una gorra"), reader: () => ({ code: "AI_PROVIDER_UNAVAILABLE", message: "down" }) });
    const done = await h.run();
    expect(done).toMatchObject({ success: false, error: { code: "AI_PROVIDER_UNAVAILABLE" } });
    if (!done.success) expect(isRetryableChatMessageError(done.error)).toBe(true);
    expect(h.calls).not.toContain("transaction");
    expect(h.store.outcomes.size).toBe(0);
  });

  test("records failed for an invalid reader answer", async () => {
    const h = harness({ message: textMessage("una gorra"), reader: () => ({ code: "INVALID_AI_RESPONSE", message: "bad" }) });
    const done = await h.run();
    expect(done).toMatchObject({ success: false, error: { code: "INVALID_AI_RESPONSE" } });
    if (!done.success) expect(isRetryableChatMessageError(done.error)).toBe(false);
  });

  test("records failed for invalid stored product data without retrying", async () => {
    const h = harness({ message: textMessage("una gorra"), overrides: { findProductsForReading: async () => err({ code: "INVALID_STORED_DATA" as const, message: "bad row" }) },
      candidates: { productIds: [productCap], matchCount: 1, durationMs: 3, timedOut: false } });
    const done = await h.run();
    expect(done).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    if (!done.success) expect(isRetryableChatMessageError(done.error)).toBe(false);
  });

  test("ends as already processed when another run recorded the message first", async () => {
    const stored: StoredChatMessageOutcome = { outcomes: [{ kind: "no_intent" }], noticeSentAt: null };
    let reads = 0;
    const h = harness({ identification: visual(productCap), overrides: { findOutcome: async () => ok(reads++ < 1 ? null : stored) } });
    expect(await succeeded(h.run())).toEqual({ kind: "already_processed", noticeDue: false });
    expect(h.store.orders.size).toBe(0);
  });

  test("ends as already processed without any work for a message with an outcome", async () => {
    const h = harness({ stored: { outcomes: [{ kind: "unnamed_add" }], noticeSentAt: null } });
    expect(await succeeded(h.run())).toEqual({ kind: "already_processed", noticeDue: true });
    expect(h.calls).toEqual(["findOutcome"]);
  });

  test("rolls back the order and the pendings together when saving the outcome fails", async () => {
    const h = harness({ message: textMessage("en talla M"), pendings: pendingSet(pendingOf(20)),
      reader: (context) => actions({ kind: "complete_pending", pending: context.pendings[0]!.ref, product: null, attributes: [{ name: "Talla", value: "M" }], quantity: null, price: null }),
      overrides: { recordOutcome: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }) } });
    expect(await h.run()).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    expect(h.store.orders.size).toBe(0);
    expect(h.store.pendings.pendings).toHaveLength(1);
  });

  test("writes the pendings row only when the set changed", async () => {
    const unchanged = harness({ message: textMessage("hola"), pendings: pendingSet() });
    await unchanged.run();
    expect(unchanged.pendingSaves).toEqual([]);
    const changed = harness({ identification: visual(productPolo) });
    await changed.run();
    expect(changed.pendingSaves).toHaveLength(1);
    const kept = harness({ message: textMessage("hola"), pendings: pendingSet(pendingOf(20)) });
    await kept.run();
    expect(kept.pendingSaves).toEqual([]);
  });

  test("keeps a text miss silent in a company without active products", async () => {
    const h = harness({ message: textMessage("quiero zapatillas"), readiness: "no_active_products",
      reader: () => actions({ kind: "add", product: { kind: "not_in_catalog" }, attributes: [], quantity: null, price: null }) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", source: "text", silent: true }], noticeDue: false });
  });

  test("tells the seller about a text miss in a company with products", async () => {
    const h = harness({ message: textMessage("quiero zapatillas"),
      reader: () => actions({ kind: "add", product: { kind: "not_in_catalog" }, attributes: [], quantity: null, price: null }) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", source: "text", silent: false }], noticeDue: true });
  });

  test("does not call the reader, the products or the candidates inside the transaction", async () => {
    const h = harness({ message: textMessage("una gorra"), candidates: { productIds: [productCap], matchCount: 1, durationMs: 3, timedOut: false }, reader: (context) => actions(add(context, productCap)) });
    await h.run();
    const inside = h.calls.slice(h.calls.indexOf("transaction"));
    for (const name of ["readChatMessage", "findProductsForReading", "findMessageCandidates", "findChatOrderTarget", "findChatPendings"]) expect(inside).not.toContain(name);
    expect(inside.slice(0, 5)).toEqual(["transaction", "lockContact", "findOutcome", "findChatOrderTargetForUpdate", "findChatPendingsForUpdate"]);
  });

  test("returns a deadline error before calling the reader when the attempt has no time left", async () => {
    const h = harness({ message: textMessage("una gorra") });
    h.controller.abort();
    expect(await h.run()).toMatchObject({ success: false, error: { code: "DEADLINE_EXCEEDED" } });
    expect(h.calls).not.toContain("readChatMessage");
  });
});

const unnamedSet = (quantity: number): ReaderAction => ({ kind: "change_quantity", target: { kind: "unnamed" }, mode: "set", quantity });
const remembering = (left: ChatPendings["lastIncomingPhoto"], ...pendings: ChatPending[]): ChatPendings => ({ ...pendingSet(...pendings), lastIncomingPhoto: left });
const tooLarge = (): ContextTooLarge => ({ code: "CONTEXT_TOO_LARGE", message: "Too large", countedInputTokens: 25_001 });

describe("applyChatMessage: skipped texts and the photo memory", () => {
  test("a text with only emoji or punctuation is skipped without a reader call or a memory change", async () => {
    for (const text of ["👍", "...", " 😍😍 ", "¿?"]) {
      const h = harness({ message: textMessage(text), pendings: remembering({ left: null }) });
      expect(await succeeded(h.run())).toEqual({ kind: "skipped", reason: "empty_text" });
      expect(h.calls).not.toContain("readChatMessage");
      expect(h.calls).not.toContain("transaction");
      expect(h.store.pendings.lastIncomingPhoto).toEqual({ left: null });
    }
    const digits = harness({ message: textMessage("2") });
    expect(await succeeded(digits.run())).toMatchObject({ kind: "applied" });
  });

  test("a caption with only emoji counts as no caption and makes no reader call", async () => {
    const h = harness({ message: photoMessage({ caption: "😍😍" }), identification: visual(productCap) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: cap.variantId }], noticeDue: false, trace: { readerCalls: 0, answer: "fixed" } });
    expect(h.calls).not.toContain("readChatMessage");
    expect(h.calls).not.toContain("findMessageCandidates");
  });

  test("a caption with only emoji on a photo of the polo leaves a pending and «Falta la variante» without a reader call", async () => {
    const h = harness({ message: photoMessage({ caption: "😍😍" }), identification: visual(productPolo) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "pending_created" }, { kind: "variant_missing", productId: productPolo }], noticeDue: true, orderId: null,
      pendingsAfter: 1, trace: { readerCalls: 0, answer: "fixed" } });
    expect(h.calls).not.toContain("readChatMessage");
    expect(h.store.orders.size).toBe(0);
  });

  test("a caption read as no intent adds the photo's product to a new order with its price and no notice", async () => {
    const h = harness({ message: photoMessage({ caption: "me encanta" }), identification: visual(productCap), reader: () => ({ kind: "no_intent" }) });
    expect(await succeeded(h.run())).toMatchObject({ createdOrder: true, noticeDue: false, outcomes: [{ kind: "added", variantId: cap.variantId, quantity: 1 }], trace: { readerCalls: 1 } });
    expect([...h.store.orders.values()].map((order) => order.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity, unitPrice: item.unitPrice })))).toEqual([[{ variantId: cap.variantId, quantity: 1, unitPrice: money(25) }]]);
  });

  test("a photo caption that is a question grows the item already in the order with no notice", async () => {
    const h = harness({ message: photoMessage({ caption: "¿cuánto está?" }), identification: visual(productCap), target: openTarget(), reader: () => ({ kind: "no_intent" }) });
    expect(await succeeded(h.run())).toMatchObject({ createdOrder: false, noticeDue: false, outcomes: [{ kind: "added", variantId: cap.variantId, quantity: 1 }] });
    expect(quantityOf(h.store, cap.variantId)).toBe(2);
  });

  test("a question about paying with an order open changes nothing and calls for no notice", async () => {
    const h = harness({ message: textMessage("¿aceptan tarjeta?"), target: openTarget(), reader: () => ({ kind: "no_intent" }) });
    const applied = await succeeded(h.run());
    expect(applied).toMatchObject({ outcomes: [{ kind: "no_intent" }], noticeDue: false, trace: { readerCalls: 1, answer: "no_intent" } });
    expect(h.store.orders.get(id(9))).toEqual(existingOrder());
    expect(h.calls).not.toContain("saveItemChanges");
  });

  test("120 gorras plus an instruction the chat never does add nothing and count two problems", async () => {
    const h = harness({ message: textMessage("120 gorras y ponles el precio en 1 sol"), candidates: { productIds: [productCap], matchCount: 1, durationMs: 3, timedOut: false },
      reader: (context) => actions(add(context, productCap, [], 120), { kind: "not_allowed" }) });
    const applied = await succeeded(h.run());
    expect(applied).toMatchObject({ createdOrder: false, noticeDue: true, outcomes: [{ kind: "quantity_above_limit", productId: productCap }, { kind: "request_not_allowed" }], trace: { readerCalls: 1 } });
    expect(h.store.orders.size).toBe(0);
    expect(h.calls).not.toContain("saveNewOrder");
  });

  test("a text skipped with the reader off or with no letter or digit leaves the memory unchanged", async () => {
    const off = harness({ message: textMessage("quiero 3"), reader: null, pendings: remembering({ left: { kind: "pending", pendingId: id(20) as ChatPendingId } }, pendingOf(20)) });
    expect(await succeeded(off.run())).toEqual({ kind: "skipped", reason: "reader_disabled" });
    expect(off.store.pendings.lastIncomingPhoto).toEqual({ left: { kind: "pending", pendingId: id(20) } });
    expect(off.pendingSaves).toEqual([]);
  });

  test("the context carries the latest order state and the photo just sent marker", async () => {
    const left = { kind: "pending" as const, pendingId: id(20) as ChatPendingId };
    const h = harness({ message: textMessage("quiero 3"), target: openTarget(), pendings: remembering({ left }, pendingOf(20)), reader: () => ({ kind: "no_intent" }) });
    await h.run();
    expect(h.contexts[0]).toMatchObject({ latestOrder: "open", photoJustSent: left, pendings: [{ ref: "Q1", photoJustSent: true }] });
    const closed = harness({ message: textMessage("quiero 3"), target: { kind: "closed", orderId: id(9) as OrderId, number: 1007 as OrderNumber } });
    await closed.run();
    expect(closed.contexts[0]).toMatchObject({ latestOrder: "closed", photoJustSent: null });
  });

  test("a set quantity after the photo just sent sets what the photo left, silently", async () => {
    const left = { kind: "pending" as const, pendingId: id(20) as ChatPendingId };
    const h = harness({ message: textMessage("quiero 3 de esos"), pendings: remembering({ left }, pendingOf(20)), reader: () => actions(unnamedSet(3)) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "pending_updated", pendingId: id(20) }], noticeDue: false });
    expect(h.store.pendings.pendings[0]?.quantity).toBe(3);
    expect(h.store.pendings.lastIncomingPhoto).toBeNull();
  });

  test("a photo transaction saves the next memory and a text transaction clears it", async () => {
    const photo = harness({ identification: visual(productPolo) });
    await photo.run();
    expect(photo.store.pendings.lastIncomingPhoto).toEqual({ left: { kind: "pending", pendingId: photo.store.pendings.pendings[0]!.id } });
    const text = harness({ message: textMessage("hola"), pendings: remembering({ left: { kind: "pending", pendingId: id(20) as ChatPendingId } }, pendingOf(20)) });
    await text.run();
    expect(text.store.pendings.lastIncomingPhoto).toBeNull();
    expect(text.pendingSaves).toHaveLength(1);
  });

  test("a photo right after another photo remembers no leftover", async () => {
    const h = harness({ identification: visual(productPolo), pendings: remembering({ left: null }) });
    await h.run();
    expect(h.store.pendings.lastIncomingPhoto).toEqual({ left: null });
  });

  test("a photo with the caption «quiero 3» leaves the previous photo's pending alone and gives its own product the quantity", async () => {
    const left = { kind: "pending" as const, pendingId: id(20) as ChatPendingId };
    const h = harness({ message: photoMessage({ caption: "quiero 3" }), identification: visual(productCap), pendings: remembering({ left }, pendingOf(20)), reader: () => actions(unnamedSet(3)) });
    await h.run();
    expect(h.contexts[0]!.photoJustSent).toBeNull();
    expect(h.store.pendings.pendings).toMatchObject([{ id: id(20), quantity: 1 }]);
    expect([...h.store.orders.values()].flatMap((order) => order.items.map(({ variantId, quantity }) => [variantId, quantity]))).toEqual([[cap.variantId, 3]]);
  });

  test("a text answered text_too_long or context_too_large clears the memory", async () => {
    const left = { kind: "pending" as const, pendingId: id(20) as ChatPendingId };
    const long = harness({ message: textMessage("x".repeat(30)), limits: { maxReaderTextChars: 20 }, pendings: remembering({ left }, pendingOf(20)) });
    expect(await succeeded(long.run())).toMatchObject({ outcomes: [{ kind: "invalid_action", reason: "text_too_long" }] });
    expect(long.store.pendings.lastIncomingPhoto).toBeNull();
    const big = harness({ message: textMessage("quiero 3"), fit: tooLarge, pendings: remembering({ left }, pendingOf(20)) });
    expect(await succeeded(big.run())).toMatchObject({ outcomes: [{ kind: "invalid_action", reason: "context_too_large" }], noticeDue: true });
    expect(big.store.pendings.lastIncomingPhoto).toBeNull();
  });
});

describe("applyChatMessage: input-token budget", () => {
  test("a context over the input-token budget gets context_too_large without a reader call", async () => {
    const h = harness({ message: textMessage("quiero 3"), fit: tooLarge });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "invalid_action", reason: "context_too_large" }], trace: { readerCalls: 0, countedInputTokens: null } });
    expect(h.calls).not.toContain("readChatMessage");
    const photo = harness({ message: photoMessage({ caption: "y una gorra" }), identification: notProduct, fit: tooLarge });
    expect(await succeeded(photo.run())).toMatchObject({ outcomes: [{ kind: "invalid_action", reason: "context_too_large" }] });
    expect(photo.calls).not.toContain("readChatMessage");
  });

  test("the reader and the check receive the same fitted context", async () => {
    const dropped = (context: ChatReadingContext) => ({ context: { ...context, products: context.products.filter(({ productId }) => productId !== productPolo), truncated: true }, countedInputTokens: 777, droppedProducts: 1 });
    const h = harness({ message: textMessage("un polo y una gorra"), candidates: { productIds: [productPolo, productCap], matchCount: 2, durationMs: 3, timedOut: false }, fit: dropped,
      reader: (context) => actions({ kind: "add", product: { kind: "ref", ref: "P1" }, attributes: [], quantity: null, price: null }, add(context, productCap)) });
    const done = await succeeded(h.run());
    expect(h.contexts[0]!.products.map(({ productId }) => productId)).toEqual([productCap]);
    // "P1" is the Gorra in the fitted context: the check resolved it against the same context the reader saw.
    expect(done).toMatchObject({ trace: { countedInputTokens: 777, droppedForBudget: 1, contextTruncated: true } });
    expect(h.store.orders.size).toBe(1);
  });

  test("not-sellable candidates are given after the sellable ones within the ceiling", async () => {
    const unavailable = forReading(id(12) as ProductId, "Casaca vieja", [], false);
    const h = harness({ message: textMessage("la casaca vieja o una gorra"), catalog: [polo, gorra, unavailable],
      candidates: { productIds: [productCap], unavailableProductIds: [id(12) as ProductId], matchCount: 1, durationMs: 3, timedOut: false } });
    await h.run();
    expect(h.readingIds[0]).toEqual([productCap, id(12)]);
    expect(h.contexts[0]!.products.map(({ productId, sellable }) => [productId, sellable])).toEqual([[productCap, true], [id(12), false]]);
    const ceiling = harness({ message: textMessage("la casaca vieja o una gorra"), catalog: [polo, gorra, unavailable], limits: { maxReaderProducts: 1 },
      candidates: { productIds: [productCap], unavailableProductIds: [id(12) as ProductId], matchCount: 1, durationMs: 3, timedOut: false } });
    await ceiling.run();
    expect(ceiling.readingIds[0]).toEqual([productCap]);
  });

  test("a product photo whose caption does not fit the budget gets the fixed answer with a caption doubt and no reader call, and remembers what it left", async () => {
    const h = harness({ message: photoMessage({ caption: "quiero 3" }), identification: visual(productCap), fit: tooLarge });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: cap.variantId }, { kind: "caption_not_applied", productId: productCap }], noticeDue: true, trace: { readerCalls: 0, answer: "fixed" } });
    expect(h.calls).not.toContain("readChatMessage");
    expect([...h.store.orders.values()][0]!.items.map(({ quantity }) => quantity)).toEqual([1]);
    expect(h.store.pendings.lastIncomingPhoto).toMatchObject({ left: { kind: "item", variantId: cap.variantId, quantity: 1 } });
  });
});

describe("applyChatMessage: photo-stage deadline", () => {
  test("the image read and the identification receive a signal that ends at the photo-stage deadline", async () => {
    const seen: AbortSignal[] = [];
    const h = harness({ photoStageTimeoutMs: 20, overrides: {
      readImage: async (_id, signal) => { seen.push(signal); return ok({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }); },
      identifyProductsInImage: async (_image, signal) => { seen.push(signal); return ok(visual(productCap)); } } });
    await h.run();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).not.toBe(h.controller.signal);
    expect(seen[0]!.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen[0]!.aborted).toBe(true);
    expect(h.controller.signal.aborted).toBe(false);
  });

  test("a stage cut by the photo-stage deadline is a deadline error, not a storage or embedder failure", async () => {
    for (const code of ["IMAGE_STORAGE_UNAVAILABLE", "EMBEDDER_UNAVAILABLE"] as const) {
      const h = harness({ photoStageTimeoutMs: 1, overrides: {
        identifyProductsInImage: async (_image, signal) => { await new Promise((resolve) => setTimeout(resolve, 15)); expect(signal.aborted).toBe(true); return err({ code, message: "aborted" }); },
        readImage: async () => ok({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }) } });
      expect(await h.run()).toMatchObject({ success: false, error: { code: "DEADLINE_EXCEEDED" } });
      expect(h.calls).not.toContain("readChatMessage");
      expect(h.calls).not.toContain("transaction");
    }
    const failure = harness({ overrides: { identifyProductsInImage: async () => err({ code: "EMBEDDER_UNAVAILABLE", message: "down" }) } });
    expect(await failure.run()).toMatchObject({ success: false, error: { code: "EMBEDDER_UNAVAILABLE" } });
  });
});
