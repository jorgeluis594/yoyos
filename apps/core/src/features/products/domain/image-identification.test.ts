import { describe, expect, test } from "vitest";
import {
  acceptVisualMatch, parseEmbeddingVector, parseMatchConfidence, selectProductCode,
  type MatchConfidence, type VisualCandidate,
} from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const confidence = (value: number) => value as MatchConfidence;
const candidates: VisualCandidate[] = [1, 2].map((n) => ({ productId: id(n) as ProductId, imageId: id(10 + n) as ImageId, distance: n / 10 }));

describe("selectProductCode", () => {
  test("selectProductCode skips with no_qr_code when nothing was decoded", () => {
    expect(selectProductCode([])).toEqual({ kind: "skip", reason: "no_qr_code" });
  });

  test("selectProductCode skips with unrecognized_qr_code when no decoded value is a UUID", () => {
    expect(selectProductCode(["https://pay.example/yape", "12345"])).toEqual({ kind: "skip", reason: "unrecognized_qr_code" });
  });

  test("selectProductCode keeps only UUID codes without duplicates in reading order", () => {
    expect(selectProductCode([id(2), "https://x.test", id(1), id(2)])).toEqual({ kind: "codes", codes: [id(2), id(1)] });
  });
});

describe("acceptVisualMatch", () => {
  test("acceptVisualMatch accepts a chosen candidate at or above the minimum confidence", () => {
    expect(acceptVisualMatch({ kind: "product", productId: id(2) as ProductId, confidence: confidence(0.8), showsProduct: 0.9 }, candidates, confidence(0.8)))
      .toEqual({ kind: "accepted", productId: id(2), confidence: 0.8 });
  });

  test("acceptVisualMatch rejects a choice below the minimum confidence as low_confidence", () => {
    expect(acceptVisualMatch({ kind: "product", productId: id(1) as ProductId, confidence: confidence(0.79), showsProduct: 0.9 }, candidates, confidence(0.8)))
      .toEqual({ kind: "rejected", reason: "low_confidence" });
  });

  test("acceptVisualMatch rejects none as no_visual_match", () => {
    expect(acceptVisualMatch({ kind: "none", confidence: confidence(0.9), showsProduct: 0.9 }, candidates, confidence(0.8))).toEqual({ kind: "rejected", reason: "no_visual_match" });
  });

  test("acceptVisualMatch rejects a product that is not among the candidates", () => {
    expect(acceptVisualMatch({ kind: "product", productId: id(9) as ProductId, confidence: confidence(1), showsProduct: 0.9 }, candidates, confidence(0.8)))
      .toEqual({ kind: "rejected", reason: "no_visual_match" });
  });
});

describe("parsers", () => {
  test("parseEmbeddingVector rejects a vector with the wrong length or non-finite values", () => {
    expect(parseEmbeddingVector([0.1, 0.2, 0.3], 3)).toEqual([0.1, 0.2, 0.3]);
    for (const values of [[0.1, 0.2], [0.1, Number.NaN, 0.3], [0.1, Number.POSITIVE_INFINITY, 0.3]]) expect(parseEmbeddingVector(values, 3)).toBeNull();
  });

  test("parseMatchConfidence rejects values outside 0 to 1", () => {
    expect([0, 0.5, 1].map(parseMatchConfidence)).toEqual([0, 0.5, 1]);
    expect([-0.01, 1.01, Number.NaN].map(parseMatchConfidence)).toEqual([null, null, null]);
  });
});
