import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { resolveVariant, type ResolveVariantDependencies } from "@core/src/features/products/application/resolve-variant";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductWithSellableVariants, VariantChoice } from "@core/src/features/products/domain/text-identification";

const variant = (n: number, attributes: Record<string, string>): CatalogItem =>
  ({ variantId: `variant-${n}` as VariantId, productName: "Polo básico", variantAttributes: attributes, sku: null, unitPrice: { amount: 35, currency: "PEN" } });
const product = (...variants: CatalogItem[]): ProductWithSellableVariants => ({ productId: "product-1" as ProductId, name: "Polo básico", variants });
const sizes = product(variant(1, { Talla: "S" }), variant(2, { Talla: "M" }), variant(3, { Talla: "L" }));
const signal = new AbortController().signal;

function harness(answer: VariantChoice = { variantId: null, confidence: 0.9 }) {
  const asked: string[][] = [];
  const deps: ResolveVariantDependencies = {
    chooseVariant: async ({ words }) => { asked.push([...words]); return ok(answer); },
    minConfidence: 0.8,
  };
  return { asked, deps };
}

describe("resolveVariant", () => {
  test("resolves the single sellable variant when no variant words are given", async () => {
    const h = harness();
    expect(await resolveVariant({ product: product(variant(1, { Talla: "M" })), words: [], preselectedVariantId: null }, h.deps, signal))
      .toEqual(ok({ kind: "resolved", item: variant(1, { Talla: "M" }) }));
    expect(h.asked).toEqual([]);
  });

  test("keeps a QR-selected variant when no variant words are given", async () => {
    const h = harness();
    expect(await resolveVariant({ product: sizes, words: [], preselectedVariantId: "variant-2" as VariantId }, h.deps, signal))
      .toEqual(ok({ kind: "resolved", item: variant(2, { Talla: "M" }) }));
    expect(h.asked).toEqual([]);
  });

  test("reports a missing variant with the product's attribute names", async () => {
    const colored = product(variant(1, { Talla: "M", Color: "Rojo" }), variant(2, { Talla: "L", Color: "Azul" }));
    expect(await resolveVariant({ product: colored, words: [], preselectedVariantId: null }, harness().deps, signal))
      .toEqual(ok({ kind: "missing", attributeNames: ["Talla", "Color"] }));
  });

  test("matches variant words ignoring case and accents before asking the model", async () => {
    const h = harness();
    expect(await resolveVariant({ product: sizes, words: ["talla", "m"], preselectedVariantId: null }, h.deps, signal)).toEqual(ok({ kind: "resolved", item: variant(2, { Talla: "M" }) }));
    const colors = product(variant(1, { Color: "Azul marino" }), variant(2, { Color: "Café" }));
    expect(await resolveVariant({ product: colors, words: ["CAFE"], preselectedVariantId: null }, h.deps, signal)).toEqual(ok({ kind: "resolved", item: variant(2, { Color: "Café" }) }));
    expect(await resolveVariant({ product: colors, words: ["azul", "marino"], preselectedVariantId: null }, h.deps, signal)).toEqual(ok({ kind: "resolved", item: variant(1, { Color: "Azul marino" }) }));
    expect(h.asked).toEqual([]);
  });

  test("resolves the variant named in the words over a QR-selected one", async () => {
    const h = harness();
    expect(await resolveVariant({ product: sizes, words: ["talla", "L"], preselectedVariantId: "variant-2" as VariantId }, h.deps, signal))
      .toEqual(ok({ kind: "resolved", item: variant(3, { Talla: "L" }) }));
    expect(h.asked).toEqual([]);
  });

  test("reports a variant not available when no sellable variant fits", async () => {
    const withoutL = product(variant(1, { Talla: "S" }), variant(2, { Talla: "M" }));
    const h = harness({ variantId: null, confidence: 0.95 });
    expect(await resolveVariant({ product: withoutL, words: ["talla", "L"], preselectedVariantId: "variant-2" as VariantId }, h.deps, signal)).toEqual(ok({ kind: "not_available" }));
    expect(h.asked).toEqual([["talla", "L"]]);
  });

  test("asks the model when the words fit no variant exactly and accepts a confident sellable choice only", async () => {
    const confident = harness({ variantId: "variant-3" as VariantId, confidence: 0.8 });
    expect(await resolveVariant({ product: sizes, words: ["la grande"], preselectedVariantId: null }, confident.deps, signal)).toEqual(ok({ kind: "resolved", item: variant(3, { Talla: "L" }) }));
    for (const answer of [{ variantId: "variant-3" as VariantId, confidence: 0.79 }, { variantId: "variant-9" as VariantId, confidence: 0.99 }]) {
      expect(await resolveVariant({ product: sizes, words: ["la grande"], preselectedVariantId: null }, harness(answer).deps, signal)).toEqual(ok({ kind: "not_available" }));
    }
  });

  test("propagates a matcher failure", async () => {
    const deps: ResolveVariantDependencies = { chooseVariant: async () => err({ code: "PRODUCT_MATCHER_UNAVAILABLE", message: "x" }), minConfidence: 0.8 };
    expect(await resolveVariant({ product: sizes, words: ["grande"], preselectedVariantId: null }, deps, signal)).toMatchObject({ success: false, error: { code: "PRODUCT_MATCHER_UNAVAILABLE" } });
  });
});
