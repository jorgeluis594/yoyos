import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { addMessageProductsToOrder, type AddMessageProductsDependencies, type AddMessageProductsError, type OrderSourceMessage, type OrderChatSource,
  type MessageCustomer } from "@core/src/features/orders/application/add-message-products-to-order";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { MatchConfidence, VariantQrCode } from "@core/src/features/products/domain/image-identification";
import type { ReadQrCodes } from "@core/src/features/products/infrastructure/qr-code-reader";
import { identifyProductsInImage, type ImageIdentification } from "@core/src/features/products/application/identify-products-in-image";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId, ImageId } from "@core/src/features/products/domain/product";
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
const variant = (n: number, amount = 10) => ({ variantId: id(100 + n) as VariantId, productName: `Variant ${n}`, variantAttributes: {}, sku: null,
  unitPrice: money(amount), qrCode: id(200 + n) as VariantQrCode });
const qr = (n: number) => id(200 + n);
const message = (overrides: Partial<OrderSourceMessage> = {}): OrderSourceMessage => ({ id: messageId, companyId, chatId, contactId, direction: "incoming",
  uploadedByUserId: sellerId, imageId: id(5) as ImageId, ...overrides });
const existingOrder = (overrides: Partial<OrderAggregate> = {}): OrderAggregate => ({
  number: 1007 as OrderNumber, id: id(9) as OrderId, companyId, sellerId, chatId, buyer: { contactId, name: null, phone: null },
  fromCatalog: false, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false,
  items: [{ id: id(10) as OrderItemId, variantId: variant(1).variantId, productName: "Variant 1", variantAttributes: {}, sku: null,
    quantity: 1 as PositiveInteger, unitPrice: money(10), subtotal: money(10) }],
  payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false,
  itemsTotal: money(10), deliveryCost: money(0), deliveryCharge: money(0), total: money(10), ...overrides });

type State = { customers: Map<string, CustomerId>; orders: Map<string, OrderAggregate>; processed: Map<string, OrderId>; sources: OrderChatSource[]; calls: string[] };

/** In-memory ports; `transaction` snapshots the state and restores it when the work fails. */
function harness(options: Readonly<{ message?: OrderSourceMessage | null; decoded?: readonly string[]; variants?: ReturnType<typeof variant>[];
  readQrCodes?: ReadQrCodes; orders?: OrderAggregate[]; processed?: [string, OrderId][]; overrides?: Partial<AddMessageProductsDependencies> }> = {}) {
  const state: State = { customers: new Map(), orders: new Map((options.orders ?? []).map((order) => [order.id, order])),
    processed: new Map(options.processed ?? []), sources: [], calls: [] };
  const called = <T>(name: string, value: T): T => { state.calls.push(name); return value; };
  let counter = 300;
  const deps: AddMessageProductsDependencies = {
    findSourceMessage: async () => called("findSourceMessage", ok(options.message === undefined ? message() : options.message)),
    readImage: async () => called("readImage", ok({ bytes: new Uint8Array([1]), contentType: "image/jpeg" })),
    // The real cascade over fake QR ports; visual search stays disabled unless a test replaces identifyProducts.
    identifyProducts: (image) => identifyProductsInImage(image, { visual: null,
      readQrCodes: async (bytes) => called("readQrCodes", options.readQrCodes ? await options.readQrCodes(bytes) : ok(options.decoded ?? [qr(1)])),
      findVariantsByCodes: async (codes) => called("findVariantsByCodes", ok((options.variants ?? [variant(1), variant(2)]).filter((item) => codes.includes(item.qrCode)))),
    }),
    findProcessedMessage: async (key) => called("findProcessedMessage", ok(state.processed.get(key) ?? null)),
    transaction: async (_company, work) => {
      state.calls.push("transaction");
      const snapshot = structuredClone({ customers: state.customers, orders: state.orders, processed: state.processed, sources: state.sources });
      const result = await work();
      if (!result.success) Object.assign(state, snapshot);
      return result;
    },
    ensureCustomerForContact: async (contact): Promise<Result<MessageCustomer, never>> => {
      const customerId = state.customers.get(contact) ?? (id(400) as CustomerId);
      state.customers.set(contact, customerId);
      return ok({ customerId, contactId: contact, name: null, phone: null });
    },
    findOpenChatOrderCandidate: async () => ok([...state.orders.values()].filter((order) => order.chatId === chatId).at(-1)?.id ?? null),
    findOrderForUpdate: async (orderId) => ok(state.orders.get(orderId) ?? null),
    allocateNumber: async () => ok(1008 as OrderNumber),
    saveNewOrder: async (order, source) => { state.orders.set(order.id, { ...order, chatId: source.chatId }); state.sources.push(source); return ok(null); },
    saveAddedItems: async (order) => { state.orders.set(order.id, order); return ok(null); },
    recordProcessedMessage: async (orderId, key) => { state.processed.set(key, orderId); return ok(null); },
    newOrderId: () => id(500) as OrderId,
    newItemId: () => id(counter++) as OrderItemId,
    clock: () => at,
    ...options.overrides,
  };
  return { state, deps, run: () => addMessageProductsToOrder({ companyId, messageId }, deps) };
}

