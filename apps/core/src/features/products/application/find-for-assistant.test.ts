import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { OptionId, OptionValueId, Product, ProductId, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import { findForAssistant, type FindForAssistantDependencies } from "@core/src/features/products/application/find-for-assistant";

const productId = "11111111-1111-4111-8111-111111111111" as ProductId;
const option = "22222222-2222-4222-8222-222222222222" as OptionId;
const value = (suffix: string) => `33333333-3333-4333-8333-33333333333${suffix}` as OptionValueId;
const variant = (id: string, valueId: OptionValueId, sku?: string): ProductVariant => ({
  id: id as VariantId, productId, combination: { [option]: valueId }, ...sku ? { sku } : {},
  salePrice: { amount: 10, currency: "PEN" }, qrCode: id, status: "active", stock: { quantity: 1 } } as unknown as ProductVariant);
// Saved order is S, M; the repository returned them reversed.
const product = {
  id: productId, name: "Polo básico", currency: "PEN", status: "active", photoIds: [], qrCode: "q", createdAt: new Date(), updatedAt: new Date(), structureVersion: 1,
  options: [{ id: option, name: "Talla", position: 0, values: [{ id: value("1"), name: "S", position: 0 }, { id: value("2"), name: "M", position: 1 }] }],
  variants: [variant("v-m", value("2"), "pol-m-az"), variant("v-s", value("1"), "pol-s-az")],
} as unknown as Product;

function dependencies(overrides: Partial<FindForAssistantDependencies> = {}) {
  return {
    snapshot: (read) => read(),
    findSkuOwner: vi.fn(async () => ok({ variantId: "v-m" as VariantId, productId })),
    readProduct: vi.fn(async () => ok(product)),
    ...overrides,
  } as FindForAssistantDependencies & { findSkuOwner: ReturnType<typeof vi.fn>; readProduct: ReturnType<typeof vi.fn> };
}

test("opens the product of a SKU written «pol-m-az » and marks that variant as searched", async () => {
  const deps = dependencies();
  const result = await findForAssistant({ by: "sku", sku: " POL-M-AZ " }, deps);
  expect(deps.findSkuOwner).toHaveBeenCalledWith("pol-m-az");
  expect(result).toMatchObject({ success: true, data: { searchedVariantId: "v-m", product: { id: productId } } });
});

test("returns the variants in saved order", async () => {
  const result = await findForAssistant({ by: "id", id: productId }, dependencies());
  expect(result.success && result.data?.product.variants.map(({ id }) => id)).toEqual(["v-s", "v-m"]);
  expect(result.success && result.data?.searchedVariantId).toBeNull();
});

test("answers null for an unknown SKU and for an unknown product", async () => {
  const unknownSku = dependencies({ findSkuOwner: async () => ok(null) });
  expect(await findForAssistant({ by: "sku", sku: "x" }, unknownSku)).toEqual(ok(null));
  expect(unknownSku.readProduct).not.toHaveBeenCalled();
  expect(await findForAssistant({ by: "id", id: productId }, dependencies({ readProduct: async () => ok(null) }))).toEqual(ok(null));
});

test("passes a read failure through", async () => {
  const failure = { code: "STATEMENT_TIMEOUT", message: "slow" } as const;
  expect(await findForAssistant({ by: "sku", sku: "x" }, dependencies({ findSkuOwner: async () => err(failure) }))).toEqual(err(failure));
});
