import { expect, test } from "vitest";
import type { ProductDetailResponse } from "@shared/contracts/products";
import { deleteBlock, outcomeFor, parseVariantAction, valuesLeftWithoutVariants, variantLabel } from "@core/src/features/products/presentation/variant-detail-model";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [talla, color, s, xl, negro, azul] = [1, 2, 3, 4, 5, 6].map(id);
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const variant = (n: number, size: string, tint: string, extra: Partial<ProductDetailResponse["product"]["variants"][number]> = {}) => ({
  id: id(20 + n), combination: [{ optionId: talla, valueId: size }, { optionId: color, valueId: tint }], sku: null, salePrice: money(10), purchasePrice: null,
  qrCode: id(40 + n), status: "active", stock: 0, hasOrders: false, ...extra,
});
const product = (variants = [variant(1, s, negro), variant(2, xl, azul), variant(3, s, azul)]): ProductDetailResponse["product"] => ({
  id: id(50), name: "Polo", description: null, hidden: false, photos: [], currency: "PEN", qrCode: id(51), createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z", structureVersion: 1,
  options: [
    { id: talla, name: "Talla", values: [{ id: s, name: "S" }, { id: xl, name: "XL" }] },
    { id: color, name: "Color", values: [{ id: negro, name: "Negro" }, { id: azul, name: "Azul" }] },
  ],
  variants,
});

test("labels a variant with its values in saved option order", () => {
  expect(variantLabel(product(), product().variants[1])).toBe("XL / Azul");
});

test("explains why a variant cannot be deleted: orders first, then stock, then being the only one", () => {
  const base = product();
  expect(deleteBlock(base, variant(1, s, negro, { hasOrders: true, stock: 3 }))).toEqual({ reason: "orders" });
  expect(deleteBlock(base, variant(1, s, negro, { stock: 3 }))).toEqual({ reason: "stock", stock: 3 });
  expect(deleteBlock(product([variant(1, s, negro)]), variant(1, s, negro))).toEqual({ reason: "last" });
  expect(deleteBlock(base, variant(1, s, negro))).toBeNull();
});

test("lists the values a deletion or a combination change leaves without variants", () => {
  const base = product();
  expect(valuesLeftWithoutVariants(base, base.variants[1])).toEqual([{ optionId: talla, optionName: "Talla", valueName: "XL" }]);
  expect(valuesLeftWithoutVariants(base, base.variants[0])).toEqual([{ optionId: color, optionName: "Color", valueName: "Negro" }]);
  expect(valuesLeftWithoutVariants(base, base.variants[2])).toEqual([]);
});

test("parses the action body per intent and rejects what the intent does not accept", () => {
  expect(parseVariantAction(JSON.stringify({ intent: "update", sku: "A", salePrice: 12 }))).toEqual({ success: true, data: { intent: "update", request: { sku: "A", salePrice: 12 } } });
  expect(parseVariantAction(JSON.stringify({ intent: "status", status: "active" }))).toEqual({ success: true, data: { intent: "status", request: { status: "active" } } });
  expect(parseVariantAction(JSON.stringify({ intent: "delete" }))).toEqual({ success: true, data: { intent: "delete", request: {} } });
  expect(parseVariantAction(JSON.stringify({ intent: "delete", sku: "A" }))).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(parseVariantAction(JSON.stringify({ intent: "other" }))).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(parseVariantAction("{")).toMatchObject({ success: false, error: { code: "MALFORMED_JSON" } });
});

test("answers every business rejection with the text the seller reads next to the field", () => {
  const detail = product();
  const issue = (field: string, reason: string, extra: object = {}) => ({ scope: "variant", variantId: id(21), field, reason, message: "x", ...extra });
  const rejected = (error: object, intent: "update" | "combination" | "status" | "delete" = "update") => outcomeFor(intent, { success: false, error } as never, { product: detail, variantId: id(21) }, "es");
  expect(rejected({ code: "DUPLICATE_SKU", message: "" })).toEqual({ intent: "update", failed: true, errors: { sku: "Este SKU ya lo usa otra variante." } });
  expect(rejected({ code: "VALIDATION_ERROR", message: "", issues: [issue("salePrice", "INVALID_PRICE", { minimum: 0.01, maximum: 9 })] }))
    .toMatchObject({ errors: { salePrice: "Escribe un precio mayor que 0." } });
  expect(rejected({ code: "VALIDATION_ERROR", message: "", issues: [issue("salePrice", "INVALID_PRECISION", { maxDecimals: 2 })] }))
    .toMatchObject({ errors: { salePrice: "Usa como máximo 2 decimales." } });
  expect(rejected({ code: "VARIANT_NOT_FOUND", message: "" })).toMatchObject({ errors: { form: "Esta variante ya no existe." } });
  expect(rejected({ code: "PERSISTENCE_UNAVAILABLE", message: "" })).toMatchObject({ errors: { inDoubt: "Puede que se hayan guardado los cambios. Recarga la variante para revisarlos." } });
  expect(rejected({ code: "PERSISTENCE_UNAVAILABLE", message: "" }, "status")).toMatchObject({ errors: { inDoubt: "No se pudo confirmar el cambio. Recarga la variante para ver su estado." } });
  expect(rejected({ code: "VARIANT_HAS_ORDERS", message: "" }, "delete")).toMatchObject({ errors: { form: "Tiene pedidos, por eso no se puede eliminar. Puedes desactivarla." } });
  expect(rejected({ code: "LAST_VARIANT", message: "" }, "delete")).toMatchObject({ errors: { form: "Es la única variante del producto, por eso no se puede eliminar." } });
});

test("answers a repeated or invalid combination with the reason next to the selectors", () => {
  const detail = product();
  const entries = [{ optionId: talla, valueId: s }, { optionId: color, valueId: azul }];
  const run = (error: object) => outcomeFor("combination", { success: false, error } as never, { product: detail, variantId: id(21), entries }, "es");
  expect(run({ code: "DUPLICATE_COMBINATION", message: "" })).toEqual({ intent: "combination", failed: true, errors: { combination: "Ya existe la variante S / Azul. Elige otra combinación." } });
  const value = (reason: string, extra: object = {}) => ({ scope: "value", optionIndex: 0, valueIndex: 2, valueId: id(90), field: "name", reason, message: "x", ...extra });
  expect(run({ code: "VALIDATION_ERROR", message: "", issues: [value("DUPLICATE_VALUE")] }, )).toMatchObject({ errors: { combination: expect.stringContaining("ya está en esta opción") } });
  expect(run({ code: "VALIDATION_ERROR", message: "", issues: [{ scope: "option", optionIndex: 0, field: "values", reason: "TOO_MANY_VALUES", maximum: 30, message: "x" }] }))
    .toMatchObject({ errors: { combination: "Máximo 30 valores por opción." } });
});

test("confirms each action with its own text", () => {
  const ok = (intent: "update" | "combination" | "status" | "delete", status?: "active" | "inactive") => outcomeFor(intent, { success: true, data: undefined } as never, { product: product(), variantId: id(21), status }, "es");
  expect(ok("update")).toEqual({ intent: "update", saved: "Variante guardada" });
  expect(ok("combination")).toEqual({ intent: "combination", saved: "Combinación cambiada" });
  expect(ok("status", "inactive")).toEqual({ intent: "status", saved: "Variante desactivada" });
  expect(ok("status", "active")).toEqual({ intent: "status", saved: "Variante activada" });
});