describe("addMessageProductsToOrder", () => {
  test("creates an order for the contact's customer and chat with one item per variant and the uploader as seller", async () => {
    const h = harness({ decoded: [qr(1), qr(2)] });
    const result = await h.run();
    expect(result).toEqual(ok({ kind: "order_created", orderId: id(500), variantIds: [variant(1).variantId, variant(2).variantId], match: { method: "qr", unknownCodes: [] } }));
    expect(h.state.sources).toEqual([{ chatId, customerId: id(400) }]);
    const order = h.state.orders.get(id(500))!;
    expect(order).toMatchObject({ number: 1008, sellerId, buyer: { contactId, name: null, phone: null }, total: money(20), cancelled: false });
    expect(order.items.map((item) => [item.variantId, item.quantity])).toEqual([[variant(1).variantId, 1], [variant(2).variantId, 1]]);
    expect(h.state.processed.get(messageId)).toBe(id(500));
  });

  test("adds the scanned variants to the chat's open order", async () => {
    const h = harness({ decoded: [qr(2)], orders: [existingOrder()] });
    expect(await h.run()).toEqual(ok({ kind: "items_added", orderId: id(9), variantIds: [variant(2).variantId], match: { method: "qr", unknownCodes: [] } }));
    expect(h.state.orders.get(id(9))).toMatchObject({ total: money(20), items: [{ quantity: 1 }, { variantId: variant(2).variantId, quantity: 1 }] });
    expect(h.state.sources).toEqual([]);
  });

  test("increments the quantity of a variant already in the open order", async () => {
    const h = harness({ decoded: [qr(1)], orders: [existingOrder()] });
    await h.run();
    expect(h.state.orders.get(id(9))).toMatchObject({ total: money(20), items: [{ variantId: variant(1).variantId, quantity: 2 }] });
  });

  test("creates a new order when the candidate is no longer open after locking it", async () => {
    const h = harness({ decoded: [qr(2)], orders: [existingOrder({ payments: [{ id: id(60), orderId: id(9), status: "reported", currency: "PEN", amount: null, method: null,
      data: { receiptImageId: id(70), reportedAt: at } } as never] })] });
    expect(await h.run()).toMatchObject({ success: true, data: { kind: "order_created", orderId: id(500) } });
    expect(h.state.orders.get(id(9))!.items).toHaveLength(1);
  });

  test("creates the customer when the contact has none", async () => {
    const h = harness();
    await h.run();
    expect(h.state.customers.get(contactId)).toBe(id(400));
    expect(h.state.sources[0]!.customerId).toBe(id(400));
  });

  test("adds the codes found and reports the unknown ones", async () => {
    const h = harness({ decoded: [qr(1), qr(9)] });
    expect(await h.run()).toEqual(ok({ kind: "order_created", orderId: id(500), variantIds: [variant(1).variantId], match: { method: "qr", unknownCodes: [qr(9)] } }));
  });

  test("skips text messages as not_image without reading images", async () => {
    const h = harness({ message: message({ imageId: null }) });
    expect(await h.run()).toEqual(ok({ kind: "skipped", reason: "not_image" }));
    expect(h.state.calls).not.toContain("readImage");
    expect(h.state.calls).not.toContain("transaction");
  });

  test("skips outgoing messages as outgoing_message", async () => {
    const h = harness({ message: message({ direction: "outgoing" }) });
    expect(await h.run()).toEqual(ok({ kind: "skipped", reason: "outgoing_message" }));
    expect(h.state.calls).not.toContain("readImage");
  });

  test("skips photos without QR codes as visual_search_disabled when visual search is off", async () => {
    const h = harness({ decoded: [] });
    expect(await h.run()).toEqual(ok({ kind: "skipped", reason: "visual_search_disabled" }));
    expect(h.state.calls).not.toContain("findVariantsByCodes");
  });

  test("skips photos with only non-product QR codes as unrecognized_qr_code", async () => {
    const h = harness({ decoded: ["https://pay.example/yape"] });
    expect(await h.run()).toEqual(ok({ kind: "skipped", reason: "unrecognized_qr_code" }));
    expect(h.state.calls).not.toContain("findVariantsByCodes");
  });

  const visual = (outcome: ImageIdentification) => ({ identifyProducts: async () => ok(outcome) });
  const visualMatch: ImageIdentification = { kind: "found", method: "visual", items: [variant(2)], confidence: 0.9 as MatchConfidence, candidates: 5 };

  test("adds the variant identified visually to the chat's open order", async () => {
    const h = harness({ orders: [existingOrder()], overrides: visual(visualMatch) });
    expect(await h.run()).toEqual(ok({ kind: "items_added", orderId: id(9), variantIds: [variant(2).variantId], match: { method: "visual", confidence: 0.9, candidates: 5 } }));
    expect(h.state.orders.get(id(9))).toMatchObject({ items: [{ variantId: variant(1).variantId }, { variantId: variant(2).variantId, quantity: 1 }] });
  });

  test("creates an order from a visual match when the chat has no open order", async () => {
    const h = harness({ overrides: visual(visualMatch) });
    expect(await h.run()).toEqual(ok({ kind: "order_created", orderId: id(500), variantIds: [variant(2).variantId], match: { method: "visual", confidence: 0.9, candidates: 5 } }));
    expect(h.state.sources).toEqual([{ chatId, customerId: id(400) }]);
  });

  test("skips with the identification miss reason when no product is identified", async () => {
    for (const reason of ["no_indexed_products", "no_visual_match", "low_confidence", "ambiguous_variant"] as const) {
      const h = harness({ overrides: visual({ kind: "not_found", reason }) });
      expect(await h.run()).toEqual(ok({ kind: "skipped", reason }));
      expect(h.state.calls).not.toContain("transaction");
    }
  });

  test("skips as product_not_found when no code matches a sellable variant", async () => {
    const h = harness({ decoded: [qr(9)] });
    expect(await h.run()).toEqual(ok({ kind: "skipped", reason: "product_not_found" }));
    expect(h.state.calls).not.toContain("transaction");
  });

  test("returns already_processed before reading the image", async () => {
    const h = harness({ processed: [[messageId, id(9) as OrderId]] });
    expect(await h.run()).toEqual(ok({ kind: "already_processed", orderId: id(9) }));
    expect(h.state.calls).toEqual(["findProcessedMessage"]);
  });

  test("returns already_processed when the message was processed while waiting for the lock", async () => {
    let lookups = 0;
    const h = harness({ overrides: { findProcessedMessage: async () => ok(++lookups > 1 ? id(9) as OrderId : null) } });
    expect(await h.run()).toEqual(ok({ kind: "already_processed", orderId: id(9) }));
    expect(h.state.orders.size).toBe(0);
  });

  test("rolls back and returns already_processed when recording the message hits its key", async () => {
    let lookups = 0;
    const h = harness({ overrides: {
      findProcessedMessage: async () => ok(++lookups > 2 ? id(9) as OrderId : null),
      recordProcessedMessage: async () => err({ code: "MESSAGE_ALREADY_PROCESSED" as const, message: "Message already processed" }),
    } });
    expect(await h.run()).toEqual(ok({ kind: "already_processed", orderId: id(9) }));
    expect(h.state.orders.size).toBe(0);
    expect(h.state.customers.size).toBe(0);
  });

  test("identifies the products before opening the transaction", async () => {
    const h = harness();
    await h.run();
    const calls = h.state.calls;
    expect(calls.indexOf("transaction")).toBeGreaterThan(Math.max(calls.indexOf("readImage"), calls.indexOf("readQrCodes"), calls.indexOf("findVariantsByCodes")));
  });

  const failure = (code: AddMessageProductsError["code"]) => err({ code, message: code } as AddMessageProductsError);
  test("skips unreadable images as unreadable_image", async () => {
    const h = harness({ readQrCodes: async () => err({ code: "UNREADABLE_IMAGE" as const, message: "Unreadable image" }) });
    expect(await h.run()).toEqual(ok({ kind: "skipped", reason: "unreadable_image" }));
    expect(h.state.calls).not.toContain("transaction");
  });

  test("fails with MESSAGE_NOT_FOUND, IMAGE_NOT_FOUND, CONTACT_NOT_FOUND or SELLER_UNAVAILABLE without writing", async () => {
    const cases = [
    ["MESSAGE_NOT_FOUND", { findSourceMessage: async () => ok(null) }],
    ["IMAGE_NOT_FOUND", { readImage: async () => failure("IMAGE_NOT_FOUND") }],
    ["CONTACT_NOT_FOUND", { ensureCustomerForContact: async () => err({ code: "CONTACT_NOT_FOUND" as const, message: "no contact" }) }],
    ["SELLER_UNAVAILABLE", { saveNewOrder: async () => err({ code: "SELLER_UNAVAILABLE" as const, message: "no seller" }) }],
    ] as const;
    for (const [code, overrides] of cases) {
      const h = harness({ overrides: overrides as Partial<AddMessageProductsDependencies> });
      expect(await h.run()).toMatchObject({ success: false, error: { code } });
      expect(h.state.orders.size).toBe(0);
      expect(h.state.processed.size).toBe(0);
      expect(h.state.customers.size).toBe(0);
    }
  });

  test("propagates embedder and matcher failures", async () => {
    for (const code of ["EMBEDDER_UNAVAILABLE", "INVALID_EMBEDDING", "PRODUCT_MATCHER_UNAVAILABLE", "INVALID_MATCHER_RESPONSE"] as const) {
      const h = harness({ overrides: { identifyProducts: async () => err({ code, message: code }) } });
      expect(await h.run()).toEqual(err({ code, message: code }));
      expect(h.state.calls).not.toContain("transaction");
    }
  });

  test("propagates PERSISTENCE_UNAVAILABLE, IMAGE_STORAGE_UNAVAILABLE and QR_READER_UNAVAILABLE", async () => {
    const cases = [
    ["PERSISTENCE_UNAVAILABLE", { findProcessedMessage: async () => failure("PERSISTENCE_UNAVAILABLE") }],
    ["IMAGE_STORAGE_UNAVAILABLE", { readImage: async () => failure("IMAGE_STORAGE_UNAVAILABLE") }],
    ] as const;
    for (const [code, overrides] of cases) {
      const h = harness({ overrides: overrides as Partial<AddMessageProductsDependencies> });
      expect(await h.run()).toMatchObject({ success: false, error: { code } });
      expect(h.state.orders.size).toBe(0);
    }
    const unavailable = harness({ readQrCodes: async () => err({ code: "QR_READER_UNAVAILABLE" as const, message: "down" }) });
    expect(await unavailable.run()).toMatchObject({ success: false, error: { code: "QR_READER_UNAVAILABLE" } });
  });
});
