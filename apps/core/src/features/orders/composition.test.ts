import { parseBuyer, type OrderNumber } from "@core/src/features/orders/domain/checkout";
import { log } from "@core/src/shared/infrastructure/logger";
import { Prisma } from "@prisma/client";
import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

const { withinTransaction } = vi.hoisted(() => ({ withinTransaction: vi.fn() }));
vi.mock("@core/src/shared/infrastructure/persistance", () => ({ withinTransaction,
  requireNoActiveTransaction: () => undefined,
  withTenantIsolation: (_company: string, work: () => unknown) => work(),
  getCompanyId: () => "00000000-0000-4000-8000-000000000003" }));
vi.mock("@core/src/features/delivery-settings", () => ({ deliverySettings: { get: async () => ok({ version: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }) } }));
const { findCheckoutOrderForUpdate } = vi.hoisted(() => ({ findCheckoutOrderForUpdate: vi.fn() }));
vi.mock("@core/src/features/orders/infrastructure/checkout-repository", () => ({
  findCheckoutOrderForUpdate, findCheckoutOrder: vi.fn(), saveCheckoutEnabled: async () => ok(null),
  saveCheckoutBuyer: async () => ok(null), saveCheckoutConfirmed: async () => ok(null),
}));
vi.mock("@core/src/features/orders/infrastructure/order-repository", () => ({
  allocateOrderNumber: async () => ok(1001 as OrderNumber), orderExists: async () => ok(false), savePendingOrder: async () => ok(null), savePayment: async () => ok(null),
  saveStockDeduction: async () => ok(null), findOrders: vi.fn(), findOrderForUpdate: vi.fn(), findOrderAggregate: vi.fn(), saveFulfillment: async () => ok(null),
  findProcessedMessage: vi.fn(), findOpenChatOrderCandidate: vi.fn(), saveAddedItems: vi.fn(), recordProcessedMessage: vi.fn(), saveCancellation: vi.fn(),
}));
vi.mock("@core/src/features/products", () => ({
  findSellableVariant: async (variantId: string) => ok({ variantId, productName: "Product", variantAttributes: {}, sku: null,
    unitPrice: { amount: 1, currency: "PEN" } }), deductProductStock: async () => ok(null), searchSaleCatalog: vi.fn(),
}));
vi.mock("@core/src/features/products/composition", () => ({ products: { identifyProductsInImage: vi.fn() } }));
vi.mock("@core/src/features/contacts", () => ({ findContactById: vi.fn(), searchSaleContacts: vi.fn(), ensureCustomerForContact: vi.fn() }));
vi.mock("@core/src/features/chats", () => ({ findOrderSourceMessage: vi.fn() }));
const { addMessageProductsToOrder } = vi.hoisted(() => ({ addMessageProductsToOrder: vi.fn() }));
vi.mock("@core/src/features/orders/application/add-message-products-to-order", () => ({ addMessageProductsToOrder }));
const { publishEvent, cancelOrder } = vi.hoisted(() => ({ publishEvent: vi.fn(), cancelOrder: vi.fn() }));
vi.mock("@core/src/composition/event-bus", () => ({ applicationEventBus: () => ({ publishEvent }) }));
vi.mock("@core/src/features/orders/application/cancel-order", () => ({ cancelOrder }));

import { findOrderForUpdate } from "@core/src/features/orders/infrastructure/order-repository";
import { products } from "@core/src/features/products/composition";
import { orders, addMessageProductsHandler, messageOrderPolicy } from "@core/src/features/orders/composition";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const input = { id: id(1) as OrderId, items: [{ variantId: id(2) as VariantId, quantity: 1 as PositiveInteger }] } as const;
const context = { companyId: id(3) as CompanyId, userId: id(4) as UserId };

