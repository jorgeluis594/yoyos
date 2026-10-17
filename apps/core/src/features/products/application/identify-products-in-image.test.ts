import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { identifyProductsInImage, type IdentifyProductsDependencies, type VisualSearch } from "@core/src/features/products/application/identify-products-in-image";
import type { CatalogItem, EmbeddingModel, EmbeddingVector, MatchConfidence, VariantQrCode, VisualCandidate } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const image = { bytes: new Uint8Array([1]), contentType: "image/jpeg" };
const productP = id(1) as ProductId;
const productQ = id(2) as ProductId;
const item = (n: number): CatalogItem => ({ variantId: id(100 + n) as VariantId, productName: `Variant ${n}`, variantAttributes: {}, sku: null, unitPrice: { amount: 10, currency: "PEN" } });
const candidate = (productId: ProductId, n: number): VisualCandidate => ({ productId, imageId: id(10 + n) as ImageId, distance: n / 10 });

function harness(options: Readonly<{ decoded?: readonly string[]; qrError?: "UNREADABLE_IMAGE" | "QR_READER_UNAVAILABLE"; qrVariants?: (CatalogItem & { qrCode: VariantQrCode })[]; visual?: Partial<VisualSearch> | null }> = {}) {
  const calls: string[] = [];
  const asked: { products: ProductId[] } = { products: [] };
  const called = <T>(name: string, value: T): T => { calls.push(name); return value; };
  const visual: VisualSearch = {
    model: "openai/test" as EmbeddingModel, candidates: 5, minConfidence: 0.8 as MatchConfidence,
    embedImage: async () => called("embedImage", ok([0.1, 0.2] as unknown as EmbeddingVector)),
    findNearestProductImages: async () => called("findNearestProductImages", ok([candidate(productP, 1), candidate(productQ, 2)])),
    readImage: async () => called("readImage", ok(image)),
    chooseProduct: async (input) => { asked.products = input.candidates.map(({ productId }) => productId); return called("chooseProduct", ok({ kind: "product", productId: productP, confidence: 0.9 as MatchConfidence })); },
    findSellableVariantsOfProduct: async () => called("findSellableVariantsOfProduct", ok([item(1)])),
    ...options.visual,
  };
  const deps: IdentifyProductsDependencies = {
    readQrCodes: async () => called("readQrCodes", options.qrError ? err({ code: options.qrError, message: "x" }) : ok(options.decoded ?? [])),
    findVariantsByCodes: async (codes) => called("findVariantsByCodes", ok((options.qrVariants ?? []).filter((variant) => codes.includes(variant.qrCode)))),
    visual: options.visual === null ? null : visual,
  };
  return { calls, asked, run: () => identifyProductsInImage(image, deps) };
}

const qrVariant = (n: number) => ({ ...item(n), qrCode: id(200 + n) as VariantQrCode });

