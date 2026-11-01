import { describe, expect, test } from "vitest";
import { assembleCandidates } from "@core/src/features/orders/domain/reader/candidates";
import type { RequestRef } from "@core/src/features/orders/domain/reader/refs";
import type { ProductId } from "@core/src/features/products/domain/product";

const p = (n: number) => `p${n}` as ProductId;
const r = (n: number) => `R${n}` as RequestRef;

describe("assembleCandidates", () => {
  test("offers the sellable match, not the unavailable twin, when only one candidate fits per mention", () => {
    const result = assembleCandidates({ searched: [{ request: r(1), productIds: [p(1), p(2)], unavailableProductIds: [p(9)] }],
      photoProductId: null, itemProductIds: [], pendingProductIds: [], perMention: 1 });
    expect(result.byMention.get(r(1))).toEqual([p(1)]);
  });

  test("keeps at most the per-mention limit, with one slot for an unavailable twin", () => {
    const { byMention } = assembleCandidates({ searched: [{ request: r(1), productIds: [p(1), p(2), p(3), p(4)], unavailableProductIds: [p(9)] }],
      photoProductId: null, itemProductIds: [], pendingProductIds: [], perMention: 3 });
    expect(byMention.get(r(1))).toEqual([p(1), p(2), p(9)]);
  });

  test("merges photo, item and pending products without duplicates and lists each product once", () => {
    const result = assembleCandidates({ searched: [{ request: r(1), productIds: [p(1)], unavailableProductIds: [] }, { request: r(2), productIds: [p(1), p(2)], unavailableProductIds: [] }],
      photoProductId: p(5), itemProductIds: [p(6), p(1)], pendingProductIds: [p(6)], perMention: 5 });
    expect(result.byMention.get(r(1))).toEqual([p(1), p(5), p(6)]);
    expect(result.productIds).toEqual([p(1), p(5), p(6), p(2)]);
  });

  test("gives a mention with no search match only the products the chat holds", () => {
    const result = assembleCandidates({ searched: [{ request: r(1), productIds: [], unavailableProductIds: [] }], photoProductId: null, itemProductIds: [], pendingProductIds: [], perMention: 5 });
    expect(result.byMention.get(r(1))).toEqual([]);
    expect(result.productIds).toEqual([]);
  });
});