test("returns a recoverable failure when transaction acquisition or commit fails", async () => {
  const failures = [
    new Prisma.PrismaClientKnownRequestError("database unavailable", { code: "P1001", clientVersion: "7.10.0" }),
    new Prisma.PrismaClientUnknownRequestError("database unavailable", { clientVersion: "7.10.0" }),
    new Prisma.PrismaClientInitializationError("database unavailable", "7.10.0"),
  ];
  const errorLog = vi.spyOn(log, "error").mockImplementation(() => {});
  try {
    for (const failure of failures) {
      withinTransaction.mockRejectedValueOnce(failure);
      expect(await orders.registerImmediateSale(input, context)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
      withinTransaction.mockImplementationOnce(async (callback) => { await callback(); throw failure; });
      expect(await orders.registerImmediateSale(input, context)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    }
    const unexpected = new Error("Unexpected transaction failure");
    withinTransaction.mockRejectedValueOnce(unexpected);
    await expect(orders.registerImmediateSale(input, context)).rejects.toBe(unexpected);
  } finally {
    errorLog.mockRestore();
    withinTransaction.mockReset();
  }
});

test("checkout does not announce transitions before the outer commit succeeds", async () => {
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const buyer = parseBuyer({ name: "Ana", phone: "+51987654321" });
  if (!buyer.success) throw new Error("Invalid fixture");
  const total = { amount: 1, currency: "PEN" as const };
  const order = { id: input.id, companyId: context.companyId, companyName: "Store", number: 1001,
    buyer: null, delivery: null, deliveryCharge: { amount: 0, currency: "PEN" }, items: [], itemsTotal: total, total, cancelled: false,
    checkoutEnabledAt: null, checkoutConfirmedAt: null };
  try {
    for (const operation of ["enable", "confirm"] as const) {
      findCheckoutOrderForUpdate.mockResolvedValueOnce(ok({ ...order,
        checkoutEnabledAt: operation === "confirm" ? new Date() : null }));
      withinTransaction.mockImplementationOnce(async (work) => {
        expect(await work()).toMatchObject({ success: true });
        expect(info).not.toHaveBeenCalled();
        throw new Prisma.PrismaClientUnknownRequestError("commit failed", { clientVersion: "7.10.0" });
      });
      const result = operation === "enable" ? await orders.enableCheckout(input.id, context)
        : await orders.confirmCheckout({ buyer: buyer.data, expectedTotal: total }, { companyId: context.companyId, orderId: input.id });
      expect(result).toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
      expect(info).not.toHaveBeenCalled();
    }
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls.every(([fields]) => (fields as { event: string }).event === "unable_to_complete_order_transaction")).toBe(true);
  } finally {
    info.mockRestore(); error.mockRestore(); withinTransaction.mockReset(); findCheckoutOrderForUpdate.mockReset();
  }
});

const messageId = id(10) as ChatMessageId;
const eventId = id(11);
const handle = (attempt = 1) => addMessageProductsHandler({ companyId: context.companyId, messageId },
  { eventId, occurredAt: "2026-10-11T12:00:00.000Z" }, { signal: new AbortController().signal, attempt });

test("treats persistence, image storage and QR reader failures as retryable", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  try {
    for (const code of ["PERSISTENCE_UNAVAILABLE", "IMAGE_STORAGE_UNAVAILABLE", "QR_READER_UNAVAILABLE"] as const) {
      addMessageProductsToOrder.mockResolvedValueOnce(err({ code, message: "Unavailable" }));
      expect(await handle()).toEqual(err({ code, message: "Unavailable", retryable: true }));
    }
  } finally { error.mockRestore(); warn.mockRestore(); addMessageProductsToOrder.mockReset(); }
});

test("treats embedder and matcher unavailability as retryable", async () => {
  const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  try {
    for (const code of ["EMBEDDER_UNAVAILABLE", "PRODUCT_MATCHER_UNAVAILABLE"] as const) {
      addMessageProductsToOrder.mockResolvedValueOnce(err({ code, message: "Unavailable" }));
      expect(await handle()).toEqual(err({ code, message: "Unavailable", retryable: true }));
    }
  } finally { warn.mockRestore(); addMessageProductsToOrder.mockReset(); }
});

