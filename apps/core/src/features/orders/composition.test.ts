import { parseBuyer, type OrderNumber } from "@core/src/features/orders/domain/checkout";
import { log } from "@core/src/shared/infrastructure/logger";
import { Prisma } from "@prisma/client";
import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const { withinTransaction } = vi.hoisted(() => ({ withinTransaction: vi.fn() }));
vi.mock("@core/src/shared/infrastructure/persistance", () => ({ withinTransaction,
  requireNoActiveTransaction: () => undefined,
  withTenantIsolation: (_company: string, work: () => unknown) => work(),
  getCompanyId: () => "00000000-0000-4000-8000-000000000003" }));
vi.mock("@core/src/features/delivery-settings", () => ({ deliverySettings: { get: async () => ok({ version: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }) } }));
const { findCheckoutOrderForUpdate } = vi.hoisted(() => ({ findCheckoutOrderForUpdate: vi.fn() }));
vi.mock("@core/src/features/orders/infrastructure/checkout-repository", () => ({
  findCheckoutOrderForUpdate, findCheckoutOrder: vi.fn(), saveCheckoutEnabled: async () => ok(null),
  saveCheckoutDeliveryRequest: async () => ok(null), saveCheckoutBuyer: async () => ok(null), saveCheckoutConfirmed: async () => ok(null),
}));
vi.mock("@core/src/features/orders/infrastructure/order-repository", () => ({
  allocateOrderNumber: async () => ok(1001 as OrderNumber), orderExists: async () => ok(false), savePendingOrder: async () => ok(null), savePayment: async () => ok(null),
  saveStockDeduction: async () => ok(null), findOrders: vi.fn(), findOrderForUpdate: vi.fn(), saveFulfillment: async () => ok(null),
}));
vi.mock("@core/src/features/products", () => ({
  findSellableVariant: async (variantId: string) => ok({ variantId, productName: "Product", variantAttributes: {}, sku: null,
    unitPrice: { amount: 1, currency: "PEN" } }), deductProductStock: async () => ok(null), searchSaleCatalog: vi.fn(),
}));
vi.mock("@core/src/features/contacts", () => ({ findContactById: vi.fn(), searchSaleContacts: vi.fn() }));

import { orders } from "@core/src/features/orders/composition";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const input = { id: id(1) as OrderId, contactId: null, items: [{ variantId: id(2) as VariantId, quantity: 1 as PositiveInteger }] } as const;
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
