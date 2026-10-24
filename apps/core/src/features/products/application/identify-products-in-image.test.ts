import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { identifyProductsInImage, type IdentifyProductsDependencies, type VisualSearch } from "@core/src/features/products/application/identify-products-in-image";
import type { CatalogItem, EmbeddingModel, EmbeddingVector, ImageBytes, MatchConfidence, VariantQrCode, VisualCandidate } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const image = { bytes: new Uint8Array([1]), contentType: "image/jpeg" };
const productP = id(1) as ProductId;
const productQ = id(2) as ProductId;
const item = (n: number): CatalogItem => ({ variantId: id(100 + n) as VariantId, productName: `Variant ${n}`, variantAttributes: {}, sku: null, unitPrice: { amount: 10, currency: "PEN" } });
const candidate = (productId: ProductId, n: number): VisualCandidate => ({ productId, imageId: id(10 + n) as ImageId, distance: n / 10 });

function harness(options: Readonly<{ decoded?: readonly string[]; qrError?: "UNREADABLE_IMAGE" | "QR_READER_UNAVAILABLE"; qrVariants?: (CatalogItem & { productId: ProductId; qrCode: VariantQrCode })[]; visual?: Partial<VisualSearch> | null }> = {}) {
  const calls: string[] = [];
  const asked: { products: ProductId[]; embedded?: ImageBytes; query?: ImageBytes; detail?: Readonly<{ kind: string; image: ImageBytes }> } = { products: [] };
  const called = <T>(name: string, value: T): T => { calls.push(name); return value; };
  const visual: VisualSearch = {
    model: "openai/test" as EmbeddingModel, candidates: 5, minConfidence: 0.8 as MatchConfidence,
    hasIndexedProducts: async () => called("hasIndexedProducts", ok(true)),
    embedImage: async (embedded) => { asked.embedded = embedded; return called("embedImage", ok([0.1, 0.2] as unknown as EmbeddingVector)); },
    brightenDimPhoto: async () => null,
    cropPostPhoto: async () => null,
    findNearestProductImages: async () => called("findNearestProductImages", ok([candidate(productP, 1), candidate(productQ, 2)])),
    readImage: async () => called("readImage", ok(image)),
    chooseProduct: async (input) => { Object.assign(asked, { products: input.candidates.map(({ productId }) => productId), query: input.query, detail: input.detail }); return called("chooseProduct", ok({ kind: "product", productId: productP, confidence: 0.9 as MatchConfidence, showsProduct: 0.95 })); },
    ...options.visual,
  };
  const deps: IdentifyProductsDependencies = {
    readQrCodes: async () => called("readQrCodes", options.qrError ? err({ code: options.qrError, message: "x" }) : ok(options.decoded ?? [])),
    findVariantsByCodes: async (codes) => called("findVariantsByCodes", ok((options.qrVariants ?? []).filter((variant) => codes.includes(variant.qrCode)))),
    visual: options.visual === null ? null : visual,
  };
  return { calls, asked, run: () => identifyProductsInImage(image, deps) };
}