describe("identifyProductsInImage", () => {
  test("returns the QR variants without calling visual search", async () => {
    const h = harness({ decoded: [id(201), id(299)], qrVariants: [qrVariant(1)] });
    expect(await h.run()).toEqual(ok({ kind: "found", method: "qr", items: [qrVariant(1)], unknownCodes: [id(299)] }));
    expect(h.calls).toEqual(["readQrCodes", "findVariantsByCodes"]);
  });

  test("stops with unknown_qr_codes when product codes match no sellable variant", async () => {
    const h = harness({ decoded: [id(299)] });
    expect(await h.run()).toEqual(ok({ kind: "not_found", reason: "unknown_qr_codes" }));
    expect(h.calls).not.toContain("embedImage");
  });

  test("stops with unreadable_image without calling visual search", async () => {
    const h = harness({ qrError: "UNREADABLE_IMAGE" });
    expect(await h.run()).toEqual(ok({ kind: "not_found", reason: "unreadable_image" }));
    expect(h.calls).toEqual(["readQrCodes"]);
  });

  test("runs visual search when the image has no QR code", async () => {
    const h = harness();
    expect(await h.run()).toMatchObject({ success: true, data: { kind: "found", method: "visual" } });
    expect(h.calls).toEqual(["readQrCodes", "embedImage", "findNearestProductImages", "readImage", "readImage", "chooseProduct", "findSellableVariantsOfProduct"]);
  });

  test("stops with unrecognized_qr_code without calling visual search when the image only has non-product QR codes", async () => {
    const h = harness({ decoded: ["https://pay.example/yape"] });
    expect(await h.run()).toEqual(ok({ kind: "not_found", reason: "unrecognized_qr_code" }));
    expect(h.calls).toEqual(["readQrCodes"]);
  });

  test("returns visual_search_disabled when visual search is not configured", async () => {
    expect(await harness({ visual: null }).run()).toEqual(ok({ kind: "not_found", reason: "visual_search_disabled" }));
  });

  test("returns no_indexed_products when the company has no embeddings of the model", async () => {
    const h = harness({ visual: { findNearestProductImages: async () => ok([]) } });
    expect(await h.run()).toEqual(ok({ kind: "not_found", reason: "no_indexed_products" }));
    expect(h.calls).not.toContain("chooseProduct");
  });

  test("drops candidates whose image no longer exists and asks the model with the rest", async () => {
    const h = harness({ visual: { readImage: async (imageId) => imageId === id(12) ? err({ code: "IMAGE_NOT_FOUND", message: "gone" }) : ok(image) } });
    expect(await h.run()).toMatchObject({ success: true, data: { kind: "found", candidates: 1 } });
    expect(h.asked.products).toEqual([productP]);
    const none = harness({ visual: { readImage: async () => err({ code: "IMAGE_NOT_FOUND", message: "gone" }) } });
    expect(await none.run()).toEqual(ok({ kind: "not_found", reason: "no_indexed_products" }));
  });

  test("returns the only variant of the chosen product with its confidence", async () => {
    expect(await harness().run()).toEqual(ok({ kind: "found", method: "visual", items: [item(1)], confidence: 0.9, candidates: 2 }));
  });

  test("returns low_confidence, no_visual_match or ambiguous_variant from the domain rules", async () => {
    const low = harness({ visual: { chooseProduct: async () => ok({ kind: "product", productId: productP, confidence: 0.6 as MatchConfidence }) } });
    expect(await low.run()).toEqual(ok({ kind: "not_found", reason: "low_confidence" }));
    const none = harness({ visual: { chooseProduct: async () => ok({ kind: "none" }) } });
    expect(await none.run()).toEqual(ok({ kind: "not_found", reason: "no_visual_match" }));
    const ambiguous = harness({ visual: { findSellableVariantsOfProduct: async () => ok([item(1), item(2)]) } });
    expect(await ambiguous.run()).toEqual(ok({ kind: "not_found", reason: "ambiguous_variant" }));
  });

  test("propagates embedder, matcher, storage and persistence failures", async () => {
    const failures: [Partial<VisualSearch>, string][] = [
      [{ embedImage: async () => err({ code: "EMBEDDER_UNAVAILABLE", message: "x" }) }, "EMBEDDER_UNAVAILABLE"],
      [{ embedImage: async () => err({ code: "INVALID_EMBEDDING", message: "x" }) }, "INVALID_EMBEDDING"],
      [{ chooseProduct: async () => err({ code: "PRODUCT_MATCHER_UNAVAILABLE", message: "x" }) }, "PRODUCT_MATCHER_UNAVAILABLE"],
      [{ chooseProduct: async () => err({ code: "INVALID_MATCHER_RESPONSE", message: "x" }) }, "INVALID_MATCHER_RESPONSE"],
      [{ readImage: async () => err({ code: "IMAGE_STORAGE_UNAVAILABLE", message: "x" }) }, "IMAGE_STORAGE_UNAVAILABLE"],
      [{ findNearestProductImages: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "x" }) }, "PERSISTENCE_UNAVAILABLE"],
      [{ findSellableVariantsOfProduct: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "x" }) }, "PERSISTENCE_UNAVAILABLE"],
    ];
    for (const [visual, code] of failures) expect(await harness({ visual }).run()).toMatchObject({ success: false, error: { code } });
    expect(await harness({ qrError: "QR_READER_UNAVAILABLE" }).run()).toMatchObject({ success: false, error: { code: "QR_READER_UNAVAILABLE" } });
  });
});
