import { parseBuyer, parseOrderNumber, type OrderNumber } from "@core/src/features/orders/domain/checkout";
import { log } from "@core/src/shared/infrastructure/logger";
import { Prisma } from "@prisma/client";
import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const { withinTransaction } = vi.hoisted(() => ({ withinTransaction: vi.fn() }));
vi.mock("@core/src/shared/infrastructure/persistance", () => ({ withinTransaction,
  requireNoActiveTransaction: () => undefined, requireActiveTransaction: () => undefined, setLocalTimeouts: vi.fn(), withinReadSnapshot: (read: () => unknown) => read(), withinSavepoint: async () => ({ success: true, data: { kind: "deducted", stock: new Map(), deductedAt: new Date("2026-09-30T12:00:00Z") } }),
  withTenantIsolation: (_company: string, work: () => unknown) => work(),
  getCompanyId: () => "00000000-0000-4000-8000-000000000003" }));
vi.mock("@core/src/features/delivery-settings", () => ({ deliverySettings: { get: async () => ok({ version: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }) } }));
const { findCheckoutOrderForUpdate } = vi.hoisted(() => ({ findCheckoutOrderForUpdate: vi.fn() }));
vi.mock("@core/src/features/orders/infrastructure/checkout-repository", () => ({
  findCheckoutOrderForUpdate, findCheckoutOrder: vi.fn(),
  saveCheckoutBuyer: async () => ok(null), saveCheckoutConfirmed: async () => ok(null),
}));
vi.mock("@core/src/features/orders/infrastructure/order-repository", () => ({
  allocateOrderNumber: async () => ok(1001 as OrderNumber), orderExists: async () => ok(false), savePendingOrder: async () => ok(null), savePayment: async () => ok(null),
  saveStockDeduction: async () => ok(null), loadStockOrders: vi.fn(), listCompaniesWithOverdueStockDeductions: vi.fn(), listOverdueOrderIds: vi.fn(), lockOrdersSkipLocked: vi.fn(), saveStockDeductions: vi.fn(), saveLineDeductions: vi.fn(), listWaitingOrderIds: vi.fn(), findOrders: vi.fn(), findOrderForUpdate: vi.fn(), findOrderAggregate: vi.fn(), saveFulfillment: async () => ok(null),
  findChatOrderTarget: vi.fn(), findOrderAggregateByNumber: vi.fn(), existsOrder: vi.fn(), summarizeUnpaidOrders: vi.fn(), findDispatchCandidates: vi.fn(), countUndatedPendingOrders: vi.fn(), findChatOrdersOpenedSince: vi.fn(), findChatOrderTargetForUpdate: vi.fn(), saveItemChanges: vi.fn(), recordProcessedMessage: vi.fn(), saveCancellation: vi.fn(),
}));
vi.mock("@core/src/features/products", () => ({
  findSellableVariants: async (variantIds: readonly string[]) => ok(variantIds.map((variantId) => ({ variantId, productName: "Product", variantAttributes: {}, sku: null,
    unitPrice: { amount: 1, currency: "PEN" } }))), lockVariantStock: vi.fn(), deductStockBulk: vi.fn(), restoreStockBulk: vi.fn(), findVariantStock: vi.fn(), searchSaleCatalog: vi.fn(),
}));
vi.mock("@core/src/features/products/composition", () => ({ products: { identifyProductsInImage: vi.fn(), findVariantPhotos: vi.fn(), findOfferedVariants: vi.fn() } }));
vi.mock("@core/src/features/orders/infrastructure/chat-pending-repository", () => ({ findChatPendings: vi.fn(), findChatPendingsForUpdate: vi.fn(), saveChatPendings: vi.fn() }));
vi.mock("@core/src/features/orders/infrastructure/chat-message-outcome-repository", () => ({ findOutcome: vi.fn(), recordOutcome: vi.fn(), recordFailedOutcome: vi.fn() }));
vi.mock("@core/src/features/contacts", () => ({ findContactById: vi.fn(), searchSaleContacts: vi.fn(), ensureCustomerForContact: vi.fn(), lockContact: vi.fn() }));
vi.mock("@core/src/features/chats", () => ({ findOrderSourceMessage: vi.fn() }));
const { publishEvent, cancelOrder } = vi.hoisted(() => ({ publishEvent: vi.fn(), cancelOrder: vi.fn() }));
vi.mock("@core/src/composition/event-bus", () => ({ applicationEventBus: () => ({ publishEvent }) }));
vi.mock("@core/src/features/orders/application/cancel-order", () => ({ cancelOrder }));