test("treats INVALID_EMBEDDING and INVALID_MATCHER_RESPONSE as permanent", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  try {
    for (const code of ["INVALID_EMBEDDING", "INVALID_MATCHER_RESPONSE"] as const) {
      addMessageProductsToOrder.mockResolvedValueOnce(err({ code, message: "Invalid" }));
      expect(await handle()).toEqual(err({ code, message: "Invalid", retryable: false }));
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "orders_message_order_failed", code, retryable: false }), expect.any(String));
    }
  } finally { error.mockRestore(); addMessageProductsToOrder.mockReset(); }
});

test("treats every other error as permanent", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  try {
    for (const code of ["MESSAGE_NOT_FOUND", "IMAGE_NOT_FOUND", "CONTACT_NOT_FOUND", "SELLER_UNAVAILABLE", "CURRENCY_MISMATCH", "INVALID_ORDER"] as const) {
      addMessageProductsToOrder.mockResolvedValueOnce(err({ code, message: "Rejected" }));
      expect(await handle()).toEqual(err({ code, message: "Rejected", retryable: false }));
    }
  } finally { error.mockRestore(); addMessageProductsToOrder.mockReset(); }
});

test("treats an invalid stored order from findOrderForUpdate as a permanent INVALID_ORDER", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  try {
    vi.mocked(findOrderForUpdate).mockResolvedValueOnce(err({ code: "INVALID_ORDER", message: "Invalid stored order" }));
    addMessageProductsToOrder.mockImplementationOnce((_input, deps) => deps.findOrderForUpdate(id(12) as OrderId));
    expect(await handle()).toEqual(err({ code: "INVALID_ORDER", message: "Invalid stored order", retryable: false }));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_ORDER", retryable: false }), expect.any(String));
  } finally { error.mockRestore(); addMessageProductsToOrder.mockReset(); }
});

test("logs an error instead of a warning when a retryable failure exhausts its retries", async () => {
  const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  try {
    addMessageProductsToOrder.mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unavailable" }));
    await handle(messageOrderPolicy.retries);
    expect(warn).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    await handle(messageOrderPolicy.retries + 1);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "orders_message_order_failed", code: "PERSISTENCE_UNAVAILABLE", retryable: true }), expect.any(String));
  } finally { warn.mockRestore(); error.mockRestore(); addMessageProductsToOrder.mockReset(); }
});

test("logs created, items added, skipped and failed outcomes with ids and without bytes, phones or decoded text", async () => {
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const orderId = id(12) as OrderId;
  const variantIds = [id(13) as VariantId];
  const unknownCodes = [id(14)];
  const common = { companyId: context.companyId, messageId, eventId, attempt: 2, durationMs: expect.any(Number) };
  try {
    addMessageProductsToOrder.mockResolvedValueOnce(ok({ kind: "order_created", orderId, variantIds, match: { method: "qr", unknownCodes } }));
    addMessageProductsToOrder.mockResolvedValueOnce(ok({ kind: "items_added", orderId, variantIds, match: { method: "qr", unknownCodes } }));
    addMessageProductsToOrder.mockResolvedValueOnce(ok({ kind: "skipped", reason: "low_confidence", topDistance: 0.31, chosenDistance: 0.42 }));
    addMessageProductsToOrder.mockResolvedValueOnce(ok({ kind: "already_processed", orderId }));
    addMessageProductsToOrder.mockResolvedValueOnce(err({ code: "PERSISTENCE_UNAVAILABLE", message: "+51987654321 bytes" }));
    addMessageProductsToOrder.mockResolvedValueOnce(err({ code: "IMAGE_NOT_FOUND", message: "Image is not available" }));
    for (let call = 0; call < 6; call += 1) await handle(2);
    expect(info.mock.calls.map(([fields]) => fields)).toEqual([
      { event: "orders_message_order_created", ...common, orderId, variantCount: 1, matchMethod: "qr", unknownCodes },
      { event: "orders_message_order_items_added", ...common, orderId, variantCount: 1, matchMethod: "qr", unknownCodes },
      { event: "orders_message_order_skipped", ...common, reason: "low_confidence", topDistance: 0.31, chosenDistance: 0.42 },
      { event: "orders_message_order_skipped", ...common, orderId, reason: "already_processed" },
    ]);
    expect(warn.mock.calls.map(([fields]) => fields)).toEqual([{ event: "orders_message_order_failed", ...common, code: "PERSISTENCE_UNAVAILABLE", retryable: true }]);
    expect(error.mock.calls.map(([fields]) => fields)).toEqual([{ event: "orders_message_order_failed", ...common, code: "IMAGE_NOT_FOUND", retryable: false }]);
    expect(JSON.stringify([info.mock.calls, warn.mock.calls, error.mock.calls])).not.toMatch(/51987654321|bytes/);
  } finally { info.mockRestore(); warn.mockRestore(); error.mockRestore(); addMessageProductsToOrder.mockReset(); }
});

