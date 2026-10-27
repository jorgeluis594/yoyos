import { describe, expect, it } from "vitest";
import { createProductRequestSchema } from "@shared/contracts/products";
import { parseRequestJson, toCreateInput } from "@core/src/features/products/presentation/request-input";

const valid = {
  id: "00000000-0000-4000-8000-000000000001", name: "Cuaderno", description: null, imageId: null, currency: "PEN", options: [],
  variants: [{ values: [], sku: null, salePrice: 12.5, purchasePrice: null, initialStock: 0 }],
};
const parseCreate = (text: string) => parseRequestJson(createProductRequestSchema, text, "Invalid product input");

describe("create product JSON input", () => {
  it("accepts the product without options form payload and maps it to the use case input", () => {
    const parsed = parseCreate(JSON.stringify(valid));
    expect(parsed).toEqual({ success: true, data: valid });
    if (parsed.success) expect(toCreateInput(parsed.data)).toMatchObject({ id: valid.id, options: [], variants: [{ values: [], salePrice: 12.5 }] });
  });

  it("rejects malformed JSON, forbidden identity and fields, and invalid nested types", () => {
    expect(parseCreate("{")).toMatchObject({ success: false, error: { code: "MALFORMED_JSON" } });
    for (const payload of [
      { ...valid, companyId: crypto.randomUUID() },
      { ...valid, variants: [{ ...valid.variants[0], qrCode: "manual" }] },
      { ...valid, variants: [{ ...valid.variants[0], salePrice: "12.5" }] },
      { ...valid, variants: [{ ...valid.variants[0], attributes: {} }] },
      { ...valid, imageId: "wrong" },
    ]) expect(parseCreate(JSON.stringify(payload))).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });
});