import { findCheckoutOrder } from "@core/src/features/orders/infrastructure/checkout-repository";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";

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
    findCheckoutOrderForUpdate.mockResolvedValueOnce(ok({ ...order, checkoutEnabledAt: new Date() }));
    withinTransaction.mockImplementationOnce(async (work) => {
      expect(await work()).toMatchObject({ success: true });
      expect(info).not.toHaveBeenCalled();
      throw new Prisma.PrismaClientUnknownRequestError("commit failed", { clientVersion: "7.10.0" });
    });
    const result = await orders.confirmCheckout({ buyer: buyer.data, expectedTotal: total }, { companyId: context.companyId, orderId: input.id });
    expect(result).toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls.every(([fields]) => (fields as { event: string }).event === "unable_to_complete_order_transaction")).toBe(true);
  } finally {
    info.mockRestore(); error.mockRestore(); withinTransaction.mockReset(); findCheckoutOrderForUpdate.mockReset();
  }
});

test("the seller's checkout link read opens no transaction and takes no row lock", async () => {
  const total = { amount: 1, currency: "PEN" as const };
  vi.mocked(findCheckoutOrder).mockResolvedValueOnce(ok({ id: input.id, companyId: context.companyId, companyName: "Store", number: 1001 as OrderNumber,
    buyer: null, delivery: null, deliveryCharge: { amount: 0, currency: "PEN" }, items: [], itemsTotal: total, total, cancelled: true,
    fromCatalog: false, checkoutEnabledAt: new Date(), checkoutConfirmedAt: null } as never));
  try {
    expect(await orders.enableCheckout(input.id, context)).toMatchObject({ error: { code: "ORDER_CANCELLED" } });
    expect(withinTransaction).not.toHaveBeenCalled();
    expect(findCheckoutOrderForUpdate).not.toHaveBeenCalled();
  } finally { vi.mocked(findCheckoutOrder).mockReset(); }
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

test("loads the checkout with markers and logs order_checkout_photos_unavailable once when the photos cannot be read", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const access = { companyId: context.companyId, orderId: input.id };
  const number = parseOrderNumberForTest();
  vi.mocked(findCheckoutOrder).mockResolvedValueOnce(ok({ ...access, id: access.orderId, companyName: "Store", number, buyer: null,
    items: [{ id: id(5), variantId: id(2), productName: "Product", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 1, currency: "PEN" }, subtotal: { amount: 1, currency: "PEN" } }],
    itemsTotal: { amount: 1, currency: "PEN" }, total: { amount: 1, currency: "PEN" }, delivery: null, deliveryCharge: { amount: 0, currency: "PEN" }, cancelled: false,
    checkoutEnabledAt: new Date("2026-01-01T00:00:00Z"), checkoutConfirmedAt: null, fromCatalog: false } as never));
  vi.mocked(products.findVariantPhotos).mockResolvedValueOnce(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
  try {
    expect(await orders.getCheckout(access)).toMatchObject({ success: true, data: { photos: new Map(), checkout: { number } } });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith({ event: "order_checkout_photos_unavailable", companyId: "00000000-0000-4000-8000-000000000003", errorCode: "PERSISTENCE_UNAVAILABLE", variantCount: 1 }, "order_checkout_photos_unavailable");
  } finally { error.mockRestore(); }
});

function parseOrderNumberForTest() {
  const number = parseOrderNumber(1001);
  if (!number.success) throw new Error("Invalid order number");
  return number.data;
}

test("reads the checkout view without looking up or logging product photos", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const access = { companyId: context.companyId, orderId: input.id };
  const number = parseOrderNumberForTest();
  vi.mocked(products.findVariantPhotos).mockClear();
  vi.mocked(findCheckoutOrder).mockResolvedValueOnce(ok({ ...access, id: access.orderId, companyName: "Store", number, buyer: null,
    items: [{ id: id(5), variantId: id(2), productName: "Product", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 1, currency: "PEN" }, subtotal: { amount: 1, currency: "PEN" } }],
    itemsTotal: { amount: 1, currency: "PEN" }, total: { amount: 1, currency: "PEN" }, delivery: null, deliveryCharge: { amount: 0, currency: "PEN" }, cancelled: false,
    checkoutEnabledAt: new Date("2026-01-01T00:00:00Z"), checkoutConfirmedAt: null, fromCatalog: false } as never));
  try {
    expect(await orders.getCheckoutView(access)).toMatchObject({ success: true, data: { number, state: { kind: "pending" } } });
    expect(products.findVariantPhotos).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally { error.mockRestore(); }
});
