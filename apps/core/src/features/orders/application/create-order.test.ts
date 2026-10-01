import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { createOrder, type CreateOrderDependencies } from "@core/src/features/orders/application/create-order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const context = { companyId: id(1), sellerId: "seller" };
const input = { id: id(2), contactId: null, items: [{ variantId: id(3), quantity: 2 }] };

function dependencies() {
  const save = vi.fn(async () => ok<null>(null));
  const deductStock = vi.fn(async () => ok<null>(null));
  const findContact = vi.fn(async () => ok(null));
  const findVariant = vi.fn(async (variantId: string) => ok({ variantId: variantId as VariantId, productName: "Current product",
    variantAttributes: {}, sku: null, unitPrice: { amount: 0.29, currency: "PEN" as const } }));
  const deps: CreateOrderDependencies = { transaction: async (callback) => callback(), orderExists: async () => ok(false), findContact, findVariant, save, deductStock,
    newId: () => id(4), clock: () => new Date("2026-09-27T12:00:00Z") };
  return { deps, save, deductStock, findContact, findVariant };
}

test("creates from catalog price and authenticated context", async () => {
  const { deps, save, deductStock } = dependencies();
  const result = await createOrder(input, context, deps);
  expect(result).toMatchObject({ success: true, data: { companyId: context.companyId, sellerId: context.sellerId, total: { amount: 0.58, currency: "PEN" } } });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ total: { amount: 0.58, currency: "PEN" } }));
  expect(deductStock).toHaveBeenCalledWith(id(3), 2);
});

test("rejects absent contact before writes", async () => {
  const { deps, save, deductStock } = dependencies();
  expect(await createOrder({ ...input, contactId: id(5) }, context, deps)).toMatchObject({ success: false, error: { code: "CONTACT_NOT_FOUND" } });
  expect(save).not.toHaveBeenCalled();
  expect(deductStock).not.toHaveBeenCalled();
});

test("reports an existing order ID before checking changed cart data", async () => {
  const { deps, findVariant, save } = dependencies();
  expect(await createOrder({ ...input, items: [{ variantId: id(5), quantity: 1 }] }, context,
    { ...deps, orderExists: async () => ok(true) })).toMatchObject({ success: false, error: { code: "ORDER_ALREADY_EXISTS" } });
  expect(findVariant).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

test("rejects absent variant before writes", async () => {
  const { deps, save, deductStock } = dependencies();
  expect(await createOrder(input, context, { ...deps, findVariant: async () => ok(null) })).toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId: id(3) } });
  expect(save).not.toHaveBeenCalled();
  expect(deductStock).not.toHaveBeenCalled();
});

test("stops on save and stock errors", async () => {
  const first = dependencies();
  expect(await createOrder(input, context, { ...first.deps, save: async () => err({ code: "ORDER_ALREADY_EXISTS", message: "Duplicate" }) })).toMatchObject({ success: false, error: { code: "ORDER_ALREADY_EXISTS" } });
  expect(first.deductStock).not.toHaveBeenCalled();
  const second = dependencies();
  expect(await createOrder(input, context, { ...second.deps, deductStock: async () => err({ code: "INSUFFICIENT_STOCK", message: "No stock", variantId: id(3) }) })).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", variantId: id(3) } });
});

test("preserves known persistence failures and unexpected exceptions", async () => {
  const { deps } = dependencies();
  expect(await createOrder(input, context, { ...deps, orderExists: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "Database unavailable" }) }))
    .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  const unexpected = new Error("Unexpected adapter error");
  await expect(createOrder(input, context, { ...deps, findVariant: async () => { throw unexpected; } })).rejects.toBe(unexpected);
});

test("rejects duplicates and bad quantity before transaction", async () => {
  const { deps } = dependencies();
  let transactions = 0;
  const transaction: CreateOrderDependencies["transaction"] = (callback) => { transactions++; return callback(); };
  expect(await createOrder({ ...input, items: [input.items[0], input.items[0]] }, context, { ...deps, transaction })).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(await createOrder({ ...input, items: [{ variantId: id(3), quantity: 0 }] }, context, { ...deps, transaction })).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(transactions).toBe(0);
});