test("logs the match method, confidence and distances without images or product names", async () => {
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  try {
    addMessageProductsToOrder.mockResolvedValueOnce(ok({ kind: "items_added", orderId: id(12), variantIds: [id(13)],
      match: { method: "visual", confidence: 0.87, candidates: 5, topDistance: 0.12, chosenDistance: 0.12 } }));
    await handle(1);
    expect(info).toHaveBeenCalledWith({ event: "orders_message_order_items_added", companyId: context.companyId, messageId, eventId, attempt: 1,
      durationMs: expect.any(Number), orderId: id(12), variantCount: 1, matchMethod: "visual", confidence: 0.87, candidates: 5, topDistance: 0.12, chosenDistance: 0.12 }, expect.any(String));
  } finally { info.mockRestore(); addMessageProductsToOrder.mockReset(); }
});

test("identifies message images through products identifyProductsInImage", async () => {
  const image = { bytes: new Uint8Array([1]), mimeType: "image/jpeg" };
  const identified = ok({ method: "qr", variants: [] });
  vi.mocked(products.identifyProductsInImage).mockResolvedValueOnce(identified as never);
  addMessageProductsToOrder.mockImplementationOnce(async (_input, deps) => {
    expect(await deps.identifyProducts(image)).toBe(identified);
    return ok({ kind: "skipped", reason: "no_image" });
  });
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  try {
    await handle();
    expect(products.identifyProductsInImage).toHaveBeenCalledWith(image);
  } finally { info.mockRestore(); addMessageProductsToOrder.mockReset(); }
});

test("logs order_cancelled_publish_failed with the order number when order_cancelled cannot be published", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const failure = { code: "EVENT_BUS_UNAVAILABLE", message: "Event bus is not ready" } as const;
  const payload = { companyId: context.companyId, orderId: input.id };
  publishEvent.mockResolvedValueOnce(err(failure));
  cancelOrder.mockImplementationOnce(async (_id, _context, deps) => { await deps.publishOrderCancelled(payload); return ok({ number: 1001, cancelled: true }); });
  try {
    expect(await orders.cancel(input.id, context)).toEqual(ok({ number: 1001, cancelled: true }));
    expect(publishEvent).toHaveBeenCalledWith("order_cancelled", payload);
    expect(error).toHaveBeenCalledWith({ event: "order_cancelled_publish_failed", companyId: context.companyId, orderId: input.id, orderNumber: 1001,
      errorCode: "EVENT_BUS_UNAVAILABLE", err: failure }, "order_cancelled_publish_failed");
  } finally { error.mockRestore(); cancelOrder.mockReset(); publishEvent.mockReset(); }
});
