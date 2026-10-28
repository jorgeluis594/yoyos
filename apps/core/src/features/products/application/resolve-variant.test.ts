import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { resolveVariant, type ResolveVariantDependencies } from "@core/src/features/products/application/resolve-variant";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductWithSellableVariants, VariantChoice, VariantChoiceInput } from "@core/src/features/products/domain/text-identification";

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

  test("asks the chooser with the words, the sellable variants and the base variant as data, and uses its sellable choice", async () => {
    const polos = product(variant(1, { Talla: "M", Color: "Negro" }), variant(2, { Talla: "L", Color: "Negro" }), variant(3, { Talla: "L", Color: "Blanco" }));
    const inputs: VariantChoiceInput[] = [];
    const deps: ResolveVariantDependencies = { minConfidence: 0.8, chooseVariant: async (input) => { inputs.push(input); return ok({ variantId: "variant-2" as VariantId, confidence: 0.9 }); } };
    expect(await resolveVariant({ product: polos, words: ["talla", "L"], preselectedVariantId: "variant-1" as VariantId }, deps, signal)).toEqual(ok({ kind: "resolved", item: polos.variants[1] }));
    expect(await resolveVariant({ product: polos, words: ["L"], preselectedVariantId: null }, deps, signal)).toEqual(ok({ kind: "resolved", item: polos.variants[1] }));
    expect(inputs).toEqual([{ words: ["talla", "L"], variants: polos.variants, base: polos.variants[0] }, { words: ["L"], variants: polos.variants, base: null }]);
  });

  test("never resolves a variant by matching the words in code: even an exact value goes to the chooser", async () => {
    const h = harness({ variantId: null, confidence: 0.9 });
    expect(await resolveVariant({ product: sizes, words: ["M"], preselectedVariantId: null }, h.deps, signal)).toEqual(ok({ kind: "not_available" }));
    expect(h.asked).toEqual([["M"]]);
  });

  test("a base variant that is no longer sellable is not passed as the base", async () => {
    const inputs: VariantChoiceInput[] = [];
    const deps: ResolveVariantDependencies = { minConfidence: 0.8, chooseVariant: async (input) => { inputs.push(input); return ok({ variantId: null, confidence: 0.9 }); } };
    await resolveVariant({ product: sizes, words: ["L"], preselectedVariantId: "variant-9" as VariantId }, deps, signal);
    expect(inputs[0]!.base).toBeNull();
  });

  test("reports a variant not available when no sellable variant fits", async () => {
    const withoutL = product(variant(1, { Talla: "S" }), variant(2, { Talla: "M" }));
    const h = harness({ variantId: null, confidence: 0.95 });
    expect(await resolveVariant({ product: withoutL, words: ["talla", "L"], preselectedVariantId: "variant-2" as VariantId }, h.deps, signal)).toEqual(ok({ kind: "not_available" }));
    expect(h.asked).toEqual([["talla", "L"]]);
  });

  test("accepts only a sellable variant the chooser picked at the minimum confidence", async () => {
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
