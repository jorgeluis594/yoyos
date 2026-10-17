import { expect, test } from "vitest";
import { parseProductImageChanged } from "@core/src/features/products/infrastructure/event-payloads";

const companyId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";

test("parses product_image_changed and rejects extra fields or non-UUID ids", () => {
  expect(parseProductImageChanged({ companyId, productId })).toEqual({ success: true, data: { companyId, productId } });
  for (const input of [{ companyId, productId, extra: 1 }, { companyId }, { productId }, { companyId: "x", productId }, { companyId, productId: "x" }, null])
    expect(parseProductImageChanged(input)).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
});
