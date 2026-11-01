import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import type { ProductId } from "@core/src/features/products/domain/product";
import { describeVariantsForAssistant, type DescribedVariant } from "@core/src/features/products/application/describe-variants-for-assistant";

const described: DescribedVariant = { variantId: "v1", productId: "p1" as ProductId, productName: "Polo", values: ["M", "Azul"], matchesText: true };

test("describes the given variants with the trimmed text and reads nothing for an empty list", async () => {
  const readVariants = vi.fn(async () => ok([described]));
  expect(await describeVariantsForAssistant({ by: "variants", variantIds: ["v1"], text: "  polo " }, { readVariants })).toEqual({ success: true, data: [described] });
  expect(readVariants).toHaveBeenCalledWith({ by: "variants", variantIds: ["v1"], text: "polo" });
  readVariants.mockClear();
  expect(await describeVariantsForAssistant({ by: "variants", variantIds: [] }, { readVariants })).toEqual({ success: true, data: [] });
  expect(readVariants).not.toHaveBeenCalled();
});

test("describes one product by id and returns the read failure as it is", async () => {
  const failure = { success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" } };
  const readVariants = vi.fn(async () => failure);
  expect(await describeVariantsForAssistant({ by: "product", productId: "p1" as ProductId }, { readVariants })).toEqual(failure);
  expect(readVariants).toHaveBeenCalledWith({ by: "product", productId: "p1" });
});