const qrVariant = (n: number) => ({ ...item(n), productId: id(300 + n) as ProductId, qrCode: id(200 + n) as VariantQrCode });

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
    expect(h.calls).toEqual(["readQrCodes", "hasIndexedProducts", "embedImage", "findNearestProductImages", "readImage", "readImage", "chooseProduct"]);
  });

  test("returns not product without calling visual search when the image only has non-product QR codes", async () => {
    const h = harness({ decoded: ["https://pay.example/yape"] });
    expect(await h.run()).toEqual(ok({ kind: "not_product" }));
    expect(h.calls).toEqual(["readQrCodes"]);
  });

  test("returns visual_search_disabled when visual search is not configured", async () => {
    expect(await harness({ visual: null }).run()).toEqual(ok({ kind: "not_found", reason: "visual_search_disabled" }));
  });

  test("returns no_indexed_products without embedding the image when the company has no indexed products", async () => {
    const h = harness({ visual: { hasIndexedProducts: async () => ok(false) } });
    expect(await h.run()).toEqual(ok({ kind: "not_found", reason: "no_indexed_products" }));
    expect(h.calls).toEqual(["readQrCodes"]);
  });

  test("returns no_indexed_products when no sellable product is near", async () => {
    const h = harness({ visual: { findNearestProductImages: async () => ok([]) } });
    expect(await h.run()).toEqual(ok({ kind: "not_found", reason: "no_indexed_products" }));
    expect(h.calls).not.toContain("chooseProduct");
  });

  test("propagates a failure of the indexed products check without embedding", async () => {
    const h = harness({ visual: { hasIndexedProducts: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "db" }) } });
    expect(await h.run()).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    expect(h.calls).toEqual(["readQrCodes"]);
  });

  test("drops candidates whose image no longer exists and asks the model with the rest", async () => {
    const h = harness({ visual: { readImage: async (imageId) => imageId === id(12) ? err({ code: "IMAGE_NOT_FOUND", message: "gone" }) : ok(image) } });
    expect(await h.run()).toMatchObject({ success: true, data: { kind: "found", candidates: 1 } });
    expect(h.asked.products).toEqual([productP]);
    const none = harness({ visual: { readImage: async () => err({ code: "IMAGE_NOT_FOUND", message: "gone" }) } });
    expect(await none.run()).toEqual(ok({ kind: "not_found", reason: "no_indexed_products" }));
  });

  test("searches a post screenshot by the photo inside it and shows the chooser both", async () => {
    const photo = { bytes: new Uint8Array([2]), contentType: "image/jpeg" };
    const post = harness({ visual: { cropPostPhoto: async () => photo } });
    expect(await post.run()).toMatchObject({ success: true, data: { kind: "found", method: "visual" } });
    expect(post.asked).toMatchObject({ embedded: photo, query: image, detail: { kind: "post_photo", image: photo } });
    const plain = harness();
    await plain.run();
    expect(plain.asked).toMatchObject({ embedded: image, query: image, detail: undefined });
  });

  test("searches a dim photo by its brightened copy and shows the chooser both", async () => {
    const bright = { bytes: new Uint8Array([3]), contentType: "image/jpeg" };
    const cropped: ImageBytes[] = [];
    const dim = harness({ visual: { brightenDimPhoto: async () => bright, cropPostPhoto: async (input) => { cropped.push(input); return null; } } });
    expect(await dim.run()).toMatchObject({ success: true, data: { kind: "found", method: "visual" } });
    expect(dim.asked).toMatchObject({ embedded: bright, query: image, detail: { kind: "brightened", image: bright } });
    expect(cropped).toEqual([bright]);
  });

  test("returns the chosen product, without choosing a variant, with its confidence and distances", async () => {
    expect(await harness().run()).toEqual(ok({ kind: "found", method: "visual", productId: productP, confidence: 0.9, candidates: 2, topDistance: 0.1, chosenDistance: 0.1 }));
  });

  test("returns low_confidence or no_visual_match from the domain rules, with the candidate distances", async () => {
    const low = harness({ visual: { chooseProduct: async () => ok({ kind: "product", productId: productQ, confidence: 0.6 as MatchConfidence, showsProduct: 0.9 }) } });
    expect(await low.run()).toEqual(ok({ kind: "not_found", reason: "low_confidence", topDistance: 0.1, chosenDistance: 0.2 }));
    const none = harness({ visual: { chooseProduct: async () => ok({ kind: "none", confidence: 0.9 as MatchConfidence, showsProduct: 0.9 }) } });
    expect(await none.run()).toStrictEqual(ok({ kind: "not_found", reason: "no_visual_match", topDistance: 0.1 }));
  });

  test("returns not product when the chooser answers none and the photo does not show a product", async () => {
    const h = harness({ visual: { chooseProduct: async () => ok({ kind: "none", confidence: 0.9 as MatchConfidence, showsProduct: 0.1 }) } });
    expect(await h.run()).toStrictEqual(ok({ kind: "not_product", topDistance: 0.1 }));
  });

  test("returns not product when the chooser matches a candidate above the threshold but the photo does not show a product", async () => {
    const selfie = harness({ visual: { chooseProduct: async () => ok({ kind: "product", productId: productQ, confidence: 0.83 as MatchConfidence, showsProduct: 0.08 }) } });
    expect(await selfie.run()).toStrictEqual(ok({ kind: "not_product", topDistance: 0.1, chosenDistance: 0.2 }));
  });

  test("returns not found when the photo shows a product below the confidence threshold", async () => {
    const low = harness({ visual: { chooseProduct: async () => ok({ kind: "product", productId: productQ, confidence: 0.6 as MatchConfidence, showsProduct: 0.5 }) } });
    expect(await low.run()).toEqual(ok({ kind: "not_found", reason: "low_confidence", topDistance: 0.1, chosenDistance: 0.2 }));
    const unsure = harness({ visual: { chooseProduct: async () => ok({ kind: "product", productId: productQ, confidence: 0.6 as MatchConfidence, showsProduct: 0.4 }) } });
    expect(await unsure.run()).toEqual(ok({ kind: "not_product", topDistance: 0.1, chosenDistance: 0.2 }));
  });

  test("propagates embedder, matcher, storage and persistence failures", async () => {
    const failures: [Partial<VisualSearch>, string][] = [
      [{ embedImage: async () => err({ code: "EMBEDDER_UNAVAILABLE", message: "x" }) }, "EMBEDDER_UNAVAILABLE"],
      [{ embedImage: async () => err({ code: "INVALID_EMBEDDING", message: "x" }) }, "INVALID_EMBEDDING"],
      [{ chooseProduct: async () => err({ code: "PRODUCT_MATCHER_UNAVAILABLE", message: "x" }) }, "PRODUCT_MATCHER_UNAVAILABLE"],
      [{ chooseProduct: async () => err({ code: "INVALID_MATCHER_RESPONSE", message: "x" }) }, "INVALID_MATCHER_RESPONSE"],
      [{ readImage: async () => err({ code: "IMAGE_STORAGE_UNAVAILABLE", message: "x" }) }, "IMAGE_STORAGE_UNAVAILABLE"],
      [{ findNearestProductImages: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "x" }) }, "PERSISTENCE_UNAVAILABLE"],
    ];
    for (const [visual, code] of failures) expect(await harness({ visual }).run()).toMatchObject({ success: false, error: { code } });
    expect(await harness({ qrError: "QR_READER_UNAVAILABLE" }).run()).toMatchObject({ success: false, error: { code: "QR_READER_UNAVAILABLE" } });
  });
});
