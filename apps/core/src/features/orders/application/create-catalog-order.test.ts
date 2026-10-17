import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { createCatalogOrder, type CreateCatalogOrderDependencies, type CreateCatalogOrderInput } from "@core/src/features/orders/application/create-catalog-order";
import type { CartQuantity, SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { CompanyId, OrderId, OrderItemId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1) as CompanyId;
const [black, beige, red] = [id(3), id(4), id(5)] as VariantId[];
const input: CreateCatalogOrderInput = { id: id(2) as OrderId, lines: [
  { variantId: black, quantity: 3 as CartQuantity }, { variantId: beige, quantity: 1 as CartQuantity }] };
const variant = (variantId: VariantId, amount: number, available: number): SellableVariant => ({ variantId, productName: "Polo básico",
  variantAttributes: { Talla: "M" }, sku: "SKU-1", unitPrice: { amount, currency: "PEN" }, available });

function dependencies(variants: readonly SellableVariant[] = [variant(black, 45, 3), variant(beige, 39.9, 10)]) {
  const saveCatalogOrder = vi.fn<CreateCatalogOrderDependencies["saveCatalogOrder"]>(async () => ok<null>(null));
  const allocateNumber = vi.fn(async () => ok(1042 as OrderNumber));
  let item = 10;
  const deps: CreateCatalogOrderDependencies = { transaction: async (_companyId, work) => work(), findOrder: async () => ok(null),
    findSellableVariants: async () => ok(variants), allocateNumber, saveCatalogOrder,
    newItemId: () => id(item++) as OrderItemId, clock: () => new Date("2026-10-17T12:00:00Z") };
  return { deps, saveCatalogOrder, allocateNumber };
}

test("builds a numbered catalog order without seller and with checkout enabled", async () => {
  const { deps, saveCatalogOrder } = dependencies();
  const result = await createCatalogOrder(input, { companyId }, deps);
  expect(result).toMatchObject({ success: true, data: { id: input.id, companyId, number: 1042, sellerId: null, fromCatalog: true, buyer: null,
    checkoutEnabledAt: new Date("2026-10-17T12:00:00Z"), checkoutConfirmedAt: null, delivery: null, stockDeducted: false,
    items: [{ variantId: black, quantity: 3, unitPrice: { amount: 45 } }, { variantId: beige, quantity: 1 }], total: { amount: 174.9, currency: "PEN" } } });
  expect(saveCatalogOrder).toHaveBeenCalledWith(result.success && result.data);
});

test("rejects every unavailable line at once and creates nothing", async () => {
  const { deps, saveCatalogOrder, allocateNumber } = dependencies([variant(black, 45, 0)]);
  const result = await createCatalogOrder({ ...input, lines: [...input.lines, { variantId: red, quantity: 1 as CartQuantity }] }, { companyId },
    { ...deps, findSellableVariants: async () => ok([variant(black, 45, 0), variant(red, 20, 5)]) });
  expect(result).toMatchObject({ success: false, error: { code: "LINES_UNAVAILABLE", issues: [
    { variantId: black, reason: "sold_out" }, { variantId: beige, reason: "unavailable" }] } });
  expect(allocateNumber).not.toHaveBeenCalled();
  expect(saveCatalogOrder).not.toHaveBeenCalled();
});

test("reports the available quantity when a line asks for more than the stock", async () => {
  const { deps } = dependencies([variant(black, 45, 1), variant(beige, 39.9, 10)]);
  expect(await createCatalogOrder(input, { companyId }, deps)).toMatchObject({ success: false,
    error: { code: "LINES_UNAVAILABLE", issues: [{ variantId: black, reason: "insufficient", available: 1 }] } });
});

test("rejects a line priced in another currency instead of failing the whole order", async () => {
  const { deps, allocateNumber } = dependencies([variant(black, 45, 3), { ...variant(beige, 12, 10), unitPrice: { amount: 12, currency: "USD" } }]);
  expect(await createCatalogOrder(input, { companyId }, deps)).toMatchObject({ success: false,
    error: { code: "LINES_UNAVAILABLE", issues: [{ variantId: beige, reason: "other_currency" }] } });
  expect(allocateNumber).not.toHaveBeenCalled();
});

test("returns the existing catalog order when Continuar repeats the same id", async () => {
  const first = dependencies();
  const created = await createCatalogOrder(input, { companyId }, first.deps);
  if (!created.success) throw new Error("expected order");
  const second = dependencies();
  expect(await createCatalogOrder(input, { companyId }, { ...second.deps, findOrder: async () => ok(created.data) })).toEqual(created);
  expect(second.allocateNumber).not.toHaveBeenCalled();
  expect(second.saveCatalogOrder).not.toHaveBeenCalled();
});

test("returns the order stored by a simultaneous Continuar after losing the insert", async () => {
  const first = dependencies();
  const created = await createCatalogOrder(input, { companyId }, first.deps);
  if (!created.success) throw new Error("expected order");
  const { deps } = dependencies();
  const findOrder = vi.fn().mockResolvedValueOnce(ok(null)).mockResolvedValueOnce(ok(created.data));
  expect(await createCatalogOrder(input, { companyId }, { ...deps, findOrder,
    saveCatalogOrder: async () => err({ code: "ORDER_ID_CONFLICT" as const, message: "taken" }) })).toEqual(created);
});

test("rejects an id that belongs to an order not created by the catalog", async () => {
  const first = dependencies();
  const created = await createCatalogOrder(input, { companyId }, first.deps);
  if (!created.success) throw new Error("expected order");
  const { deps, saveCatalogOrder } = dependencies();
  expect(await createCatalogOrder(input, { companyId }, { ...deps, findOrder: async () => ok({ ...created.data, fromCatalog: false }) }))
    .toMatchObject({ success: false, error: { code: "ORDER_ID_CONFLICT" } });
  expect(saveCatalogOrder).not.toHaveBeenCalled();
  // Another company's id is invisible under RLS: the insert collides and the re-read still finds nothing.
  expect(await createCatalogOrder(input, { companyId }, { ...deps,
    saveCatalogOrder: async () => err({ code: "ORDER_ID_CONFLICT" as const, message: "taken" }) }))
    .toMatchObject({ success: false, error: { code: "ORDER_ID_CONFLICT" } });
});
