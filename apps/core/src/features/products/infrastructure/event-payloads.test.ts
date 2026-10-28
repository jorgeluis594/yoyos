import { expect, test } from "vitest";
import { parseProductPhotosAdded } from "@core/src/features/products/infrastructure/event-payloads";

const companyId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";

test("parses product_photos_added and rejects extra fields or non-UUID ids", () => {
  expect(parseProductPhotosAdded({ companyId, productId })).toEqual({ success: true, data: { companyId, productId } });
  for (const input of [{ companyId, productId, extra: 1 }, { companyId }, { productId }, { companyId: "x", productId }, { companyId, productId: "x" }, null])
    expect(parseProductPhotosAdded(input)).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
});
