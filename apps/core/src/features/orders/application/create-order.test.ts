import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { createOrder, type CreateOrderDependencies, type CreateOrderInput, type OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1) as CompanyId;
const context: OrderAccess = { companyId, userId: "seller" as UserId };
const input: CreateOrderInput = { id: id(2) as OrderId, contactId: null,
  items: [{ variantId: id(3) as VariantId, quantity: 2 as PositiveInteger }] };

function dependencies() {
  const saveOrder = vi.fn(async () => ok<null>(null));
  const findContact = vi.fn(async () => ok(null));
  const findVariant = vi.fn(async (variantId: VariantId) => ok({ variantId, productName: "Current product",
    variantAttributes: { Size: "M" }, sku: null, unitPrice: { amount: 0.29, currency: "PEN" as const } }));
  const scopedCompanies: CompanyId[] = [];
  const transaction: CreateOrderDependencies["transaction"] = async (id, work) => { scopedCompanies.push(id); return work(); };
  const deps: CreateOrderDependencies = { allocateNumber: async () => ok(1001 as OrderNumber), transaction, orderExists: async () => ok(false), findContact,
    findVariant, saveOrder, newItemId: () => id(4) as OrderItemId, clock: () => new Date("2026-09-29T12:00:00Z") };
  return { deps, saveOrder, findContact, findVariant, scopedCompanies };
}

test("creates a pending order from company scoped catalog and trusted seller without deducting stock", async () => {
  const { deps, saveOrder, findVariant, scopedCompanies } = dependencies();
  const result = await createOrder(input, context, deps);
  expect(result).toMatchObject({ success: true, data: { id: input.id, companyId, sellerId: context.userId,
    completedAt: null, payments: [], deliveryStatus: "pending", stockDeducted: false,
    total: { amount: 0.58, currency: "PEN" }, items: [{ id: id(4), subtotal: { amount: 0.58 } }] } });
  expect(scopedCompanies).toEqual([companyId]);
  expect(findVariant).toHaveBeenCalledWith(input.items[0].variantId, companyId);
  expect(saveOrder).toHaveBeenCalledWith(expect.objectContaining({ payments: [], stockDeducted: false }));
});

test("rejects invalid input and missing snapshots before writing", async () => {
  const first = dependencies();
  expect(await createOrder({ ...input, items: [] } as unknown as CreateOrderInput, context, first.deps))
    .toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  expect(first.scopedCompanies).toEqual([]);
  const second = dependencies();
  expect(await createOrder(input, context, { ...second.deps, findVariant: async () => ok(null) }))
    .toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND" } });
  expect(second.saveOrder).not.toHaveBeenCalled();
  const third = dependencies();
  expect(await createOrder({ ...input, contactId: id(5) as CreateOrderInput["contactId"] }, context, third.deps))
    .toMatchObject({ success: false, error: { code: "CONTACT_NOT_FOUND" } });
  expect(third.saveOrder).not.toHaveBeenCalled();
});

test("preserves duplicate and persistence failures from supplied capabilities", async () => {
  const first = dependencies();
  expect(await createOrder(input, context, { ...first.deps, orderExists: async () => ok(true) }))
    .toMatchObject({ success: false, error: { code: "ORDER_ALREADY_EXISTS" } });
  expect(first.findVariant).not.toHaveBeenCalled();
  const second = dependencies();
  expect(await createOrder(input, context, { ...second.deps, saveOrder: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unavailable" }) }))
    .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});
