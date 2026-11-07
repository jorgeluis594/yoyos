import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { setVariantStock, type StockCount } from "@core/src/features/products/application/set-variant-stock";
import { lAzul, mAzul, mNegro } from "@core/src/features/products/application/variant-action-fixtures";

const access = { companyId: "00000000-0000-4000-8000-0000000000aa" as never };

test("writes the counts in variant order", async () => {
  const written: (readonly StockCount[])[] = [];
  const result = await setVariantStock({ counts: [{ variantId: lAzul, stock: 1 }, { variantId: mNegro, stock: 2 }, { variantId: mAzul, stock: 3 }] }, access,
    { writeStock: async (_companyId, counts) => { written.push(counts); return ok(undefined); } });
  expect(result.success).toBe(true);
  expect(written).toEqual([[{ variantId: mNegro, stock: 2 }, { variantId: mAzul, stock: 3 }, { variantId: lAzul, stock: 1 }]]);
});

test("writes nothing when no count is given", async () => {
  let calls = 0;
  const result = await setVariantStock({ counts: [] }, access, { writeStock: async () => { calls += 1; return ok(undefined); } });
  expect(result.success).toBe(true);
  expect(calls).toBe(0);
});

test("answers the writeStock error unchanged", async () => {
  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to write stock" });
  const result = await setVariantStock({ counts: [{ variantId: mNegro, stock: 1 }] }, access, { writeStock: async () => failure });
  expect(result).toBe(failure);
});
